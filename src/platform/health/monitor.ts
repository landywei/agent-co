import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { ContainerManager } from "../containers/manager.js";
import type { PlatformDb } from "../db/index.js";

const log = createSubsystemLogger("platform:health");

export interface HealthMonitorConfig {
  checkIntervalMs: number;
  unhealthyThreshold: number;
  autoRestart: boolean;
}

export interface HealthMonitor {
  start(): void;
  stop(): void;
  checkAll(): Promise<HealthCheckResult[]>;
}

export interface HealthCheckResult {
  orgId: string;
  healthy: boolean;
  consecutiveFailures: number;
  lastCheck: Date;
  action?: "restarted" | "marked_unhealthy";
}

export function createHealthMonitor(
  db: PlatformDb,
  containers: ContainerManager,
  config: HealthMonitorConfig,
): HealthMonitor {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  const failureCounts = new Map<string, number>();

  async function checkOrg(orgId: string): Promise<HealthCheckResult> {
    const healthy = await containers.healthCheck(orgId);
    const now = new Date();

    if (healthy) {
      failureCounts.set(orgId, 0);
      return { orgId, healthy: true, consecutiveFailures: 0, lastCheck: now };
    }

    const failures = (failureCounts.get(orgId) || 0) + 1;
    failureCounts.set(orgId, failures);

    const result: HealthCheckResult = {
      orgId,
      healthy: false,
      consecutiveFailures: failures,
      lastCheck: now,
    };

    if (failures >= config.unhealthyThreshold) {
      if (config.autoRestart) {
        try {
          log.warn(`Auto-restarting unhealthy org container: ${orgId} (${failures} failures)`);
          await containers.restart(orgId);
          failureCounts.set(orgId, 0);
          result.action = "restarted";
        } catch (error) {
          log.error(`Failed to auto-restart org ${orgId}: ${String(error)}`);
          await db.containers.updateStatus(orgId, "error", `Health check failed ${failures} times`);
          await db.orgs.updateStatus(orgId, "error");
          result.action = "marked_unhealthy";
        }
      } else {
        await db.containers.updateStatus(orgId, "error", `Health check failed ${failures} times`);
        await db.orgs.updateStatus(orgId, "error");
        result.action = "marked_unhealthy";
      }
    }

    return result;
  }

  async function runHealthChecks(): Promise<HealthCheckResult[]> {
    const runningContainers = await db.containers.listByStatus("running");
    const results: HealthCheckResult[] = [];

    for (const container of runningContainers) {
      try {
        const result = await checkOrg(container.orgId);
        results.push(result);
      } catch (error) {
        log.error(`Health check error for org ${container.orgId}: ${String(error)}`);
      }
    }

    return results;
  }

  return {
    start() {
      if (intervalId) {
        return;
      }

      log.info(`Starting health monitor (interval: ${config.checkIntervalMs}ms)`);
      intervalId = setInterval(() => {
        runHealthChecks().catch((error) => {
          log.error(`Health check cycle failed: ${String(error)}`);
        });
      }, config.checkIntervalMs);
    },

    stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        log.info("Health monitor stopped");
      }
    },

    async checkAll() {
      return runHealthChecks();
    },
  };
}
