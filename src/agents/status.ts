import fs from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { loadSessionStore, resolveStorePath } from "../config/sessions.js";
import type { SessionEntry } from "../config/sessions/types.js";
import type { CronService } from "../cron/service.js";
import { getLastHeartbeatEvent } from "../infra/heartbeat-events.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { listAgentEntries, resolveDefaultAgentId } from "./agent-scope.js";
import { resolveAgentWorkspaceDir } from "./agent-scope.js";

export type AgentLiveness = "active" | "idle" | "stale" | "offline";

export interface AgentStatusEntry {
  id: string;
  name: string;
  emoji: string;
  layer: string;
  role: string;
  liveness: AgentLiveness;
  /** Last activity timestamp (most recent of session update, heartbeat, task heartbeat) */
  lastActivityAt: number | null;
  /** Next scheduled activity timestamp (from cron or heartbeat schedule) */
  nextActivityAt: number | null;
  /** Number of active task threads */
  activeTasks: number;
  /** Number of blocked task threads */
  blockedTasks: number;
  /** Total completed task threads */
  doneTasks: number;
  /** Session count */
  sessionCount: number;
  /** Most recent session age in ms */
  lastSessionAgeMs: number | null;
}

export interface OrgStatus {
  timestamp: number;
  defaultAgentId: string;
  agents: AgentStatusEntry[];
  totals: {
    total: number;
    active: number;
    idle: number;
    stale: number;
    offline: number;
  };
  heartbeat: {
    lastEvent: { ts: number; status: string } | null;
  };
  cron: {
    enabled: boolean;
    jobs: number;
    nextWakeAtMs: number | null;
  } | null;
}

/** 10 minutes without any activity = idle */
const IDLE_THRESHOLD_MS = 10 * 60 * 1000;
/** 30 minutes without any activity = stale */
const STALE_THRESHOLD_MS = 30 * 60 * 1000;

export async function resolveOrgStatus(opts: {
  config: OpenClawConfig;
  cronService?: CronService;
  taskStore?: import("../tasks/store.js").TaskStore;
}): Promise<OrgStatus> {
  const { config, cronService, taskStore } = opts;
  const now = Date.now();
  const defaultAgentId = normalizeAgentId(resolveDefaultAgentId(config));
  const entries = listAgentEntries(config);

  const sessionStores = new Map<string, Record<string, SessionEntry>>();
  for (const entry of entries) {
    try {
      const storePath = resolveStorePath(config.session?.store, { agentId: entry.id });
      const store = loadSessionStore(storePath);
      sessionStores.set(entry.id, store);
    } catch {
      /* agent may not have sessions yet */
    }
  }

  const taskSummaries = new Map<
    string,
    { active: number; blocked: number; done: number; lastHeartbeat: number | null }
  >();
  if (taskStore) {
    try {
      const agentSummaries = taskStore.getAgentSummaries();
      for (const s of agentSummaries) {
        taskSummaries.set(s.agentId, {
          active: s.active,
          blocked: s.blocked,
          done: s.done,
          lastHeartbeat: s.lastHeartbeat,
        });
      }
    } catch {
      /* task store may not be available */
    }
  }

  const lastHeartbeat = getLastHeartbeatEvent();

  let cronStatus: OrgStatus["cron"] = null;
  if (cronService) {
    try {
      const cs = await cronService.status();
      cronStatus = {
        enabled: cs.enabled,
        jobs: cs.jobs,
        nextWakeAtMs: cs.nextWakeAtMs,
      };
    } catch {
      /* cron may not be available */
    }
  }

  const agents: AgentStatusEntry[] = [];

  for (const entry of entries) {
    const agentId = entry.id;
    const identity = parseIdentityFile(config, agentId);

    const sessions = sessionStores.get(agentId) ?? {};
    const sessionEntries = Object.values(sessions);
    const sessionCount = sessionEntries.length;
    const mostRecent = sessionEntries.reduce<number | null>((max, s) => {
      if (!max || s.updatedAt > max) {
        return s.updatedAt;
      }
      return max;
    }, null);

    const taskData = taskSummaries.get(agentId);
    const taskHeartbeat = taskData?.lastHeartbeat ?? null;

    const candidates = [mostRecent, taskHeartbeat].filter((t): t is number => t !== null);
    const lastActivityAt = candidates.length > 0 ? Math.max(...candidates) : null;

    const ageMs = lastActivityAt ? now - lastActivityAt : null;
    let liveness: AgentLiveness;
    if (ageMs === null) {
      liveness = "offline";
    } else if (ageMs < IDLE_THRESHOLD_MS) {
      liveness = "active";
    } else if (ageMs < STALE_THRESHOLD_MS) {
      liveness = "idle";
    } else {
      liveness = "stale";
    }

    let nextActivityAt: number | null = null;
    if (cronStatus?.nextWakeAtMs) {
      nextActivityAt = cronStatus.nextWakeAtMs;
    }

    agents.push({
      id: agentId,
      name: identity.name || entry.name || agentId,
      emoji: identity.emoji || entry.identity?.emoji || "",
      layer: identity.layer || "",
      role: identity.role || "",
      liveness,
      lastActivityAt,
      nextActivityAt,
      activeTasks: taskData?.active ?? 0,
      blockedTasks: taskData?.blocked ?? 0,
      doneTasks: taskData?.done ?? 0,
      sessionCount,
      lastSessionAgeMs: mostRecent ? now - mostRecent : null,
    });
  }

  const totals = {
    total: agents.length,
    active: agents.filter((a) => a.liveness === "active").length,
    idle: agents.filter((a) => a.liveness === "idle").length,
    stale: agents.filter((a) => a.liveness === "stale").length,
    offline: agents.filter((a) => a.liveness === "offline").length,
  };

  return {
    timestamp: now,
    defaultAgentId,
    agents,
    totals,
    heartbeat: {
      lastEvent: lastHeartbeat ? { ts: lastHeartbeat.ts, status: lastHeartbeat.status } : null,
    },
    cron: cronStatus,
  };
}

function parseIdentityFile(
  config: OpenClawConfig,
  agentId: string,
): {
  name: string;
  emoji: string;
  layer: string;
  role: string;
} {
  const result = { name: "", emoji: "", layer: "", role: "" };
  try {
    const wsDir = resolveAgentWorkspaceDir(config, agentId);
    const idPath = path.join(wsDir, "IDENTITY.md");
    if (!fs.existsSync(idPath)) {
      return result;
    }
    const text = fs.readFileSync(idPath, "utf-8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\*\*(.+?)\*\*:\s*(.+)/);
      if (!m) {
        continue;
      }
      const key = m[1].toLowerCase().trim();
      const val = m[2].trim();
      if (key === "name") {
        result.name = val;
      } else if (key === "emoji") {
        result.emoji = val;
      } else if (key === "layer") {
        result.layer = val;
      } else if (key === "role") {
        result.role = val;
      }
    }
  } catch {
    /* workspace may not exist */
  }
  return result;
}
