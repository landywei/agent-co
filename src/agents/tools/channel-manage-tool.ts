import { Type } from "@sinclair/typebox";
import { getCompanyChannelStore } from "../../company-channels/index.js";
import { stringEnum } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const ACTIONS = ["create", "add_member", "remove_member", "list"] as const;

const ChannelManageToolSchema = Type.Object({
  action: stringEnum(ACTIONS),
  channel: Type.Optional(
    Type.String({
      description: "Channel name or ID (required for create/add_member/remove_member)",
    }),
  ),
  description: Type.Optional(Type.String({ description: "Channel description (for create)" })),
  memberId: Type.Optional(
    Type.String({ description: "Agent ID to add/remove (for add_member/remove_member)" }),
  ),
});

export function createChannelManageTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  const agentId = opts?.agentSessionKey
    ? opts.agentSessionKey.match(/^agent:([^:]+)/)?.[1]
    : undefined;

  return {
    label: "Channel Manage",
    name: "channel_manage",
    description:
      "Manage company channels: create new channels, add/remove members, or list all channels. " +
      "Use this to set up team communication structure.",
    parameters: ChannelManageToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const channel = readStringParam(params, "channel");

      try {
        const store = getCompanyChannelStore();

        if (action === "list") {
          const channels = store.listChannels();
          return jsonResult({
            status: "ok",
            channels: channels.map((ch) => ({
              id: ch.id,
              name: ch.name,
              type: ch.type,
              description: ch.description,
              memberCount: ch.memberCount,
            })),
          });
        }

        if (action === "create") {
          if (!channel) {
            throw new Error("channel name is required for create");
          }
          const description = readStringParam(params, "description") ?? "";
          const createdBy = agentId ?? "system";
          const created = store.createChannel({
            name: channel,
            type: "public",
            description,
            createdBy,
            members: [createdBy],
          });
          return jsonResult({
            status: "ok",
            action: "created",
            channel: { id: created.id, name: created.name },
          });
        }

        if (action === "add_member") {
          if (!channel) {
            throw new Error("channel is required for add_member");
          }
          const memberId = readStringParam(params, "memberId", { required: true });
          const resolved = store.resolveChannel(channel);
          if (!resolved) {
            throw new Error(`Channel not found: ${channel}`);
          }
          const added = store.addMember(resolved.id, memberId);
          return jsonResult({
            status: "ok",
            action: "member_added",
            channel: resolved.name,
            memberId,
            added,
          });
        }

        if (action === "remove_member") {
          if (!channel) {
            throw new Error("channel is required for remove_member");
          }
          const memberId = readStringParam(params, "memberId", { required: true });
          const resolved = store.resolveChannel(channel);
          if (!resolved) {
            throw new Error(`Channel not found: ${channel}`);
          }
          const removed = store.removeMember(resolved.id, memberId);
          return jsonResult({
            status: "ok",
            action: "member_removed",
            channel: resolved.name,
            memberId,
            removed,
          });
        }

        throw new Error(`Unknown action: ${action}`);
      } catch (err) {
        return jsonResult({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
