import path from "node:path";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { TaskStore } from "./store.js";

export { TaskStore } from "./store.js";
export type {
  AgentTaskSummary,
  TaskDependency,
  TaskEvent,
  TaskLog,
  TaskLogType,
  TaskPriority,
  TaskStatus,
  TaskSummary,
  TaskThread,
} from "./types.js";

let _store: TaskStore | null = null;

export function getTaskStore(): TaskStore {
  if (!_store) {
    const homeDir = resolveRequiredHomeDir();
    const dbPath = path.join(homeDir, ".openclaw", "company", "tasks.db");
    _store = new TaskStore(dbPath);
  }
  return _store;
}

export function closeTaskStore(): void {
  if (_store) {
    _store.close();
    _store = null;
  }
}
