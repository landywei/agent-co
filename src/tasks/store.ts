import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { requireNodeSqlite } from "../memory/sqlite.js";
import type {
  AgentTaskSummary,
  TaskDependency,
  TaskEvent,
  TaskLog,
  TaskLogType,
  TaskPriority,
  TaskStatus,
  TaskSummary,
  TaskThread,
} from "./types.js";

function genTaskId(): string {
  return "task_" + crypto.randomBytes(8).toString("hex");
}

function genLogId(): string {
  return "tlog_" + Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      parent_task_id TEXT,
      objective TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      priority TEXT NOT NULL DEFAULT 'medium',
      progress_summary TEXT NOT NULL DEFAULT '',
      artifacts TEXT NOT NULL DEFAULT '[]',
      dependencies TEXT NOT NULL DEFAULT '[]',
      last_heartbeat_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      metadata TEXT
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata TEXT,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id TEXT NOT NULL,
      depends_on_task_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (task_id, depends_on_task_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;`,
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_logs_task ON task_logs(task_id, timestamp);`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_deps_depends ON task_dependencies(depends_on_task_id);`,
  );
}

export class TaskStore extends EventEmitter<{ event: [TaskEvent] }> {
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
  }

  createTask(opts: {
    agentId: string;
    objective: string;
    parentTaskId?: string;
    priority?: TaskPriority;
    dependencies?: string[];
    metadata?: Record<string, unknown>;
  }): TaskThread {
    const id = genTaskId();
    const now = Date.now();
    const deps = opts.dependencies ?? [];
    const metadataJson = opts.metadata ? JSON.stringify(opts.metadata) : null;

    this.db
      .prepare(
        `INSERT INTO tasks (id, agent_id, parent_task_id, objective, status, priority, progress_summary, artifacts, dependencies, last_heartbeat_at, created_at, updated_at, completed_at, metadata)
         VALUES (?, ?, ?, ?, 'active', ?, '', '[]', ?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        id,
        opts.agentId,
        opts.parentTaskId ?? null,
        opts.objective,
        opts.priority ?? "medium",
        JSON.stringify(deps),
        now,
        now,
        now,
        metadataJson,
      );

    for (const depId of deps) {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (?, ?, ?)`,
        )
        .run(id, depId, now);
    }

    const task = this.getTask(id)!;

    this.appendLog({
      taskId: id,
      agentId: opts.agentId,
      type: "created",
      message: `Task created: ${opts.objective}`,
    });

    this.emit("event", { type: "task.created", task });
    return task;
  }

  getTask(id: string): TaskThread | null {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapTaskRow(row) : null;
  }

  updateTask(
    id: string,
    updates: {
      status?: TaskStatus;
      priority?: TaskPriority;
      progressSummary?: string;
      artifacts?: string[];
      objective?: string;
      agentId?: string;
      metadata?: Record<string, unknown>;
    },
  ): TaskThread | null {
    const existing = this.getTask(id);
    if (!existing) {
      return null;
    }

    const now = Date.now();
    const sets: string[] = ["updated_at = ?"];
    const values: (string | number | null)[] = [now];

    if (updates.status !== undefined) {
      sets.push("status = ?");
      values.push(updates.status);
      if (updates.status === "done" || updates.status === "failed") {
        sets.push("completed_at = ?");
        values.push(now);
      }
    }
    if (updates.priority !== undefined) {
      sets.push("priority = ?");
      values.push(updates.priority);
    }
    if (updates.progressSummary !== undefined) {
      sets.push("progress_summary = ?");
      values.push(updates.progressSummary);
    }
    if (updates.artifacts !== undefined) {
      sets.push("artifacts = ?");
      values.push(JSON.stringify(updates.artifacts));
    }
    if (updates.objective !== undefined) {
      sets.push("objective = ?");
      values.push(updates.objective);
    }
    if (updates.agentId !== undefined) {
      sets.push("agent_id = ?");
      values.push(updates.agentId);
    }
    if (updates.metadata !== undefined) {
      sets.push("metadata = ?");
      values.push(JSON.stringify(updates.metadata));
    }

    values.push(id);
    this.db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...values);

    const task = this.getTask(id)!;
    this.emit("event", { type: "task.updated", task, changes: updates });

    if (updates.status === "done") {
      this.emit("event", { type: "task.completed", task });
    } else if (updates.status === "failed") {
      this.emit("event", { type: "task.failed", task, reason: updates.progressSummary ?? "" });
    }

    return task;
  }

  heartbeat(taskId: string, agentId: string, message?: string): void {
    const now = Date.now();
    this.db
      .prepare(`UPDATE tasks SET last_heartbeat_at = ?, updated_at = ? WHERE id = ?`)
      .run(now, now, taskId);

    if (message) {
      this.appendLog({ taskId, agentId, type: "heartbeat", message });
    }

    this.emit("event", { type: "task.heartbeat", taskId, agentId, timestamp: now });
  }

  appendLog(opts: {
    taskId: string;
    agentId: string;
    type: TaskLogType;
    message: string;
    metadata?: Record<string, unknown>;
  }): TaskLog {
    const id = genLogId();
    const now = Date.now();
    const metadataJson = opts.metadata ? JSON.stringify(opts.metadata) : null;

    this.db
      .prepare(
        `INSERT INTO task_logs (id, task_id, agent_id, type, message, metadata, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, opts.taskId, opts.agentId, opts.type, opts.message, metadataJson, now);

    const log: TaskLog = {
      id,
      taskId: opts.taskId,
      agentId: opts.agentId,
      type: opts.type,
      message: opts.message,
      metadata: opts.metadata ?? null,
      timestamp: now,
    };

    this.emit("event", { type: "task.log", log });
    return log;
  }

  getLogs(taskId: string, opts?: { limit?: number; before?: number }): TaskLog[] {
    const limit = opts?.limit ?? 100;
    const rows = opts?.before
      ? this.db
          .prepare(
            `SELECT * FROM task_logs WHERE task_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?`,
          )
          .all(taskId, opts.before, limit)
      : this.db
          .prepare(`SELECT * FROM task_logs WHERE task_id = ? ORDER BY timestamp DESC LIMIT ?`)
          .all(taskId, limit);

    return (rows as Array<Record<string, unknown>>).map(mapLogRow).toReversed();
  }

  listTasks(opts?: {
    agentId?: string;
    status?: TaskStatus;
    parentTaskId?: string;
    limit?: number;
  }): TaskThread[] {
    const conditions: string[] = [];
    const values: (string | number | null)[] = [];

    if (opts?.agentId) {
      conditions.push("agent_id = ?");
      values.push(opts.agentId);
    }
    if (opts?.status) {
      conditions.push("status = ?");
      values.push(opts.status);
    }
    if (opts?.parentTaskId) {
      conditions.push("parent_task_id = ?");
      values.push(opts.parentTaskId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = opts?.limit ?? 200;

    const rows = this.db
      .prepare(`SELECT * FROM tasks ${where} ORDER BY updated_at DESC LIMIT ?`)
      .all(...values, limit) as Array<Record<string, unknown>>;

    return rows.map(mapTaskRow);
  }

  /** Get all active/blocked tasks that haven't heartbeated in `thresholdMs` */
  getStaleTasks(thresholdMs: number): TaskThread[] {
    const cutoff = Date.now() - thresholdMs;
    const rows = this.db
      .prepare(
        `SELECT * FROM tasks
         WHERE status IN ('active', 'blocked')
           AND (last_heartbeat_at IS NULL OR last_heartbeat_at < ?)
           AND created_at < ?
         ORDER BY updated_at ASC`,
      )
      .all(cutoff, cutoff) as Array<Record<string, unknown>>;

    return rows.map(mapTaskRow);
  }

  getDependencies(taskId: string): TaskDependency[] {
    const rows = this.db
      .prepare(`SELECT * FROM task_dependencies WHERE task_id = ?`)
      .all(taskId) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      taskId: String(r.task_id),
      dependsOnTaskId: String(r.depends_on_task_id),
      createdAt: Number(r.created_at),
    }));
  }

  getDependents(taskId: string): TaskDependency[] {
    const rows = this.db
      .prepare(`SELECT * FROM task_dependencies WHERE depends_on_task_id = ?`)
      .all(taskId) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      taskId: String(r.task_id),
      dependsOnTaskId: String(r.depends_on_task_id),
      createdAt: Number(r.created_at),
    }));
  }

  addDependency(taskId: string, dependsOnTaskId: string): boolean {
    const now = Date.now();
    try {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (?, ?, ?)`,
        )
        .run(taskId, dependsOnTaskId, now);
      return true;
    } catch {
      return false;
    }
  }

  removeDependency(taskId: string, dependsOnTaskId: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?`)
      .run(taskId, dependsOnTaskId);
    return result.changes > 0;
  }

  getSummary(): TaskSummary {
    const rows = this.db
      .prepare(`SELECT status, COUNT(*) as cnt FROM tasks GROUP BY status`)
      .all() as Array<{ status: string; cnt: number }>;

    const counts: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      counts[r.status] = r.cnt;
      total += r.cnt;
    }

    const staleRows = this.getStaleTasks(15 * 60 * 1000);

    return {
      total,
      active: counts["active"] ?? 0,
      blocked: counts["blocked"] ?? 0,
      waiting: counts["waiting"] ?? 0,
      done: counts["done"] ?? 0,
      failed: counts["failed"] ?? 0,
      stale: staleRows.length,
    };
  }

  getAgentSummaries(): AgentTaskSummary[] {
    const rows = this.db
      .prepare(
        `SELECT agent_id, status, COUNT(*) as cnt,
                MAX(last_heartbeat_at) as last_hb
         FROM tasks GROUP BY agent_id, status`,
      )
      .all() as Array<{
      agent_id: string;
      status: string;
      cnt: number;
      last_hb: number | null;
    }>;

    const agents = new Map<string, AgentTaskSummary>();
    for (const r of rows) {
      let entry = agents.get(r.agent_id);
      if (!entry) {
        entry = {
          agentId: r.agent_id,
          active: 0,
          blocked: 0,
          done: 0,
          failed: 0,
          lastHeartbeat: null,
        };
        agents.set(r.agent_id, entry);
      }
      if (r.status === "active") {
        entry.active = r.cnt;
      } else if (r.status === "blocked") {
        entry.blocked = r.cnt;
      } else if (r.status === "done") {
        entry.done = r.cnt;
      } else if (r.status === "failed") {
        entry.failed = r.cnt;
      }

      if (r.last_hb && (entry.lastHeartbeat === null || r.last_hb > entry.lastHeartbeat)) {
        entry.lastHeartbeat = r.last_hb;
      }
    }

    return [...agents.values()];
  }

  getSubtasks(parentTaskId: string): TaskThread[] {
    const rows = this.db
      .prepare(`SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY created_at ASC`)
      .all(parentTaskId) as Array<Record<string, unknown>>;
    return rows.map(mapTaskRow);
  }

  close(): void {
    this.db.close();
  }
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}

