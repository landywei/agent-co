import { getCompanyChannelStore } from "../../company-channels/index.js";
import type { ChannelType, MemberRole } from "../../company-channels/types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function readString(params: Record<string, unknown>, key: string): string | undefined {
  const val = params[key];
  return typeof val === "string" ? val.trim() : undefined;
}

function readNumber(params: Record<string, unknown>, key: string): number | undefined {
  const val = params[key];
  return typeof val === "number" ? val : undefined;
}

export const companyChannelsHandlers: GatewayRequestHandlers = {
  "company.channels.list": async ({ params, respond }) => {
    try {
      const store = getCompanyChannelStore();
      const memberId = readString(params, "memberId");
      const channels = memberId ? store.listChannelsForMember(memberId) : store.listChannels();
      respond(true, { channels });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "company.channels.get": async ({ params, respond }) => {
    const channelId = readString(params, "channelId") ?? readString(params, "channel");
    if (!channelId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "channelId is required"));
      return;
    }
    try {
      const store = getCompanyChannelStore();
      const channel = store.getChannel(channelId);
      if (!channel) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `Channel not found: ${channelId}`),
        );
        return;
      }
      respond(true, { channel });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "company.channels.create": async ({ params, respond }) => {
    const name = readString(params, "name");
    if (!name) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "name is required"));
      return;
    }
    const type = (readString(params, "type") ?? "public") as ChannelType;
    if (!["public", "private", "dm"].includes(type)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `invalid type: ${type}`));
      return;
    }
    const description = readString(params, "description") ?? "";
    const createdBy = readString(params, "createdBy") ?? "system";
    const membersRaw = params.members;
    const members = Array.isArray(membersRaw)
      ? (membersRaw as unknown[]).filter((m): m is string => typeof m === "string")
      : [createdBy];

    try {
      const store = getCompanyChannelStore();
      const channel = store.createChannel({ name, type, description, createdBy, members });
      respond(true, { channel });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE constraint")) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `Channel "${name}" already exists`),
        );
        return;
      }
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, msg));
    }
  },

  "company.channels.delete": async ({ params, respond }) => {
    const channelId = readString(params, "channelId") ?? readString(params, "channel");
    if (!channelId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "channelId is required"));
      return;
    }
    try {
      const store = getCompanyChannelStore();
      const deleted = store.deleteChannel(channelId);
      respond(true, { deleted });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "company.channels.post": async ({ params, respond }) => {
    const channelId = readString(params, "channelId") ?? readString(params, "channel");
    if (!channelId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "channelId or channel is required"),
      );
      return;
    }
    const senderId = readString(params, "senderId") ?? readString(params, "from");
    if (!senderId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "senderId is required"));
      return;
    }
    const text = readString(params, "text") ?? readString(params, "message");
    if (!text) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "text is required"));
      return;
    }
    const threadId = readString(params, "threadId");
    try {
      const store = getCompanyChannelStore();
      const ch = store.resolveChannel(channelId);
      if (!ch) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `Channel not found: ${channelId}`),
        );
        return;
      }
      const message = store.postMessage({
        channelId: ch.id,
        senderId,
        text,
        threadId,
      });
      respond(true, { message });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "company.channels.history": async ({ params, respond }) => {
    const channelId = readString(params, "channelId") ?? readString(params, "channel");
    if (!channelId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "channelId is required"));
      return;
    }
    const limit = readNumber(params, "limit");
    const before = readNumber(params, "before");
    const threadId = readString(params, "threadId");
    try {
      const store = getCompanyChannelStore();
      const ch = store.resolveChannel(channelId);
      if (!ch) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `Channel not found: ${channelId}`),
        );
        return;
      }
      const messages = store.getMessages(ch.id, { limit, before, threadId });
      respond(true, { messages, channelId: ch.id });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "company.channels.members.add": async ({ params, respond }) => {
    const channelId = readString(params, "channelId") ?? readString(params, "channel");
    const memberId = readString(params, "memberId");
    if (!channelId || !memberId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "channelId and memberId are required"),
      );
      return;
    }
    const role = (readString(params, "role") ?? "member") as MemberRole;
    try {
      const store = getCompanyChannelStore();
      const ch = store.resolveChannel(channelId);
      if (!ch) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `Channel not found: ${channelId}`),
        );
        return;
      }
      const added = store.addMember(ch.id, memberId, role);
      respond(true, { added, channelId: ch.id, memberId });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "company.channels.members.remove": async ({ params, respond }) => {
    const channelId = readString(params, "channelId") ?? readString(params, "channel");
    const memberId = readString(params, "memberId");
    if (!channelId || !memberId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "channelId and memberId are required"),
      );
      return;
    }
    try {
      const store = getCompanyChannelStore();
      const ch = store.resolveChannel(channelId);
      if (!ch) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `Channel not found: ${channelId}`),
        );
        return;
      }
      const removed = store.removeMember(ch.id, memberId);
      respond(true, { removed, channelId: ch.id, memberId });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
