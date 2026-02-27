import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import {
  applyAgentConfig,
  findAgentEntryIndex,
  listAgentEntries,
} from "../../commands/agents.config.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
import { resolveSessionTranscriptsDirForAgent } from "../../config/sessions/paths.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import { DEFAULT_AGENT_ID, normalizeAgentId } from "../../routing/session-key.js";
import { resolveUserPath } from "../../utils.js";
import { resolveAgentDir } from "../agent-scope.js";
import { DEFAULT_IDENTITY_FILENAME, ensureAgentWorkspace } from "../workspace.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const AgentsCreateToolSchema = Type.Object({
  name: Type.String({
    description:
      "Name/ID for the new agent (e.g. 'researcher', 'engineer'). " +
      "Will be normalized to lowercase alphanumeric.",
  }),
  workspace: Type.Optional(
    Type.String({
      description: "Workspace directory path. Defaults to ~/.openclaw/workspace-{name}.",
    }),
  ),
});

export function createAgentsCreateTool(): AnyAgentTool {
  return {
    label: "Hire Agent",
    name: "agents_create",
    description:
      "Hire (create) a new agent. This registers the agent in the gateway config, " +
      "creates its workspace with default files, and auto-restarts the gateway so " +
      "the agent becomes available. After hiring, add the agent to channels and " +
      "write instructions to their workspace SOUL.md via file tools.",
    parameters: AgentsCreateToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const rawName = readStringParam(params, "name", { required: true });
      const workspaceParam = readStringParam(params, "workspace");

      try {
        const agentId = normalizeAgentId(rawName);
        if (agentId === DEFAULT_AGENT_ID) {
          return jsonResult({ status: "error", error: `"${DEFAULT_AGENT_ID}" is reserved` });
        }

        const cfg = loadConfig();
        if (findAgentEntryIndex(listAgentEntries(cfg), agentId) >= 0) {
          return jsonResult({ status: "error", error: `agent "${agentId}" already exists` });
        }

        const workspaceDir = resolveUserPath(
          workspaceParam?.trim() || `~/.openclaw/workspace-${agentId}`,
        );

        let nextConfig = applyAgentConfig(cfg, {
          agentId,
          name: rawName,
          workspace: workspaceDir,
        });
        const agentDir = resolveAgentDir(nextConfig, agentId);
        nextConfig = applyAgentConfig(nextConfig, { agentId, agentDir });

        const skipBootstrap = Boolean(nextConfig.agents?.defaults?.skipBootstrap);
        await ensureAgentWorkspace({ dir: workspaceDir, ensureBootstrapFiles: !skipBootstrap });
        await fs.mkdir(resolveSessionTranscriptsDirForAgent(agentId), { recursive: true });
        await writeConfigFile(nextConfig);

        const identityPath = path.join(workspaceDir, DEFAULT_IDENTITY_FILENAME);
        const lines = ["", `- Name: ${rawName.replace(/\s+/g, " ").trim()}`, ""];
        await fs.appendFile(identityPath, lines.join("\n"), "utf-8");

        scheduleGatewaySigusr1Restart({
          delayMs: 2000,
          reason: `agent created: ${rawName}`,
        });

        return jsonResult({
          status: "ok",
          agentId,
          name: rawName,
          workspace: workspaceDir,
          note:
            "Agent created. Gateway will restart in ~2s to load the new agent. " +
            "After restart, add the agent to channels with channel_manage or " +
            "write their SOUL.md to define their role.",
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
