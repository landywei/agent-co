import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { PlatformDb } from "../db/index.js";
import type { Org, OrgContainer, OrgId, OrgSettings } from "../types.js";

const log = createSubsystemLogger("platform:containers");

export interface ContainerManagerConfig {
  dockerSocket?: string;
  networkName: string;
  baseImage: string;
  portRangeStart: number;
  portRangeEnd: number;
  dataDir: string;
  cpuLimit?: string;
  memoryLimit?: string;
  configBackupPath?: string;
}

export interface ContainerManager {
  provision(org: Org): Promise<OrgContainer>;
  start(orgId: OrgId): Promise<OrgContainer>;
  stop(orgId: OrgId): Promise<void>;
  remove(orgId: OrgId): Promise<void>;
  restart(orgId: OrgId): Promise<OrgContainer>;
  getStatus(orgId: OrgId): Promise<OrgContainer | null>;
  healthCheck(orgId: OrgId): Promise<boolean>;
  listAll(): Promise<OrgContainer[]>;
  exec(
    orgId: OrgId,
    command: string[],
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  getLogs(orgId: OrgId, tail?: number): Promise<string>;
}

interface DockerContainer {
  Id: string;
  State: {
    Status: string;
    Running: boolean;
    ExitCode: number;
  };
  NetworkSettings: {
    Ports: Record<string, Array<{ HostPort: string }> | null>;
  };
}

export async function createContainerManager(
  db: PlatformDb,
  config: ContainerManagerConfig,
): Promise<ContainerManager> {
  const { spawn } = await import("node:child_process");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const usedPorts = new Set<number>();

  async function docker(...args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });
      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Docker command failed: ${stderr || stdout}`));
        }
      });
      proc.on("error", reject);
    });
  }

  async function findAvailablePort(): Promise<number> {
    const containers = await db.containers.listAll();
    for (const c of containers) {
      usedPorts.add(c.port);
    }

    for (let port = config.portRangeStart; port <= config.portRangeEnd; port++) {
      if (!usedPorts.has(port)) {
        usedPorts.add(port);
        return port;
      }
    }
    throw new Error("No available ports in range");
  }

  function containerName(orgId: OrgId): string {
    return `openclaw-org-${orgId}`;
  }

  async function ensureNetwork(): Promise<void> {
    try {
      await docker("network", "inspect", config.networkName);
    } catch {
      await docker("network", "create", config.networkName);
      log.info(`Created Docker network: ${config.networkName}`);
    }
  }

  async function ensureOrgDataDir(orgId: OrgId): Promise<string> {
    const orgDataDir = path.join(config.dataDir, orgId);
    const openclawDir = path.join(orgDataDir, ".openclaw");
    const workspaceDir = path.join(openclawDir, "workspace");
    const skillsDir = path.join(openclawDir, "skills");

    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(skillsDir, { recursive: true });

    // Set ownership to node user (uid 1000) so org containers can write
    // The org container runs as 'node' user which has uid 1000
    try {
      const { spawn } = await import("node:child_process");
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("chown", ["-R", "1000:1000", openclawDir]);
        proc.on("close", (code) =>
          code === 0 ? resolve() : reject(new Error(`chown failed with code ${code}`)),
        );
        proc.on("error", reject);
      });
    } catch (error) {
      log.warn(`Failed to set ownership for org ${orgId}: ${String(error)}`);
    }

    // Copy config-backup.json to org's openclaw.json (like reset-company.sh does)
    const configBackupPath =
      config.configBackupPath || path.join(process.cwd(), "config-backup.json");
    const orgConfigPath = path.join(openclawDir, "openclaw.json");

    try {
      const backupExists = await fs
        .stat(configBackupPath)
        .then(() => true)
        .catch(() => false);
      if (backupExists) {
        const backupContent = await fs.readFile(configBackupPath, "utf-8");
        const backup = JSON.parse(backupContent);

        // Transform config-backup.json format to openclaw.json format (same as reset-company.sh)
        const cfg: Record<string, unknown> = {};

        if (backup.models) {
          cfg.models = { providers: {} };
          for (const [k, v] of Object.entries(backup.models.providers || {})) {
            (cfg.models as Record<string, unknown>).providers = {
              ...((cfg.models as Record<string, unknown>).providers as Record<string, unknown>),
              [k]: v,
            };
          }
        }

        // Copy all other keys using dot-notation path setting
        for (const [k, v] of Object.entries(backup)) {
          if (k === "models") {
            continue;
          }
          setNestedPath(cfg, k, v);
        }

        await fs.writeFile(orgConfigPath, JSON.stringify(cfg, null, 2) + "\n");
        log.info(`Created openclaw.json for org ${orgId} from config-backup.json`);
      } else {
        // Create minimal config if no backup exists
        const minimalConfig = {
          gateway: { mode: "local" },
        };
        await fs.writeFile(orgConfigPath, JSON.stringify(minimalConfig, null, 2) + "\n");
        log.warn(`No config-backup.json found, created minimal config for org ${orgId}`);
      }
    } catch (error) {
      log.error(`Failed to create config for org ${orgId}: ${String(error)}`);
      // Create minimal config as fallback
      const minimalConfig = { gateway: { mode: "local" } };
      await fs.writeFile(orgConfigPath, JSON.stringify(minimalConfig, null, 2) + "\n");
    }

    return orgDataDir;
  }

  function setNestedPath(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split(".");
    let cur: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") {
        cur[parts[i]] = {};
      }
      cur = cur[parts[i]] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = value;
  }

  function buildEnvVars(settings: OrgSettings): string[] {
    const envVars: string[] = [
      "-e",
      "HOME=/home/node",
      "-e",
      "TERM=xterm-256color",
      "-e",
      "OPENCLAW_ALLOW_INSECURE_CONTROL_UI=1",
    ];

    if (settings.gatewayToken) {
      envVars.push("-e", `OPENCLAW_GATEWAY_TOKEN=${settings.gatewayToken}`);
    }
    if (settings.anthropicApiKey) {
      envVars.push("-e", `ANTHROPIC_API_KEY=${settings.anthropicApiKey}`);
    }
    if (settings.openaiApiKey) {
      envVars.push("-e", `OPENAI_API_KEY=${settings.openaiApiKey}`);
    }

    return envVars;
  }

  return {
    async provision(org) {
      log.info(`Provisioning container for org: ${org.id}`);

      await ensureNetwork();
      const port = await findAvailablePort();
      const orgDataDir = await ensureOrgDataDir(org.id);
      const name = containerName(org.id);

      const envVars = buildEnvVars(org.settings);
      const resourceLimits: string[] = [];
      if (config.cpuLimit) {
        resourceLimits.push("--cpus", config.cpuLimit);
      }
      if (config.memoryLimit) {
        resourceLimits.push("--memory", config.memoryLimit);
      }

      const containerId = await docker(
        "create",
        "--name",
        name,
        "--network",
        config.networkName,
        "-p",
        `${port}:18789`,
        "-v",
        `${orgDataDir}/.openclaw:/home/node/.openclaw`,
        "-v",
        `${orgDataDir}/.openclaw/workspace:/home/node/.openclaw/workspace`,
        ...envVars,
        ...resourceLimits,
        "--restart",
        "unless-stopped",
        "--init",
        config.baseImage,
        "node",
        "dist/index.js",
        "gateway",
        "--bind",
        "lan",
        "--port",
        "18789",
      );

      const container: OrgContainer = {
        orgId: org.id,
        containerId: containerId.trim(),
        port,
        status: "starting",
        lastHealthCheck: null,
        errorMessage: null,
      };

      await db.containers.upsert(container);
      await db.orgs.update(org.id, {
        containerId: container.containerId,
        containerPort: port,
        status: "provisioning",
      });

      log.info(`Container provisioned for org ${org.id}: ${container.containerId} on port ${port}`);
      return container;
    },

    async start(orgId) {
      const container = await db.containers.findByOrgId(orgId);
      if (!container) {
        throw new Error(`No container found for org: ${orgId}`);
      }

      log.info(`Starting container for org: ${orgId}`);
      await docker("start", container.containerId);

      await db.containers.updateStatus(orgId, "running");
      await db.orgs.updateStatus(orgId, "running");

      log.info(`Container started for org: ${orgId}`);
      return { ...container, status: "running" as const };
    },

    async stop(orgId) {
      const container = await db.containers.findByOrgId(orgId);
      if (!container) {
        throw new Error(`No container found for org: ${orgId}`);
      }

      log.info(`Stopping container for org: ${orgId}`);
      await db.containers.updateStatus(orgId, "stopping");

      try {
        await docker("stop", "-t", "30", container.containerId);
        await db.containers.updateStatus(orgId, "stopped");
        await db.orgs.updateStatus(orgId, "stopped");
        log.info(`Container stopped for org: ${orgId}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await db.containers.updateStatus(orgId, "error", message);
        await db.orgs.updateStatus(orgId, "error");
        throw error;
      }
    },

    async remove(orgId) {
      const container = await db.containers.findByOrgId(orgId);
      if (!container) {
        log.warn(`No container found for org: ${orgId}`);
        return;
      }

      log.info(`Removing container for org: ${orgId}`);

      try {
        await docker("stop", "-t", "10", container.containerId);
      } catch {
        // Container might already be stopped
      }

      try {
        await docker("rm", "-f", container.containerId);
      } catch (error) {
        log.warn(`Failed to remove container: ${String(error)}`);
      }

      usedPorts.delete(container.port);
      await db.containers.delete(orgId);
      await db.orgs.update(orgId, {
        containerId: null,
        containerPort: null,
        status: "stopped",
      });

      log.info(`Container removed for org: ${orgId}`);
    },

    async restart(orgId) {
      const container = await db.containers.findByOrgId(orgId);
      if (!container) {
        throw new Error(`No container found for org: ${orgId}`);
      }

      log.info(`Restarting container for org: ${orgId}`);
      await db.containers.updateStatus(orgId, "stopping");

      try {
        await docker("stop", "-t", "30", container.containerId);
      } catch {
        // Container might already be stopped
      }

      await docker("start", container.containerId);
      await db.containers.updateStatus(orgId, "running");
      await db.orgs.updateStatus(orgId, "running");

      log.info(`Container restarted for org: ${orgId}`);
      return { ...container, status: "running" as const };
    },

    async getStatus(orgId) {
      const container = await db.containers.findByOrgId(orgId);
      if (!container) {
        return null;
      }

      try {
        const output = await docker("inspect", container.containerId);
        const info: DockerContainer[] = JSON.parse(output);
        if (info.length > 0) {
          const state = info[0].State;
          let status: OrgContainer["status"] = "stopped";
          if (state.Running) {
            status = "running";
          } else if (state.ExitCode !== 0) {
            status = "error";
          }

          if (status !== container.status) {
            await db.containers.updateStatus(orgId, status);
          }

          return { ...container, status };
        }
      } catch {
        await db.containers.updateStatus(orgId, "error", "Container not found");
      }

      return container;
    },

    async healthCheck(orgId) {
      const container = await db.containers.findByOrgId(orgId);
      if (!container || container.status !== "running") {
        return false;
      }

      try {
        // Use Docker DNS name + internal port so the check works from
        // within the platform container on the shared Docker network.
        const internalHost = containerName(orgId);
        const internalPort = 18789;
        const response = await fetch(`http://${internalHost}:${internalPort}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        const healthy = response.ok;

        if (healthy) {
          await db.containers.updateHealthCheck(orgId);
        }

        return healthy;
      } catch {
        return false;
      }
    },

    async listAll() {
      return db.containers.listAll();
    },

    async exec(orgId, command) {
      const container = await db.containers.findByOrgId(orgId);
      if (!container) {
        throw new Error(`No container found for org: ${orgId}`);
      }

      return new Promise((resolve, reject) => {
        const proc = spawn("docker", ["exec", container.containerId, ...command], {
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (data) => {
          stdout += data.toString();
        });
        proc.stderr.on("data", (data) => {
          stderr += data.toString();
        });
        proc.on("close", (exitCode) => {
          resolve({ exitCode: exitCode ?? 1, stdout, stderr });
        });
        proc.on("error", reject);
      });
    },

    async getLogs(orgId, tail = 100) {
      const container = await db.containers.findByOrgId(orgId);
      if (!container) {
        throw new Error(`No container found for org: ${orgId}`);
      }

      return docker("logs", "--tail", String(tail), container.containerId);
    },
  };
}
