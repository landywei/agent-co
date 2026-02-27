import { Type } from "@sinclair/typebox";
import { getTaskStore } from "../../tasks/index.js";
import type { TaskLogType, TaskPriority, TaskStatus } from "../../tasks/types.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const TaskManageToolSchema = Type.Object({
  action: Type.String({
    description: 'Action to perform: "create", "update", "heartbeat", "log", or "complete"',
  }),
  taskId: Type.Optional(
    Type.String({ description: "Task ID (required for update/heartbeat/log/complete)" }),
  ),
  objective: Type.Optional(Type.String({ description: "Task objective (required for create)" })),
  parentTaskId: Type.Optional(Type.String({ description: "Parent task ID for subtasks" })),
  status: Type.Optional(
    Type.String({ description: 'New status: "active", "blocked", "waiting", "done", "failed"' }),
  ),
  priority: Type.Optional(
    Type.String({ description: 'Priority: "critical", "high", "medium", "low"' }),
  ),
  progressSummary: Type.Optional(Type.String({ description: "Summary of current progress" })),
  message: Type.Optional(Type.String({ description: "Log message (for log/heartbeat actions)" })),
  logType: Type.Optional(
    Type.String({
      description: 'Log entry type: "progress", "checkpoint", "error", "blocked", "unblocked"',
    }),
  ),
});

export function createTaskManageTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  const agentId = opts?.agentSessionKey ? extractAgentId(opts.agentSessionKey) : undefined;

  return {
    label: "Task Manager",
    name: "task_manage",
    description:
      "Manage your task threads. Create new tasks, update progress, send heartbeats, and log decisions. " +
      "Use heartbeats regularly while working on long tasks so the system knows you are active. " +
      "Use 'log' to record important decisions and checkpoints.",
    parameters: TaskManageToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const senderId = agentId ?? "unknown";

      try {
        const store = getTaskStore();

        switch (action) {
          case "create": {
            const objective = readStringParam(params, "objective", { required: true });
            const parentTaskId = readStringParam(params, "parentTaskId");
            const priority = readStringParam(params, "priority") as TaskPriority | undefined;

            const task = store.createTask({
              agentId: senderId,
              objective,
              parentTaskId,
              priority,
            });
            return jsonResult({ status: "ok", action: "created", task });
          }

          case "update": {
            const taskId = readStringParam(params, "taskId", { required: true });
            const status = readStringParam(params, "status") as TaskStatus | undefined;
            const priority = readStringParam(params, "priority") as TaskPriority | undefined;
            const progressSummary = readStringParam(params, "progressSummary");

            const task = store.updateTask(taskId, {
              ...(status && { status }),
              ...(priority && { priority }),
              ...(progressSummary && { progressSummary }),
            });
            if (!task) {
              return jsonResult({ status: "error", error: `Task not found: ${taskId}` });
            }

            if (progressSummary) {
              store.appendLog({
                taskId,
                agentId: senderId,
                type: "progress",
                message: progressSummary,
              });
            }
            return jsonResult({ status: "ok", action: "updated", task });
          }

          case "heartbeat": {
            const taskId = readStringParam(params, "taskId", { required: true });
            const message = readStringParam(params, "message") ?? "still working";
            store.heartbeat(taskId, senderId, message);
            return jsonResult({ status: "ok", action: "heartbeat", taskId });
          }

          case "log": {
            const taskId = readStringParam(params, "taskId", { required: true });
            const message = readStringParam(params, "message", { required: true });
            const logType = (readStringParam(params, "logType") ?? "progress") as TaskLogType;

            const logEntry = store.appendLog({
              taskId,
              agentId: senderId,
              type: logType,
              message,
            });
            return jsonResult({ status: "ok", action: "logged", log: logEntry });
          }

          case "complete": {
            const taskId = readStringParam(params, "taskId", { required: true });
            const progressSummary = readStringParam(params, "progressSummary") ?? "Task completed";
            const status = (readStringParam(params, "status") ?? "done") as TaskStatus;

            const task = store.updateTask(taskId, { status, progressSummary });
            if (!task) {
              return jsonResult({ status: "error", error: `Task not found: ${taskId}` });
            }

            store.appendLog({
              taskId,
              agentId: senderId,
              type: status === "failed" ? "failed" : "completed",
              message: progressSummary,
            });
            return jsonResult({ status: "ok", action: "completed", task });
          }

          default:
            return jsonResult({
              status: "error",
              error: `Unknown action: ${action}. Use: create, update, heartbeat, log, complete`,
            });
        }
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
