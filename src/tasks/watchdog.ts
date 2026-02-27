import type { GatewayBroadcastFn } from "../gateway/server-broadcast.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { TaskStore } from "./store.js";

const log = createSubsystemLogger("task-watchdog");

/** 15 minutes without heartbeat = stale */
const DEFAULT_STALE_THRESHOLD_MS = 15 * 60 * 1000;

/** Check every 2 minutes */
const DEFAULT_CHECK_INTERVAL_MS = 2 * 60 * 1000;

export interface TaskWatchdog {
  stop(): void;
}

/**
 * Periodically scans for tasks that have gone stale (no heartbeat within threshold).
 * Emits events on the store and broadcasts to connected dashboard clients.
 */
export function startTaskWatchdog(
  store: TaskStore,
  broadcast: GatewayBroadcastFn,
  opts?: { staleThresholdMs?: number; checkIntervalMs?: number },
): TaskWatchdog {
  const staleThresholdMs = opts?.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
  const checkIntervalMs = opts?.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;

  const alerted = new Set<string>();

  function check(): void {
    try {
      const staleTasks = store.getStaleTasks(staleThresholdMs);

      for (const task of staleTasks) {
        if (alerted.has(task.id)) {
          continue;
        }
        alerted.add(task.id);

        const staleSinceMs = task.lastHeartbeatAt
          ? Date.now() - task.lastHeartbeatAt
          : Date.now() - task.createdAt;

        log.warn?.(
          `stale task detected: ${task.id} (agent=${task.agentId}, objective="${task.objective.slice(0, 80)}", stale for ${Math.round(staleSinceMs / 60_000)}m)`,
        );

        store.appendLog({
          taskId: task.id,
          agentId: "system",
          type: "error",
          message: `Task stale: no heartbeat for ${Math.round(staleSinceMs / 60_000)} minutes`,
          metadata: { staleSinceMs },
        });

        store.emit("event", {
          type: "task.stale",
          taskId: task.id,
          agentId: task.agentId,
          staleSinceMs,
        });

        broadcast("task.stale", {
          taskId: task.id,
          agentId: task.agentId,
          objective: task.objective,
          staleSinceMs,
        });
      }

      // Clear alerts for tasks that are no longer stale (heartbeat resumed or completed)
      const staleIds = new Set(staleTasks.map((t) => t.id));
      for (const id of alerted) {
        if (!staleIds.has(id)) {
          alerted.delete(id);
        }
      }
    } catch (err) {
      log.warn?.(`watchdog check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const interval = setInterval(check, checkIntervalMs);
  interval.unref();

  // Run first check shortly after startup
  const initialTimeout = setTimeout(check, 10_000);
  initialTimeout.unref();

  log.info?.(
    `task watchdog started (stale threshold: ${staleThresholdMs / 60_000}m, check interval: ${checkIntervalMs / 60_000}m)`,
  );

  return {
    stop() {
      clearInterval(interval);
      clearTimeout(initialTimeout);
      log.info?.("task watchdog stopped");
    },
  };
}
