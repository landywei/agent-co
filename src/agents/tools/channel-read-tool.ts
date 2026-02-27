import { Type } from "@sinclair/typebox";
import { getCompanyChannelStore } from "../../company-channels/index.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const ChannelReadToolSchema = Type.Object({
  channel: Type.String({ description: "Channel name or ID to read from" }),
  limit: Type.Optional(
    Type.Number({
      description: "Number of messages to retrieve (default: 20, max: 100)",
      minimum: 1,
      maximum: 100,
    }),
  ),
  threadId: Type.Optional(
    Type.String({ description: "Thread ID to read messages from (optional)" }),
  ),
});

export function createChannelReadTool(): AnyAgentTool {
  return {
    label: "Channel Read",
    name: "channel_read",
    description:
      "Read recent messages from a company channel. Use this to catch up on conversations " +
      "or check what others have said before responding.",
    parameters: ChannelReadToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const channel = readStringParam(params, "channel", { required: true });
      const limit = typeof params.limit === "number" ? Math.min(params.limit, 100) : 20;
      const threadId = readStringParam(params, "threadId");

      try {
        const store = getCompanyChannelStore();
        const resolved = store.resolveChannel(channel);
        if (!resolved) {
          throw new Error(`Channel not found: ${channel}`);
        }

        const messages = store.getMessages(resolved.id, {
          limit,
          threadId: threadId ?? undefined,
        });

        return jsonResult({
          status: "ok",
          channel: resolved.name,
          messageCount: messages.length,
          messages: messages.map((m) => ({
            from: m.senderId,
            text: m.text,
            time: new Date(m.timestamp).toISOString(),
            threadId: m.threadId,
          })),
        });
      } catch (err) {
        return jsonResult({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
