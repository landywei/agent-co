import { Type } from "@sinclair/typebox";
import { getCompanyChannelStore } from "../../company-channels/index.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const ChannelPostToolSchema = Type.Object({
  channel: Type.String({ description: "Channel name or ID to post to" }),
  message: Type.String({ description: "Message text to post" }),
  threadId: Type.Optional(Type.String({ description: "Thread ID to reply in (optional)" })),
});

export function createChannelPostTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  const agentId = opts?.agentSessionKey ? extractAgentId(opts.agentSessionKey) : undefined;

  return {
    label: "Channel Post",
    name: "channel_post",
    description:
      "Post a message to a company channel. Use this to communicate with other team members. " +
      "All channel members will see your message.",
    parameters: ChannelPostToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const channel = readStringParam(params, "channel", { required: true });
      const message = readStringParam(params, "message", { required: true });
      const threadId = readStringParam(params, "threadId");
      const senderId = agentId ?? "unknown";

      try {
        const store = getCompanyChannelStore();
        const resolved = store.resolveChannel(channel);
        if (!resolved) {
          throw new Error(`Channel not found: ${channel}`);
        }

        const posted = store.postMessage({
          channelId: resolved.id,
          senderId,
          text: message,
          threadId: threadId ?? undefined,
        });
        return jsonResult({
          status: "ok",
          messageId: posted.id,
          channel: resolved.name,
          senderId,
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

function extractAgentId(sessionKey: string): string | undefined {
  const match = sessionKey.match(/^agent:([^:]+)/);
  return match?.[1];
}