function mapTaskRow(row: Record<string, unknown>): TaskThread {
  let artifacts: string[] = [];
  if (typeof row.artifacts === "string") {
    try {
      artifacts = JSON.parse(row.artifacts) as string[];
    } catch {
      /* empty */
    }
  }

  let dependencies: string[] = [];
  if (typeof row.dependencies === "string") {
    try {
      dependencies = JSON.parse(row.dependencies) as string[];
    } catch {
      /* empty */
    }
  }

  let metadata: Record<string, unknown> | null = null;
  if (row.metadata && typeof row.metadata === "string") {
    try {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      /* empty */
    }
  }

  return {
    id: str(row.id),
    agentId: str(row.agent_id) || str(row.agentId),
    parentTaskId: typeof row.parent_task_id === "string" ? row.parent_task_id : null,
    objective: str(row.objective),
    status: (str(row.status) || "active") as TaskStatus,
    priority: (str(row.priority) || "medium") as TaskPriority,
    progressSummary: str(row.progress_summary) || str(row.progressSummary),
    artifacts,
    dependencies,
    lastHeartbeatAt: typeof row.last_heartbeat_at === "number" ? row.last_heartbeat_at : null,
    createdAt: num(row.created_at) || num(row.createdAt),
    updatedAt: num(row.updated_at) || num(row.updatedAt),
    completedAt: typeof row.completed_at === "number" ? row.completed_at : null,
    metadata,
  };
}

function mapLogRow(row: Record<string, unknown>): TaskLog {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata && typeof row.metadata === "string") {
    try {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      /* empty */
    }
  }

  return {
    id: str(row.id),
    taskId: str(row.task_id) || str(row.taskId),
    agentId: str(row.agent_id) || str(row.agentId),
    type: (str(row.type) || "progress") as TaskLogType,
    message: str(row.message),
    metadata,
    timestamp: num(row.timestamp),
  };
}
