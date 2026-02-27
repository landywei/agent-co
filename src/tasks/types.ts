export type TaskStatus = "active" | "blocked" | "waiting" | "done" | "failed";

export type TaskPriority = "critical" | "high" | "medium" | "low";

export type TaskLogType =
  | "created"
  | "updated"
  | "progress"
  | "checkpoint"
  | "error"
  | "heartbeat"
  | "blocked"
  | "unblocked"
  | "completed"
  | "failed"
  | "reassigned";

export interface TaskThread {
  id: string;
  agentId: string;
  /** Optional reference to a parent OKR or higher-level objective */
  parentTaskId: string | null;
  objective: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Free-form summary of current progress */
  progressSummary: string;
  /** Serialized list of artifact paths or references produced so far */
  artifacts: string[];
  /** Agent IDs this task depends on (blocks until those agents deliver) */
  dependencies: string[];
  /** Last heartbeat timestamp — agents post heartbeats while working */
  lastHeartbeatAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** When the task finished (done or failed) */
  completedAt: number | null;
  /** Optional structured metadata (agent can store anything) */
  metadata: Record<string, unknown> | null;
}

export interface TaskLog {
  id: string;
  taskId: string;
  agentId: string;
  type: TaskLogType;
  message: string;
  metadata: Record<string, unknown> | null;
  timestamp: number;
}

export interface TaskDependency {
  taskId: string;
  dependsOnTaskId: string;
  createdAt: number;
}

export type TaskEvent =
  | { type: "task.created"; task: TaskThread }
  | { type: "task.updated"; task: TaskThread; changes: Partial<TaskThread> }
  | { type: "task.log"; log: TaskLog }
  | { type: "task.heartbeat"; taskId: string; agentId: string; timestamp: number }
  | { type: "task.stale"; taskId: string; agentId: string; staleSinceMs: number }
  | { type: "task.completed"; task: TaskThread }
  | { type: "task.failed"; task: TaskThread; reason: string };

export interface TaskSummary {
  total: number;
  active: number;
  blocked: number;
  waiting: number;
  done: number;
  failed: number;
  stale: number;
}

export interface AgentTaskSummary {
  agentId: string;
  active: number;
  blocked: number;
  done: number;
  failed: number;
  lastHeartbeat: number | null;
}
