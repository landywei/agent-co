import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { requireNodeSqlite } from "../memory/sqlite.js";
import type {
  ChannelMember,
  ChannelMessage,
  ChannelType,
  CompanyChannel,
  CompanyChannelEvent,
  CompanyChannelPreview,
  CompanyChannelWithMembers,
  MemberRole,
} from "./types.js";

function genChannelId(): string {
  return "ch_" + crypto.randomBytes(8).toString("hex");
}

function genMessageId(): string {
  return "msg_" + Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'public',
      description TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_members (
      channel_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (channel_id, member_id),
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      thread_id TEXT,
      metadata TEXT,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    );
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_messages_channel_ts ON channel_messages(channel_id, timestamp);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_messages_thread ON channel_messages(thread_id) WHERE thread_id IS NOT NULL;`,
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_members_member ON channel_members(member_id);`);
}

export class CompanyChannelStore extends EventEmitter<{
  event: [CompanyChannelEvent];
}> {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    super();
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const { DatabaseSync } = requireNodeSqlite();
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec("PRAGMA foreign_keys=ON;");
    ensureSchema(this.db);
    this.ensureDefaultChannels();
  }

  private ensureDefaultChannels(): void {
    const existing = this.db
      .prepare(`SELECT 1 FROM channels WHERE name = ?`)
      .get("investor-relations");
    if (!existing) {
      this.createChannel({
        name: "investor-relations",
        type: "private",
        description: "Private channel between the Investor (human) and the CEO",
        createdBy: "system",
        members: ["investor", "main"],
      });
    }
  }

  createChannel(opts: {
    name: string;
    type: ChannelType;
    description?: string;
    createdBy: string;
    members?: string[];
  }): CompanyChannelWithMembers {
    const id = genChannelId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO channels (id, name, type, description, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, opts.name, opts.type, opts.description ?? "", opts.createdBy, now);

    const members: ChannelMember[] = [];
    const allMembers = opts.members ?? [opts.createdBy];
    const uniqueMembers = [...new Set(allMembers)];
    for (const memberId of uniqueMembers) {
      const role: MemberRole = memberId === opts.createdBy ? "admin" : "member";
      this.db
        .prepare(
          `INSERT INTO channel_members (channel_id, member_id, role, joined_at) VALUES (?, ?, ?, ?)`,
        )
        .run(id, memberId, role, now);
      members.push({ channelId: id, memberId, role, joinedAt: now });
    }

    const channel: CompanyChannelWithMembers = {
      id,
      name: opts.name,
      type: opts.type,
      description: opts.description ?? "",
      createdBy: opts.createdBy,
      createdAt: now,
      members,
    };

    this.emit("event", {
      type: "channel.created",
      channel,
      members: uniqueMembers,
    });

    return channel;
  }

  deleteChannel(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM channels WHERE id = ?`).run(id);
    if (result.changes > 0) {
      this.emit("event", { type: "channel.deleted", channelId: id });
      return true;
    }
    return false;
  }

  getChannel(idOrName: string): CompanyChannelWithMembers | null {
    const row = this.db
      .prepare(`SELECT * FROM channels WHERE id = ? OR name = ?`)
      .get(idOrName, idOrName) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }

    const members = this.db
      .prepare(`SELECT * FROM channel_members WHERE channel_id = ?`)
      .all(String(row.id)) as Array<{
      channel_id: string;
      member_id: string;
      role: MemberRole;
      joined_at: number;
    }>;

    return {
      ...mapChannelRow(row),
      members: members.map((m) => ({
        channelId: m.channel_id,
        memberId: m.member_id,
        role: m.role,
        joinedAt: m.joined_at,
      })),
    };
  }

  listChannels(): CompanyChannelPreview[] {
    const rows = this.db.prepare(`SELECT * FROM channels ORDER BY created_at ASC`).all() as Array<
      Record<string, unknown>
    >;

    return rows.map((row) => {
      const ch = mapChannelRow(row);
      const countRow = this.db
        .prepare(`SELECT COUNT(*) as cnt FROM channel_members WHERE channel_id = ?`)
        .get(ch.id) as { cnt: number };

      const lastMsgRow = this.db
        .prepare(
          `SELECT * FROM channel_messages WHERE channel_id = ? ORDER BY timestamp DESC LIMIT 1`,
        )
        .get(ch.id) as Record<string, unknown> | undefined;

      return {
        ...ch,
        memberCount: countRow.cnt,
        lastMessage: lastMsgRow ? mapMessageRow(lastMsgRow) : null,
      };
    });
  }

  listChannelsForMember(memberId: string): CompanyChannelPreview[] {
    const rows = this.db
      .prepare(
        `SELECT c.* FROM channels c
         JOIN channel_members cm ON c.id = cm.channel_id
         WHERE cm.member_id = ?
         ORDER BY c.created_at ASC`,
      )
      .all(memberId) as Array<Record<string, unknown>>;

    return rows.map((row) => {
      const ch = mapChannelRow(row);
      const countRow = this.db
        .prepare(`SELECT COUNT(*) as cnt FROM channel_members WHERE channel_id = ?`)
        .get(ch.id) as { cnt: number };
      const lastMsgRow = this.db
        .prepare(
          `SELECT * FROM channel_messages WHERE channel_id = ? ORDER BY timestamp DESC LIMIT 1`,
        )
        .get(ch.id) as Record<string, unknown> | undefined;
      return {
        ...ch,
        memberCount: countRow.cnt,
        lastMessage: lastMsgRow ? mapMessageRow(lastMsgRow) : null,
      };
    });
  }

  postMessage(opts: {
    channelId: string;
    senderId: string;
    text: string;
    threadId?: string;
    metadata?: Record<string, unknown>;
  }): ChannelMessage {
    const channel = this.db.prepare(`SELECT * FROM channels WHERE id = ?`).get(opts.channelId) as
      | Record<string, unknown>
      | undefined;
    if (!channel) {
      throw new Error(`Channel not found: ${opts.channelId}`);
    }

    const id = genMessageId();
    const now = Date.now();
    const metadataJson = opts.metadata ? JSON.stringify(opts.metadata) : null;

    this.db
      .prepare(
        `INSERT INTO channel_messages (id, channel_id, sender_id, text, timestamp, thread_id, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, opts.channelId, opts.senderId, opts.text, now, opts.threadId ?? null, metadataJson);

    const message: ChannelMessage = {
      id,
      channelId: opts.channelId,
      senderId: opts.senderId,
      text: opts.text,
      timestamp: now,
      threadId: opts.threadId ?? null,
      metadata: opts.metadata ?? null,
    };

    this.emit("event", {
      type: "channel.message",
      message,
      channelName: typeof channel.name === "string" ? channel.name : "",
    });

    return message;
  }

  getMessages(
    channelId: string,
    opts?: { limit?: number; before?: number; threadId?: string },
  ): ChannelMessage[] {
    const limit = opts?.limit ?? 50;

    if (opts?.threadId) {
      const rows = opts?.before
        ? this.db
            .prepare(
              `SELECT * FROM channel_messages
               WHERE channel_id = ? AND thread_id = ? AND timestamp < ?
               ORDER BY timestamp DESC LIMIT ?`,
            )
            .all(channelId, opts.threadId, opts.before, limit)
        : this.db
            .prepare(
              `SELECT * FROM channel_messages
               WHERE channel_id = ? AND thread_id = ?
               ORDER BY timestamp DESC LIMIT ?`,
            )
            .all(channelId, opts.threadId, limit);
      return (rows as Array<Record<string, unknown>>).map(mapMessageRow).toReversed();
    }

    const rows = opts?.before
      ? this.db
          .prepare(
            `SELECT * FROM channel_messages
             WHERE channel_id = ? AND timestamp < ? AND thread_id IS NULL
             ORDER BY timestamp DESC LIMIT ?`,
          )
          .all(channelId, opts.before, limit)
      : this.db
          .prepare(
            `SELECT * FROM channel_messages
             WHERE channel_id = ? AND thread_id IS NULL
             ORDER BY timestamp DESC LIMIT ?`,
          )
          .all(channelId, limit);

    return (rows as Array<Record<string, unknown>>).map(mapMessageRow).toReversed();
  }

  addMember(channelId: string, memberId: string, role: MemberRole = "member"): boolean {
    const existing = this.db
      .prepare(`SELECT 1 FROM channel_members WHERE channel_id = ? AND member_id = ?`)
      .get(channelId, memberId);
    if (existing) {
      return false;
    }

    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO channel_members (channel_id, member_id, role, joined_at) VALUES (?, ?, ?, ?)`,
      )
      .run(channelId, memberId, role, now);

    this.emit("event", { type: "channel.member.joined", channelId, memberId });
    return true;
  }

  removeMember(channelId: string, memberId: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM channel_members WHERE channel_id = ? AND member_id = ?`)
      .run(channelId, memberId);
    if (result.changes > 0) {
      this.emit("event", { type: "channel.member.left", channelId, memberId });
      return true;
    }
    return false;
  }

  getMembers(channelId: string): ChannelMember[] {
    const rows = this.db
      .prepare(`SELECT * FROM channel_members WHERE channel_id = ?`)
      .all(channelId) as Array<{
      channel_id: string;
      member_id: string;
      role: MemberRole;
      joined_at: number;
    }>;
    return rows.map((m) => ({
      channelId: m.channel_id,
      memberId: m.member_id,
      role: m.role,
      joinedAt: m.joined_at,
    }));
  }

  isMember(channelId: string, memberId: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM channel_members WHERE channel_id = ? AND member_id = ?`)
      .get(channelId, memberId);
    return !!row;
  }

  resolveChannel(nameOrId: string): CompanyChannel | null {
    const row = this.db
      .prepare(`SELECT * FROM channels WHERE id = ? OR name = ?`)
      .get(nameOrId, nameOrId) as Record<string, unknown> | undefined;
    return row ? mapChannelRow(row) : null;
  }

  close(): void {
    this.db.close();
  }
}

function mapChannelRow(row: Record<string, unknown>): CompanyChannel {
  return {
    id: String(row.id),
    name: String(row.name),
    type: String(row.type) as ChannelType,
    description: typeof row.description === "string" ? row.description : "",
    createdBy:
      typeof (row.created_by ?? row.createdBy) === "string"
        ? ((row.created_by ?? row.createdBy) as string)
        : "",
    createdAt: Number(row.created_at ?? row.createdAt ?? 0),
  };
}

function mapMessageRow(row: Record<string, unknown>): ChannelMessage {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata && typeof row.metadata === "string") {
    try {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      metadata = null;
    }
  }
  return {
    id: String(row.id),
    channelId:
      typeof (row.channel_id ?? row.channelId) === "string"
        ? ((row.channel_id ?? row.channelId) as string)
        : "",
    senderId:
      typeof (row.sender_id ?? row.senderId) === "string"
        ? ((row.sender_id ?? row.senderId) as string)
        : "",
    text: String(row.text),
    timestamp: Number(row.timestamp),
    threadId: typeof row.thread_id === "string" ? row.thread_id : null,
    metadata,
  };
}
