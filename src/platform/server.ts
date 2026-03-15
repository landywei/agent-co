import express from "express";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { setupApiRoutes } from "./api/routes.js";
import { createAuthMiddleware, createAuthService, type AuthConfig } from "./auth/index.js";
import { createContainerManager, type ContainerManagerConfig } from "./containers/manager.js";
import { createPlatformDb, type PlatformDbConfig } from "./db/index.js";
import { createHealthMonitor, type HealthMonitorConfig } from "./health/monitor.js";
import { createOrgProxy, type OrgProxyConfig } from "./proxy/index.js";

const log = createSubsystemLogger("platform");

export interface PlatformServerOptions {
  port: number;
  db: PlatformDbConfig;
  auth: AuthConfig;
  containers: ContainerManagerConfig;
  proxy: OrgProxyConfig;
  health: HealthMonitorConfig;
}

export interface PlatformServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function startPlatformServer(options: PlatformServerOptions): Promise<PlatformServer> {
  log.info("Starting platform server...");

  const db = await createPlatformDb(options.db);
  await db.connect();
  await db.runMigrations();

  const authService = await createAuthService(db, options.auth);
  const authMiddleware = createAuthMiddleware(db, authService);
  const containers = await createContainerManager(db, options.containers);
  const proxy = await createOrgProxy(db, options.proxy);
  const healthMonitor = createHealthMonitor(db, containers, options.health);

  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use((req, _res, next) => {
    log.debug(`${req.method} ${req.url}`);
    next();
  });

  setupApiRoutes(app, {
    db,
    auth: authService,
    authMiddleware,
    containers,
    proxy,
  });

  app.use(express.static("ui/dist"));

  app.get("*", (_req, res) => {
    res.sendFile("index.html", { root: "ui/dist" });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      log.error(`Unhandled error: ${err.message}`);
      res.status(500).json({ error: "Internal server error" });
    },
  );

  let server: ReturnType<typeof app.listen> | null = null;

  return {
    async start() {
      return new Promise((resolve) => {
        server = app.listen(options.port, () => {
          log.info(`Platform server listening on port ${options.port}`);
          healthMonitor.start();
          resolve();
        });

        server.on("upgrade", async (req, socket, head) => {
          const url = new URL(req.url || "/", `http://${req.headers.host}`);
          const match = url.pathname.match(/^\/api\/orgs\/([^/]+)\/gateway/);

          if (match) {
            const orgId = match[1];
            const token =
              url.searchParams.get("token") || req.headers.authorization?.replace("Bearer ", "");

            if (!token) {
              socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
              socket.destroy();
              return;
            }

            const payload = await authService.verifyToken(token);
            if (!payload) {
              socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
              socket.destroy();
              return;
            }

            const membership = await db.memberships.findByUserAndOrg(payload.userId, orgId);
            if (!membership) {
              socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
              socket.destroy();
              return;
            }

            req.url = req.url?.replace(`/api/orgs/${orgId}/gateway`, "") || "/";
            await proxy.proxyWebSocket(orgId, req as express.Request, socket, head);
          } else {
            socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
            socket.destroy();
          }
        });
      });
    },

    async stop() {
      healthMonitor.stop();

      if (server) {
        await new Promise<void>((resolve) => {
          server!.close(() => resolve());
        });
      }

      await db.disconnect();
      log.info("Platform server stopped");
    },
  };
}
