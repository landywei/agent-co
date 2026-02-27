import path from "node:path";
import type { AgentMessage, StreamFn } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveUserPath } from "../utils.js";
import { safeJsonStringify } from "../utils/safe-json.js";
import { getQueuedFileWriter, type QueuedFileWriter } from "./queued-file-writer.js";

type LlmCallStage = "request" | "usage";

type LlmCallEvent = {
  ts: string;
  stage: LlmCallStage;
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  provider?: string;
  modelId?: string;
  modelApi?: string | null;
  workspaceDir?: string;
  /** Number of messages in the context sent to the model */
  messageCount?: number;
  /** Total character length of all messages (rough size indicator) */
  contextChars?: number;
  /** Whether a system prompt was included */
  hasSystemPrompt?: boolean;
  /** Number of tools available to the model */
  toolCount?: number;
  /** The HTTP request payload (when captured via onPayload) */
  payload?: unknown;
  usage?: Record<string, unknown>;
  error?: string;
};

const writers = new Map<string, QueuedFileWriter>();
const log = createSubsystemLogger("agent/llm-call-log");

function resolveLlmCallLogPath(env: NodeJS.ProcessEnv): string {
  const fileOverride = env.OPENCLAW_LLM_CALL_LOG_FILE?.trim();
  return fileOverride
    ? resolveUserPath(fileOverride)
    : path.join(resolveStateDir(env), "logs", "llm-calls.jsonl");
}

function getWriter(filePath: string): QueuedFileWriter {
  return getQueuedFileWriter(writers, filePath);
}

function formatError(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    return safeJsonStringify(error) ?? "unknown error";
  }
  return undefined;
}

function estimateContextSize(context: unknown): {
  messageCount: number;
  contextChars: number;
  hasSystemPrompt: boolean;
  toolCount: number;
} {
  const ctx = context as {
    messages?: unknown[];
    systemPrompt?: string;
    tools?: unknown[];
  };
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : [];
  const systemPrompt = typeof ctx?.systemPrompt === "string" ? ctx.systemPrompt : "";
  const tools = Array.isArray(ctx?.tools) ? ctx.tools : [];

  let contextChars = systemPrompt.length;
  for (const msg of messages) {
    const m = msg as { content?: unknown };
    if (typeof m?.content === "string") {
      contextChars += m.content.length;
    } else if (Array.isArray(m?.content)) {
      for (const block of m.content) {
        const b = block as { text?: string };
        if (typeof b?.text === "string") {
          contextChars += b.text.length;
        }
      }
    }
  }

  return {
    messageCount: messages.length,
    contextChars,
    hasSystemPrompt: systemPrompt.length > 0,
    toolCount: tools.length,
  };
}

function findLastAssistantUsage(messages: AgentMessage[]): Record<string, unknown> | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i] as { role?: unknown; usage?: unknown };
    if (msg?.role === "assistant" && msg.usage && typeof msg.usage === "object") {
      return msg.usage as Record<string, unknown>;
    }
  }
  return null;
}

export type LlmCallLogger = {
  wrapStreamFn: (streamFn: StreamFn) => StreamFn;
  recordUsage: (messages: AgentMessage[], error?: unknown) => void;
};

export function createLlmCallLogger(params: {
  env?: NodeJS.ProcessEnv;
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  provider?: string;
  modelId?: string;
  modelApi?: string | null;
  workspaceDir?: string;
}): LlmCallLogger {
  const env = params.env ?? process.env;
  const filePath = resolveLlmCallLogPath(env);
  const writer = getWriter(filePath);

  const base: Omit<LlmCallEvent, "ts" | "stage"> = {
    runId: params.runId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    provider: params.provider,
    modelId: params.modelId,
    modelApi: params.modelApi,
    workspaceDir: params.workspaceDir,
  };

  const record = (event: LlmCallEvent) => {
    const line = safeJsonStringify(event);
    if (!line) {
      return;
    }
    writer.write(`${line}\n`);
  };

  const wrapStreamFn: LlmCallLogger["wrapStreamFn"] = (streamFn) => {
    const wrapped: StreamFn = (model, context, options) => {
      const stats = estimateContextSize(context);
      const modelInfo = model as Model<Api> & { id?: string };

      record({
        ...base,
        ts: new Date().toISOString(),
        stage: "request",
        modelId: modelInfo?.id ?? params.modelId,
        messageCount: stats.messageCount,
        contextChars: stats.contextChars,
        hasSystemPrompt: stats.hasSystemPrompt,
        toolCount: stats.toolCount,
      });

      const nextOnPayload = (payload: unknown) => {
        record({
          ...base,
          ts: new Date().toISOString(),
          stage: "request",
          payload,
        });
        options?.onPayload?.(payload);
      };

      return streamFn(model, context, {
        ...options,
        onPayload: nextOnPayload,
      });
    };
    return wrapped;
  };

  const recordUsage: LlmCallLogger["recordUsage"] = (messages, error) => {
    const usage = findLastAssistantUsage(messages);
    const errorMessage = formatError(error);
    if (!usage && !errorMessage) {
      return;
    }
    record({
      ...base,
      ts: new Date().toISOString(),
      stage: "usage",
      usage: usage ?? undefined,
      error: errorMessage,
    });
  };

  log.info("llm call logger enabled", { filePath: writer.filePath });
  return { wrapStreamFn, recordUsage };
}
