import { getTaskStore } from "../../tasks/index.js";
import type { TaskPriority, TaskStatus } from "../../tasks/types.js";
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

const VALID_STATUSES = new Set(["active", "blocked", "waiting", "done", "failed"]);
const VALID_PRIORITIES = new Set(["critical", "high", "medium", "low"]);

export const taskHandlers: GatewayRequestHandlers = {
  "tasks.create": async ({ params, respond, context }) => {
    const agentId = readString(params, "agentId");
    const objective = readString(params, "objective");
    if (!agentId || !objective) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "agentId and objective are required"),
      );
      return;
    }
    const priority = readString(params, "priority") as TaskPriority | undefined;
    if (priority && !VALID_PRIORITIES.has(priority)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `invalid priority: ${priority}`),
      );
      return;
    }
    const parentTaskId = readString(params, "parentTaskId");
    const depsRaw = params.dependencies;
    const dependencies = Array.isArray(depsRaw)
      ? (depsRaw as unknown[]).filter((d): d is string => typeof d === "string")
      : undefined;

    let metadata: Record<string, unknown> | undefined;
    if (params.metadata && typeof params.metadata === "object" && !Array.isArray(params.metadata)) {
      metadata = params.metadata as Record<string, unknown>;
    }

    try {
      const store = getTaskStore();
      const task = store.createTask({
        agentId,
        objective,
        parentTaskId,
        priority,
        dependencies,
        metadata,
      });
      context.broadcast("task.created", { task });
      respond(true, { task });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "tasks.get": async ({ params, respond }) => {
    const taskId = readString(params, "taskId");
    if (!taskId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "taskId is required"));
      return;
    }
    try {
      const store = getTaskStore();
      const task = store.getTask(taskId);
      if (!task) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `Task not found: ${taskId}`),
        );
        return;
      }
      const logs = store.getLogs(taskId, { limit: 20 });
      const subtasks = store.getSubtasks(taskId);
      respond(true, { task, logs, subtasks });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "tasks.update": async ({ params, respond, context }) => {
    const taskId = readString(params, "taskId");
    if (!taskId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "taskId is required"));
      return;
    }
    const status = readString(params, "status") as TaskStatus | undefined;
    if (status && !VALID_STATUSES.has(status)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `invalid status: ${status}`),
      );
      return;
    }
    const priority = readString(params, "priority") as TaskPriority | undefined;
    if (priority && !VALID_PRIORITIES.has(priority)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `invalid priority: ${priority}`),
      );
      return;
    }

    const updates: Record<string, unknown> = {};
    if (status) {
      updates.status = status;
    }
    if (priority) {
      updates.priority = priority;
    }
    const progressSummary = readString(params, "progressSummary");
    if (progressSummary !== undefined) {
      updates.progressSummary = progressSummary;
    }
    const objective = readString(params, "objective");
    if (objective !== undefined) {
      updates.objective = objective;
    }
    const agentId = readString(params, "agentId");
    if (agentId !== undefined) {
      updates.agentId = agentId;
    }

    const artifactsRaw = params.artifacts;
    if (Array.isArray(artifactsRaw)) {
      updates.artifacts = (artifactsRaw as unknown[]).filter(
        (a): a is string => typeof a === "string",
      );
    }

    if (params.metadata && typeof params.metadata === "object" && !Array.isArray(params.metadata)) {
      updates.metadata = params.metadata as Record<string, unknown>;
    }

    try {
      const store = getTaskStore();
      const task = store.updateTask(taskId, updates);
      if (!task) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `Task not found: ${taskId}`),
        );
        return;
      }
      context.broadcast("task.updated", { task });
      respond(true, { task });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "tasks.list": async ({ params, respond }) => {
    const agentId = readString(params, "agentId");
    const status = readString(params, "status") as TaskStatus | undefined;
    const parentTaskId = readString(params, "parentTaskId");
    const limit = readNumber(params, "limit");

    try {
      const store = getTaskStore();
      const tasks = store.listTasks({ agentId, status, parentTaskId, limit });
      respond(true, { tasks });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "tasks.logs": async ({ params, respond }) => {
    const taskId = readString(params, "taskId");
    if (!taskId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "taskId is required"));
      return;
    }
    const limit = readNumber(params, "limit");
    const before = readNumber(params, "before");

    try {
      const store = getTaskStore();
      const logs = store.getLogs(taskId, { limit, before });
      respond(true, { logs });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "tasks.log": async ({ params, respond, context }) => {
    const taskId = readString(params, "taskId");
    const agentId = readString(params, "agentId");
    const type = readString(params, "type");
    const message = readString(params, "message");
    if (!taskId || !agentId || !message) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "taskId, agentId, and message are required"),
      );
      return;
    }

    let metadata: Record<string, unknown> | undefined;
    if (params.metadata && typeof params.metadata === "object" && !Array.isArray(params.metadata)) {
      metadata = params.metadata as Record<string, unknown>;
    }

    try {
      const store = getTaskStore();
      const logEntry = store.appendLog({
        taskId,
        agentId,
        type: (type ?? "progress") as import("../../tasks/types.js").TaskLogType,
        message,
        metadata,
      });
      context.broadcast("task.log", { log: logEntry });
      respond(true, { log: logEntry });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "tasks.heartbeat": async ({ params, respond }) => {
    const taskId = readString(params, "taskId");
    const agentId = readString(params, "agentId");
    if (!taskId || !agentId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "taskId and agentId are required"),
      );
      return;
    }
    const message = readString(params, "message");

    try {
      const store = getTaskStore();
      store.heartbeat(taskId, agentId, message);
      respond(true, { ok: true });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "tasks.summary": async ({ respond }) => {
    try {
      const store = getTaskStore();
      const summary = store.getSummary();
      const agents = store.getAgentSummaries();
      respond(true, { summary, agents });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
