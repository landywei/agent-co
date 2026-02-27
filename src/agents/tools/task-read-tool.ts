import { Type } from "@sinclair/typebox";
import { getTaskStore } from "../../tasks/index.js";
import type { TaskStatus } from "../../tasks/types.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const TaskReadToolSchema = Type.Object({
  action: Type.String({
    description:
      'Action: "list" (list tasks), "detail" (get task detail + logs), "summary" (overall summary), "my_tasks" (your active tasks)',
  }),
  taskId: Type.Optional(Type.String({ description: "Task ID (required for detail)" })),
  agentId: Type.Optional(Type.String({ description: "Filter tasks by agent ID" })),
  status: Type.Optional(
    Type.String({
      description: 'Filter by status: "active", "blocked", "waiting", "done", "failed"',
    }),
  ),
});

export function createTaskReadTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  const selfAgentId = opts?.agentSessionKey ? extractAgentId(opts.agentSessionKey) : undefined;

  return {
    label: "Task Reader",
    name: "task_read",
    description:
      "Read task information. List tasks, view task details with logs, or get an organizational summary. " +
      "Use 'my_tasks' to see your own active work. Use 'summary' to see the overall company task status.",
    parameters: TaskReadToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      try {
        const store = getTaskStore();

        switch (action) {
          case "list": {
            const agentId = readStringParam(params, "agentId");
            const status = readStringParam(params, "status") as TaskStatus | undefined;
            const tasks = store.listTasks({ agentId, status, limit: 50 });
            return jsonResult({ status: "ok", count: tasks.length, tasks });
          }

          case "detail": {
            const taskId = readStringParam(params, "taskId", { required: true });
            const task = store.getTask(taskId);
            if (!task) {
              return jsonResult({ status: "error", error: `Task not found: ${taskId}` });
            }
            const logs = store.getLogs(taskId, { limit: 30 });
            const subtasks = store.getSubtasks(taskId);
            const deps = store.getDependencies(taskId);
            return jsonResult({ status: "ok", task, logs, subtasks, dependencies: deps });
          }

          case "summary": {
            const summary = store.getSummary();
            const agents = store.getAgentSummaries();
            return jsonResult({ status: "ok", summary, agents });
          }

          case "my_tasks": {
            const agentId = selfAgentId ?? readStringParam(params, "agentId") ?? "unknown";
            const active = store.listTasks({ agentId, status: "active" });
            const blocked = store.listTasks({ agentId, status: "blocked" });
            const waiting = store.listTasks({ agentId, status: "waiting" });
            return jsonResult({
              status: "ok",
              agentId,
              active,
              blocked,
              waiting,
              totalActive: active.length + blocked.length + waiting.length,
            });
          }

          default:
            return jsonResult({
              status: "error",
              error: `Unknown action: ${action}. Use: list, detail, summary, my_tasks`,
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
