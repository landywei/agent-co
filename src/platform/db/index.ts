import { createSubsystemLogger } from "../../logging/subsystem.js";
import type {
  Membership,
  MemberRole,
  Org,
  OrgContainer,
  OrgId,
  OrgSettings,
  OrgStatus,
  User,
  UserId,
} from "../types.js";

const log = createSubsystemLogger("platform:db");

export interface PlatformDbConfig {
  connectionString: string;
}

export interface PlatformDb {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  runMigrations(): Promise<void>;

  users: UserRepository;
  orgs: OrgRepository;
  memberships: MembershipRepository;
  containers: ContainerRepository;
  auditLogs: AuditLogRepository;
}

export interface UserRepository {
  create(email: string, passwordHash: string, name: string): Promise<User>;
  findById(id: UserId): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  update(id: UserId, data: Partial<Pick<User, "name" | "passwordHash">>): Promise<User | null>;
  delete(id: UserId): Promise<boolean>;
}

export interface OrgRepository {
  create(name: string, slug: string, ownerId: UserId): Promise<Org>;
  findById(id: OrgId): Promise<Org | null>;
  findBySlug(slug: string): Promise<Org | null>;
  findByUserId(userId: UserId): Promise<Org[]>;
  update(
    id: OrgId,
    data: Partial<Pick<Org, "name" | "status" | "containerId" | "containerPort" | "settings">>,
  ): Promise<Org | null>;
  updateStatus(id: OrgId, status: OrgStatus): Promise<Org | null>;
  updateSettings(id: OrgId, settings: Partial<OrgSettings>): Promise<Org | null>;
  delete(id: OrgId): Promise<boolean>;
  listAll(): Promise<Org[]>;
  listByStatus(status: OrgStatus): Promise<Org[]>;
}

export interface MembershipRepository {
  create(userId: UserId, orgId: OrgId, role: MemberRole): Promise<Membership>;
  findByUserAndOrg(userId: UserId, orgId: OrgId): Promise<Membership | null>;
  findByOrg(orgId: OrgId): Promise<Membership[]>;
  findByUser(userId: UserId): Promise<Membership[]>;
  updateRole(userId: UserId, orgId: OrgId, role: MemberRole): Promise<Membership | null>;
  delete(userId: UserId, orgId: OrgId): Promise<boolean>;
}

export interface ContainerRepository {
  upsert(container: OrgContainer): Promise<OrgContainer>;
  findByOrgId(orgId: OrgId): Promise<OrgContainer | null>;
  updateStatus(
    orgId: OrgId,
    status: OrgContainer["status"],
    errorMessage?: string,
  ): Promise<OrgContainer | null>;
  updateHealthCheck(orgId: OrgId): Promise<void>;
  delete(orgId: OrgId): Promise<boolean>;
  listAll(): Promise<OrgContainer[]>;
  listByStatus(status: OrgContainer["status"]): Promise<OrgContainer[]>;
}

