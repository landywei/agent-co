import type { Express, Request, Response } from "express";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { AuthMiddleware, AuthService } from "../auth/index.js";
import type { ContainerManager } from "../containers/manager.js";
import type { PlatformDb } from "../db/index.js";
import type { OrgProxy } from "../proxy/index.js";
import type { MemberRole, OrgSettings } from "../types.js";

const log = createSubsystemLogger("platform:api");

export interface ApiRoutesConfig {
  db: PlatformDb;
  auth: AuthService;
  authMiddleware: AuthMiddleware;
  containers: ContainerManager;
  proxy: OrgProxy;
}

export function setupApiRoutes(app: Express, config: ApiRoutesConfig): void {
  const { db, auth, authMiddleware, containers, proxy } = config;
  const { requireAuth, requireOrgAccess } = authMiddleware;

  // Auth routes
  app.post("/api/auth/signup", async (req: Request, res: Response) => {
    try {
      const { email, password, name } = req.body;
      if (!email || !password || !name) {
        res.status(400).json({ error: "Email, password, and name are required" });
        return;
      }

      const result = await auth.signup(email, password, name);
      res.status(201).json({
        user: { id: result.user.id, email: result.user.email, name: result.user.name },
        token: result.token,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Signup failed";
      log.error(`Signup error: ${message}`);
      res.status(400).json({ error: message });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ error: "Email and password are required" });
        return;
      }

      const result = await auth.login(email, password);
      if (!result) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      res.json({
        user: { id: result.user.id, email: result.user.email, name: result.user.name },
        token: result.token,
      });
    } catch (error) {
      log.error(`Login error: ${String(error)}`);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.get("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await db.users.findById(req.user!.userId);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const memberships = await db.memberships.findByUser(user.id);
      const orgs = await Promise.all(
        memberships.map(async (m) => {
          const org = await db.orgs.findById(m.orgId);
          return org ? { ...org, role: m.role } : null;
        }),
      );

      res.json({
        user: { id: user.id, email: user.email, name: user.name },
        orgs: orgs.filter(Boolean),
      });
    } catch (error) {
      log.error(`Get user error: ${String(error)}`);
      res.status(500).json({ error: "Failed to get user" });
    }
  });

  // Org routes
  app.post("/api/orgs", requireAuth, async (req: Request, res: Response) => {
    try {
      const { name, slug } = req.body;
      if (!name || !slug) {
        res.status(400).json({ error: "Name and slug are required" });
        return;
      }

      if (!/^[a-z0-9-]+$/.test(slug)) {
        res
          .status(400)
          .json({ error: "Slug must contain only lowercase letters, numbers, and hyphens" });
        return;
      }

      const existing = await db.orgs.findBySlug(slug);
      if (existing) {
        res.status(409).json({ error: "Organization slug already exists" });
        return;
      }

      const org = await db.orgs.create(name, slug, req.user!.userId);

      await db.auditLogs.log({
        orgId: org.id,
        userId: req.user!.userId,
        action: "org.created",
        resourceType: "org",
        resourceId: org.id,
      });

      log.info(`Org created: ${org.slug} by user ${req.user!.userId}`);
      res.status(201).json(org);
    } catch (error) {
      log.error(`Create org error: ${String(error)}`);
      res.status(500).json({ error: "Failed to create organization" });
    }
  });

  app.get("/api/orgs", requireAuth, async (req: Request, res: Response) => {
    try {
      const orgs = await db.orgs.findByUserId(req.user!.userId);
      res.json(orgs);
    } catch (error) {
      log.error(`List orgs error: ${String(error)}`);
      res.status(500).json({ error: "Failed to list organizations" });
    }
  });

  app.get(
    "/api/orgs/:orgId",
    requireAuth,
    requireOrgAccess(),
    async (req: Request, res: Response) => {
      try {
        const org = await db.orgs.findById(req.orgId!);
        if (!org) {
          res.status(404).json({ error: "Organization not found" });
          return;
        }

        const container = await containers.getStatus(org.id);
        res.json({ ...org, container });
      } catch (error) {
        log.error(`Get org error: ${String(error)}`);
        res.status(500).json({ error: "Failed to get organization" });
      }
    },
  );

  app.patch(
    "/api/orgs/:orgId",
    requireAuth,
    requireOrgAccess(["owner", "admin"]),
    async (req: Request, res: Response) => {
      try {
        const { name } = req.body;
        const org = await db.orgs.update(req.orgId!, { name });
        if (!org) {
          res.status(404).json({ error: "Organization not found" });
          return;
        }

        await db.auditLogs.log({
          orgId: req.orgId!,
          userId: req.user!.userId,
          action: "org.updated",
          resourceType: "org",
          resourceId: req.orgId!,
          details: { name },
        });

        res.json(org);
      } catch (error) {
        log.error(`Update org error: ${String(error)}`);
        res.status(500).json({ error: "Failed to update organization" });
      }
    },
  );

  app.delete(
    "/api/orgs/:orgId",
    requireAuth,
    requireOrgAccess(["owner"]),
    async (req: Request, res: Response) => {
      try {
        await containers.remove(req.orgId!);
        await db.orgs.delete(req.orgId!);

        await db.auditLogs.log({
          userId: req.user!.userId,
          action: "org.deleted",
          resourceType: "org",
          resourceId: req.orgId!,
        });

        log.info(`Org deleted: ${req.orgId} by user ${req.user!.userId}`);
        res.status(204).send();
      } catch (error) {
        log.error(`Delete org error: ${String(error)}`);
        res.status(500).json({ error: "Failed to delete organization" });
      }
    },
  );

  // Org settings routes
  app.get(
    "/api/orgs/:orgId/settings",
    requireAuth,
    requireOrgAccess(["owner", "admin"]),
    async (req: Request, res: Response) => {
      try {
        const org = await db.orgs.findById(req.orgId!);
        if (!org) {
          res.status(404).json({ error: "Organization not found" });
          return;
        }

        const safeSettings: Partial<OrgSettings> = {
          maxAgents: org.settings.maxAgents,
          maxWorkspaceSize: org.settings.maxWorkspaceSize,
          anthropicApiKey: org.settings.anthropicApiKey ? "***" : undefined,
          openaiApiKey: org.settings.openaiApiKey ? "***" : undefined,
          gatewayToken: org.settings.gatewayToken ? "***" : undefined,
        };

        res.json(safeSettings);
      } catch (error) {
        log.error(`Get org settings error: ${String(error)}`);
        res.status(500).json({ error: "Failed to get organization settings" });
      }
    },
  );

  app.patch(
    "/api/orgs/:orgId/settings",
    requireAuth,
    requireOrgAccess(["owner", "admin"]),
    async (req: Request, res: Response) => {
      try {
        const settings: Partial<OrgSettings> = {};
        const allowedKeys: (keyof OrgSettings)[] = [
          "anthropicApiKey",
          "openaiApiKey",
          "gatewayToken",
          "maxAgents",
          "maxWorkspaceSize",
        ];

        for (const key of allowedKeys) {
          if (req.body[key] !== undefined) {
            settings[key] = req.body[key];
          }
        }

        const org = await db.orgs.updateSettings(req.orgId!, settings);
        if (!org) {
          res.status(404).json({ error: "Organization not found" });
          return;
        }

        await db.auditLogs.log({
          orgId: req.orgId!,
          userId: req.user!.userId,
          action: "org.settings.updated",
          resourceType: "org",
          resourceId: req.orgId!,
          details: { keys: Object.keys(settings) },
        });

        res.json({ success: true });
      } catch (error) {
        log.error(`Update org settings error: ${String(error)}`);
        res.status(500).json({ error: "Failed to update organization settings" });
      }
    },
  );

  // Org lifecycle routes
  app.post(
    "/api/orgs/:orgId/provision",
    requireAuth,
    requireOrgAccess(["owner", "admin"]),
    async (req: Request, res: Response) => {
      try {
        const org = await db.orgs.findById(req.orgId!);
        if (!org) {
          res.status(404).json({ error: "Organization not found" });
          return;
        }

        if (org.status !== "pending" && org.status !== "stopped") {
          res.status(400).json({ error: `Cannot provision org in ${org.status} state` });
          return;
        }

        const container = await containers.provision(org);

        await db.auditLogs.log({
          orgId: req.orgId!,
          userId: req.user!.userId,
          action: "org.provisioned",
          resourceType: "container",
          resourceId: container.containerId,
        });

        log.info(`Org provisioned: ${org.slug}`);
        res.json(container);
      } catch (error) {
        log.error(`Provision org error: ${String(error)}`);
        res.status(500).json({ error: "Failed to provision organization" });
      }
    },
  );

  app.post(
    "/api/orgs/:orgId/start",
    requireAuth,
    requireOrgAccess(["owner", "admin"]),
    async (req: Request, res: Response) => {
      try {
        const container = await containers.start(req.orgId!);

        await db.auditLogs.log({
          orgId: req.orgId!,
          userId: req.user!.userId,
          action: "org.started",
          resourceType: "container",
          resourceId: container.containerId,
        });

        res.json(container);
      } catch (error) {
        log.error(`Start org error: ${String(error)}`);
        res.status(500).json({ error: "Failed to start organization" });
      }
    },
  );

  app.post(
    "/api/orgs/:orgId/stop",
    requireAuth,
    requireOrgAccess(["owner", "admin"]),
    async (req: Request, res: Response) => {
      try {
        await containers.stop(req.orgId!);

        await db.auditLogs.log({
          orgId: req.orgId!,
          userId: req.user!.userId,
          action: "org.stopped",
        });

        res.json({ success: true });
      } catch (error) {
        log.error(`Stop org error: ${String(error)}`);
        res.status(500).json({ error: "Failed to stop organization" });
      }
    },
  );

  app.post(
    "/api/orgs/:orgId/restart",
    requireAuth,
    requireOrgAccess(["owner", "admin"]),
    async (req: Request, res: Response) => {
      try {
        const container = await containers.restart(req.orgId!);

        await db.auditLogs.log({
          orgId: req.orgId!,
          userId: req.user!.userId,
          action: "org.restarted",
          resourceType: "container",
          resourceId: container.containerId,
        });

        res.json(container);
      } catch (error) {
        log.error(`Restart org error: ${String(error)}`);
        res.status(500).json({ error: "Failed to restart organization" });
      }
    },
  );

  app.get(
    "/api/orgs/:orgId/logs",
    requireAuth,
    requireOrgAccess(["owner", "admin"]),
    async (req: Request, res: Response) => {
      try {
        const tail = parseInt(req.query.tail as string) || 100;
        const logs = await containers.getLogs(req.orgId!, tail);
        res.json({ logs });
      } catch (error) {
        log.error(`Get org logs error: ${String(error)}`);
        res.status(500).json({ error: "Failed to get organization logs" });
      }
    },
  );

  // Members routes
  app.get(
    "/api/orgs/:orgId/members",
    requireAuth,
    requireOrgAccess(),
    async (req: Request, res: Response) => {
      try {
        const memberships = await db.memberships.findByOrg(req.orgId!);
        const members = await Promise.all(
          memberships.map(async (m) => {
            const user = await db.users.findById(m.userId);
            return user
              ? { id: m.id, userId: user.id, email: user.email, name: user.name, role: m.role }
              : null;
          }),
        );

        res.json(members.filter(Boolean));
      } catch (error) {
        log.error(`List members error: ${String(error)}`);
        res.status(500).json({ error: "Failed to list members" });
      }
    },
  );

  app.post(
    "/api/orgs/:orgId/members",
    requireAuth,
    requireOrgAccess(["owner", "admin"]),
    async (req: Request, res: Response) => {
      try {
        const { email, role = "member" } = req.body;
        if (!email) {
          res.status(400).json({ error: "Email is required" });
          return;
        }

        const validRoles: MemberRole[] = ["owner", "admin", "member"];
        if (!validRoles.includes(role)) {
          res.status(400).json({ error: "Invalid role" });
          return;
        }

        const user = await db.users.findByEmail(email);
        if (!user) {
          res.status(404).json({ error: "User not found" });
          return;
        }

        const existing = await db.memberships.findByUserAndOrg(user.id, req.orgId!);
        if (existing) {
          res.status(409).json({ error: "User is already a member" });
          return;
        }

        const membership = await db.memberships.create(user.id, req.orgId!, role);

        await db.auditLogs.log({
          orgId: req.orgId!,
          userId: req.user!.userId,
          action: "member.added",
          resourceType: "membership",
          resourceId: membership.id,
          details: { addedUserId: user.id, role },
        });

        res.status(201).json({
          id: membership.id,
          userId: user.id,
          email: user.email,
          name: user.name,
          role: membership.role,
        });
      } catch (error) {
        log.error(`Add member error: ${String(error)}`);
        res.status(500).json({ error: "Failed to add member" });
      }
    },
  );

  app.patch(
    "/api/orgs/:orgId/members/:userId",
    requireAuth,
    requireOrgAccess(["owner"]),
    async (req: Request, res: Response) => {
      try {
        const { role } = req.body;
        const validRoles: MemberRole[] = ["owner", "admin", "member"];
        if (!validRoles.includes(role)) {
          res.status(400).json({ error: "Invalid role" });
          return;
        }

        const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
        const membership = await db.memberships.updateRole(userId, req.orgId!, role);
        if (!membership) {
          res.status(404).json({ error: "Membership not found" });
          return;
        }

        await db.auditLogs.log({
          orgId: req.orgId!,
          userId: req.user!.userId,
          action: "member.role.updated",
          resourceType: "membership",
          resourceId: membership.id,
          details: { targetUserId: userId, role },
        });

        res.json(membership);
      } catch (error) {
        log.error(`Update member error: ${String(error)}`);
        res.status(500).json({ error: "Failed to update member" });
      }
    },
  );

  app.delete(
    "/api/orgs/:orgId/members/:userId",
    requireAuth,
    requireOrgAccess(["owner", "admin"]),
    async (req: Request, res: Response) => {
      try {
        const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
        if (userId === req.user!.userId) {
          res.status(400).json({ error: "Cannot remove yourself" });
          return;
        }

        const membership = await db.memberships.findByUserAndOrg(userId, req.orgId!);
        if (!membership) {
          res.status(404).json({ error: "Membership not found" });
          return;
        }

        if (membership.role === "owner" && req.membership!.role !== "owner") {
          res.status(403).json({ error: "Only owners can remove other owners" });
          return;
        }

        await db.memberships.delete(userId, req.orgId!);

        await db.auditLogs.log({
          orgId: req.orgId!,
          userId: req.user!.userId,
          action: "member.removed",
          details: { removedUserId: userId },
        });

        res.status(204).send();
      } catch (error) {
        log.error(`Remove member error: ${String(error)}`);
        res.status(500).json({ error: "Failed to remove member" });
      }
    },
  );

  // Gateway proxy routes
  app.all(
    "/api/orgs/:orgId/gateway/*",
    requireAuth,
    requireOrgAccess(),
    async (req: Request, res: Response) => {
      try {
        const originalUrl = req.url.replace(`/api/orgs/${req.orgId}/gateway`, "");
        req.url = originalUrl || "/";
        await proxy.proxyRequest(req.orgId!, req, res);
      } catch (error) {
        log.error(`Gateway proxy error: ${String(error)}`);
        if (!res.headersSent) {
          res.status(502).json({ error: "Gateway proxy error" });
        }
      }
    },
  );

  // Health check
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  log.info("API routes configured");
}
