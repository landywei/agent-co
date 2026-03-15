import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { ContainerManager } from "../containers/manager.js";
import type { OrgId } from "../types.js";

const log = createSubsystemLogger("platform:claude-code");

export interface ClaudeCodeToolConfig {
  defaultTimeout: number;
  maxTimeout: number;
}

export interface ClaudeCodeRequest {
  task: string;
  workingDirectory?: string;
  timeout?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
}

export interface ClaudeCodeResult {
  success: boolean;
  exitCode: number;
  output: string;
  filesChanged: string[];
  summary: string;
  error?: string;
}

export interface ClaudeCodeTool {
  execute(orgId: OrgId, request: ClaudeCodeRequest): Promise<ClaudeCodeResult>;
  isAvailable(orgId: OrgId): Promise<boolean>;
}

export function createClaudeCodeTool(
  containers: ContainerManager,
  config: ClaudeCodeToolConfig,
): ClaudeCodeTool {
  return {
    async execute(orgId, request) {
      log.info(`Executing Claude Code task for org ${orgId}: ${request.task.slice(0, 100)}...`);

      const _timeout = Math.min(request.timeout || config.defaultTimeout, config.maxTimeout);

      const args = ["claude", "-p", request.task, "--output-format", "json"];

      if (request.workingDirectory) {
        args.push("--cwd", request.workingDirectory);
      }

      if (request.allowedTools?.length) {
        args.push("--allowedTools", request.allowedTools.join(","));
      }

      if (request.disallowedTools?.length) {
        args.push("--disallowedTools", request.disallowedTools.join(","));
      }

      try {
        const result = await containers.exec(orgId, args);

        let output: {
          result?: string;
          files_changed?: string[];
          summary?: string;
          error?: string;
        } = {};

        try {
          output = JSON.parse(result.stdout);
        } catch {
          output = { result: result.stdout };
        }

        const success = result.exitCode === 0;

        log.info(`Claude Code task completed for org ${orgId}: exitCode=${result.exitCode}`);

        return {
          success,
          exitCode: result.exitCode,
          output: output.result || result.stdout,
          filesChanged: output.files_changed || [],
          summary: output.summary || (success ? "Task completed" : "Task failed"),
          error: success ? undefined : output.error || result.stderr,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`Claude Code task failed for org ${orgId}: ${message}`);

        return {
          success: false,
          exitCode: 1,
          output: "",
          filesChanged: [],
          summary: "Task execution failed",
          error: message,
        };
      }
    },

    async isAvailable(orgId) {
      try {
        const result = await containers.exec(orgId, ["which", "claude"]);
        return result.exitCode === 0;
      } catch {
        return false;
      }
    },
  };
}

export function createClaudeCodeToolSchema() {
  return {
    name: "claude_code",
    description:
      "Execute a coding task using Claude Code. The task will be performed autonomously " +
      "with access to read/write files and run commands in the organization's workspace.",
    inputSchema: {
      type: "object" as const,
      properties: {
        task: {
          type: "string",
          description: "The coding task to perform. Be specific about what you want done.",
        },
        workingDirectory: {
          type: "string",
          description: "Optional working directory relative to the workspace root.",
        },
        timeout: {
          type: "number",
          description: "Optional timeout in milliseconds (default: 5 minutes, max: 30 minutes).",
        },
        allowedTools: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of tools to allow (e.g., ['read', 'write', 'bash']).",
        },
        disallowedTools: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of tools to disallow.",
        },
      },
      required: ["task"],
    },
  };
}