export interface AuditLogEntry {
  orgId?: OrgId;
  userId?: UserId;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

export interface AuditLogRepository {
  log(entry: AuditLogEntry): Promise<void>;
  findByOrg(orgId: OrgId, limit?: number): Promise<AuditLogEntry[]>;
  findByUser(userId: UserId, limit?: number): Promise<AuditLogEntry[]>;
}

type QueryResult<T> = { rows: T[]; rowCount: number };
type PoolClient = {
  query<T>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
  release(): void;
};
type Pool = {
  connect(): Promise<PoolClient>;
  query<T>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
  end(): Promise<void>;
};

export async function createPlatformDb(config: PlatformDbConfig): Promise<PlatformDb> {
  const { default: pg } = await import("pg");
  const pool: Pool = new pg.Pool({ connectionString: config.connectionString });

  const users: UserRepository = {
    async create(email, passwordHash, name) {
      const result = await pool.query<User>(
        `INSERT INTO users (email, password_hash, name) 
         VALUES ($1, $2, $3) 
         RETURNING id, email, password_hash as "passwordHash", name, created_at as "createdAt", updated_at as "updatedAt"`,
        [email, passwordHash, name],
      );
      return result.rows[0];
    },

    async findById(id) {
      const result = await pool.query<User>(
        `SELECT id, email, password_hash as "passwordHash", name, created_at as "createdAt", updated_at as "updatedAt"
         FROM users WHERE id = $1`,
        [id],
      );
      return result.rows[0] || null;
    },

    async findByEmail(email) {
      const result = await pool.query<User>(
        `SELECT id, email, password_hash as "passwordHash", name, created_at as "createdAt", updated_at as "updatedAt"
         FROM users WHERE email = $1`,
        [email],
      );
      return result.rows[0] || null;
    },

    async update(id, data) {
      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (data.name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(data.name);
      }
      if (data.passwordHash !== undefined) {
        updates.push(`password_hash = $${paramIndex++}`);
        values.push(data.passwordHash);
      }

      if (updates.length === 0) {
        return this.findById(id);
      }

      values.push(id);
      const result = await pool.query<User>(
        `UPDATE users SET ${updates.join(", ")} WHERE id = $${paramIndex}
         RETURNING id, email, password_hash as "passwordHash", name, created_at as "createdAt", updated_at as "updatedAt"`,
        values,
      );
      return result.rows[0] || null;
    },

    async delete(id) {
      const result = await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
      return result.rowCount > 0;
    },
  };

  const orgs: OrgRepository = {
    async create(name, slug, ownerId) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const orgResult = await client.query<Org>(
          `INSERT INTO orgs (name, slug, status) 
           VALUES ($1, $2, 'pending') 
           RETURNING id, name, slug, status, container_id as "containerId", container_port as "containerPort", 
                     settings, created_at as "createdAt", updated_at as "updatedAt"`,
          [name, slug],
        );
        const org = orgResult.rows[0];

        await client.query(
          `INSERT INTO memberships (user_id, org_id, role) VALUES ($1, $2, 'owner')`,
          [ownerId, org.id],
        );

        await client.query("COMMIT");
        return org;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async findById(id) {
      const result = await pool.query<Org>(
        `SELECT id, name, slug, status, container_id as "containerId", container_port as "containerPort",
                settings, created_at as "createdAt", updated_at as "updatedAt"
         FROM orgs WHERE id = $1`,
        [id],
      );
      return result.rows[0] || null;
    },

    async findBySlug(slug) {
      const result = await pool.query<Org>(
        `SELECT id, name, slug, status, container_id as "containerId", container_port as "containerPort",
                settings, created_at as "createdAt", updated_at as "updatedAt"
         FROM orgs WHERE slug = $1`,
        [slug],
      );
      return result.rows[0] || null;
    },

    async findByUserId(userId) {
      const result = await pool.query<Org>(
        `SELECT o.id, o.name, o.slug, o.status, o.container_id as "containerId", o.container_port as "containerPort",
                o.settings, o.created_at as "createdAt", o.updated_at as "updatedAt"
         FROM orgs o
         JOIN memberships m ON o.id = m.org_id
         WHERE m.user_id = $1
         ORDER BY o.created_at DESC`,
        [userId],
      );
      return result.rows;
    },

    async update(id, data) {
      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (data.name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(data.name);
      }
      if (data.status !== undefined) {
        updates.push(`status = $${paramIndex++}`);
        values.push(data.status);
      }
      if (data.containerId !== undefined) {
        updates.push(`container_id = $${paramIndex++}`);
        values.push(data.containerId);
      }
      if (data.containerPort !== undefined) {
        updates.push(`container_port = $${paramIndex++}`);
        values.push(data.containerPort);
      }
      if (data.settings !== undefined) {
        updates.push(`settings = $${paramIndex++}`);
        values.push(JSON.stringify(data.settings));
      }

      if (updates.length === 0) {
        return this.findById(id);
      }

      values.push(id);
      const result = await pool.query<Org>(
        `UPDATE orgs SET ${updates.join(", ")} WHERE id = $${paramIndex}
         RETURNING id, name, slug, status, container_id as "containerId", container_port as "containerPort",
                   settings, created_at as "createdAt", updated_at as "updatedAt"`,
        values,
      );
      return result.rows[0] || null;
    },

    async updateStatus(id, status) {
      return this.update(id, { status });
    },

    async updateSettings(id, settings) {
      const org = await this.findById(id);
      if (!org) {
        return null;
      }
      const mergedSettings = { ...org.settings, ...settings };
      return this.update(id, { settings: mergedSettings });
    },

    async delete(id) {
      const result = await pool.query(`DELETE FROM orgs WHERE id = $1`, [id]);
      return result.rowCount > 0;
    },

    async listAll() {
      const result = await pool.query<Org>(
        `SELECT id, name, slug, status, container_id as "containerId", container_port as "containerPort",
                settings, created_at as "createdAt", updated_at as "updatedAt"
         FROM orgs ORDER BY created_at DESC`,
      );
      return result.rows;
    },

    async listByStatus(status) {
      const result = await pool.query<Org>(
        `SELECT id, name, slug, status, container_id as "containerId", container_port as "containerPort",
                settings, created_at as "createdAt", updated_at as "updatedAt"
         FROM orgs WHERE status = $1 ORDER BY created_at DESC`,
        [status],
      );
      return result.rows;
    },
  };

  const memberships: MembershipRepository = {
    async create(userId, orgId, role) {
      const result = await pool.query<Membership>(
        `INSERT INTO memberships (user_id, org_id, role) 
         VALUES ($1, $2, $3) 
         RETURNING id, user_id as "userId", org_id as "orgId", role, created_at as "createdAt"`,
        [userId, orgId, role],
      );
      return result.rows[0];
    },

    async findByUserAndOrg(userId, orgId) {
      const result = await pool.query<Membership>(
        `SELECT id, user_id as "userId", org_id as "orgId", role, created_at as "createdAt"
         FROM memberships WHERE user_id = $1 AND org_id = $2`,
        [userId, orgId],
      );
      return result.rows[0] || null;
    },

    async findByOrg(orgId) {
      const result = await pool.query<Membership>(
        `SELECT id, user_id as "userId", org_id as "orgId", role, created_at as "createdAt"
         FROM memberships WHERE org_id = $1`,
        [orgId],
      );
      return result.rows;
    },

    async findByUser(userId) {
      const result = await pool.query<Membership>(
        `SELECT id, user_id as "userId", org_id as "orgId", role, created_at as "createdAt"
         FROM memberships WHERE user_id = $1`,
        [userId],
      );
      return result.rows;
    },

    async updateRole(userId, orgId, role) {
      const result = await pool.query<Membership>(
        `UPDATE memberships SET role = $3 WHERE user_id = $1 AND org_id = $2
         RETURNING id, user_id as "userId", org_id as "orgId", role, created_at as "createdAt"`,
        [userId, orgId, role],
      );
      return result.rows[0] || null;
    },

    async delete(userId, orgId) {
      const result = await pool.query(
        `DELETE FROM memberships WHERE user_id = $1 AND org_id = $2`,
        [userId, orgId],
      );
      return result.rowCount > 0;
    },
  };

  const containers: ContainerRepository = {
    async upsert(container) {
      const result = await pool.query<OrgContainer>(
        `INSERT INTO org_containers (org_id, container_id, port, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (org_id) DO UPDATE SET
           container_id = EXCLUDED.container_id,
           port = EXCLUDED.port,
           status = EXCLUDED.status
         RETURNING org_id as "orgId", container_id as "containerId", port, status, 
                   last_health_check as "lastHealthCheck", error_message as "errorMessage"`,
        [container.orgId, container.containerId, container.port, container.status],
      );
      return result.rows[0];
    },

    async findByOrgId(orgId) {
      const result = await pool.query<OrgContainer>(
        `SELECT org_id as "orgId", container_id as "containerId", port, status,
                last_health_check as "lastHealthCheck", error_message as "errorMessage"
         FROM org_containers WHERE org_id = $1`,
        [orgId],
      );
      return result.rows[0] || null;
    },

    async updateStatus(orgId, status, errorMessage) {
      const result = await pool.query<OrgContainer>(
        `UPDATE org_containers SET status = $2, error_message = $3 WHERE org_id = $1
         RETURNING org_id as "orgId", container_id as "containerId", port, status,
                   last_health_check as "lastHealthCheck", error_message as "errorMessage"`,
        [orgId, status, errorMessage || null],
      );
      return result.rows[0] || null;
    },

    async updateHealthCheck(orgId) {
      await pool.query(`UPDATE org_containers SET last_health_check = NOW() WHERE org_id = $1`, [
        orgId,
      ]);
    },

    async delete(orgId) {
      const result = await pool.query(`DELETE FROM org_containers WHERE org_id = $1`, [orgId]);
      return result.rowCount > 0;
    },

    async listAll() {
      const result = await pool.query<OrgContainer>(
        `SELECT org_id as "orgId", container_id as "containerId", port, status,
                last_health_check as "lastHealthCheck", error_message as "errorMessage"
         FROM org_containers`,
      );
      return result.rows;
    },

    async listByStatus(status) {
      const result = await pool.query<OrgContainer>(
        `SELECT org_id as "orgId", container_id as "containerId", port, status,
                last_health_check as "lastHealthCheck", error_message as "errorMessage"
         FROM org_containers WHERE status = $1`,
        [status],
      );
      return result.rows;
    },
  };

  const auditLogs: AuditLogRepository = {
    async log(entry) {
      await pool.query(
        `INSERT INTO audit_logs (org_id, user_id, action, resource_type, resource_id, details, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          entry.orgId || null,
          entry.userId || null,
          entry.action,
          entry.resourceType || null,
          entry.resourceId || null,
          JSON.stringify(entry.details || {}),
          entry.ipAddress || null,
        ],
      );
    },

    async findByOrg(orgId, limit = 100) {
      const result = await pool.query<AuditLogEntry>(
        `SELECT org_id as "orgId", user_id as "userId", action, resource_type as "resourceType",
                resource_id as "resourceId", details, ip_address as "ipAddress"
         FROM audit_logs WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [orgId, limit],
      );
      return result.rows;
    },

    async findByUser(userId, limit = 100) {
      const result = await pool.query<AuditLogEntry>(
        `SELECT org_id as "orgId", user_id as "userId", action, resource_type as "resourceType",
                resource_id as "resourceId", details, ip_address as "ipAddress"
         FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, limit],
      );
      return result.rows;
    },
  };

  return {
    async connect() {
      const client = await pool.connect();
      client.release();
      log.info("Connected to PostgreSQL database");
    },

    async disconnect() {
      await pool.end();
      log.info("Disconnected from PostgreSQL database");
    },

    async runMigrations() {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const schemaPath = path.join(import.meta.dirname, "schema.sql");
      const schema = fs.readFileSync(schemaPath, "utf-8");
      await pool.query(schema);
      log.info("Database migrations completed");
    },

    users,
    orgs,
    memberships,
    containers,
    auditLogs,
  };
}
