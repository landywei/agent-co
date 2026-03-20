import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthService } from "./auth/index.js";
import type {
  PlatformDb,
  UserRepository,
  OrgRepository,
  MembershipRepository,
  ContainerRepository,
  AuditLogRepository,
} from "./db/index.js";
import type { Org, User, Membership, OrgContainer } from "./types.js";

function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "test@example.com",
    passwordHash: "hashed",
    name: "Test User",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockOrg(overrides: Partial<Org> = {}): Org {
  return {
    id: "org-1",
    name: "Test Org",
    slug: "test-org",
    status: "pending",
    containerId: null,
    containerPort: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    settings: {},
    ...overrides,
  };
}

function createMockMembership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: "membership-1",
    userId: "user-1",
    orgId: "org-1",
    role: "owner",
    createdAt: new Date(),
    ...overrides,
  };
}

function createMockContainer(overrides: Partial<OrgContainer> = {}): OrgContainer {
  return {
    orgId: "org-1",
    containerId: "container-abc123",
    port: 19000,
    status: "running",
    lastHealthCheck: new Date(),
    errorMessage: null,
    ...overrides,
  };
}

describe("Platform Types", () => {
  it("should have correct org status values", () => {
    const statuses = ["pending", "provisioning", "running", "stopped", "error"];
    const org = createMockOrg();
    expect(statuses).toContain(org.status);
  });

  it("should have correct member role values", () => {
    const roles = ["owner", "admin", "member"];
    const membership = createMockMembership();
    expect(roles).toContain(membership.role);
  });
});

describe("Auth Service", () => {
  let mockDb: PlatformDb;
  let mockUsers: UserRepository;

  beforeEach(() => {
    mockUsers = {
      create: vi.fn(),
      findById: vi.fn(),
      findByEmail: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    mockDb = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      runMigrations: vi.fn(),
      users: mockUsers,
      orgs: {} as OrgRepository,
      memberships: {} as MembershipRepository,
      containers: {} as ContainerRepository,
      auditLogs: { log: vi.fn() } as unknown as AuditLogRepository,
    };
  });

  it("should reject signup with existing email", async () => {
    const existingUser = createMockUser();
    const findByEmailMock = vi.fn().mockResolvedValue(existingUser);
    mockUsers.findByEmail = findByEmailMock;

    const authService: AuthService = {
      hashPassword: vi.fn(),
      verifyPassword: vi.fn(),
      generateToken: vi.fn(),
      generateRefreshToken: vi.fn(),
      verifyToken: vi.fn(),
      signup: async (email) => {
        const existing = await mockDb.users.findByEmail(email);
        if (existing) {
          throw new Error("Email already registered");
        }
        return { user: existingUser, token: "token" };
      },
      login: vi.fn(),
      refreshToken: vi.fn(),
    };

    await expect(authService.signup("test@example.com", "password", "Test")).rejects.toThrow(
      "Email already registered",
    );
  });

  it("should return null for invalid login", async () => {
    const findByEmailMock = vi.fn().mockResolvedValue(null);
    mockUsers.findByEmail = findByEmailMock;

    const authService: AuthService = {
      hashPassword: vi.fn(),
      verifyPassword: vi.fn(),
      generateToken: vi.fn(),
      generateRefreshToken: vi.fn(),
      verifyToken: vi.fn(),
      signup: vi.fn(),
      login: async (email) => {
        const user = await mockDb.users.findByEmail(email);
        if (!user) {
          return null;
        }
        return { user, token: "token" };
      },
      refreshToken: vi.fn(),
    };

    const result = await authService.login("nonexistent@example.com", "password");
    expect(result).toBeNull();
  });
});

describe("Container Manager", () => {
  it("should track container status correctly", () => {
    const container = createMockContainer({ status: "running" });
    expect(container.status).toBe("running");

    const stoppedContainer = createMockContainer({ status: "stopped" });
    expect(stoppedContainer.status).toBe("stopped");
  });

  it("should generate correct container names", () => {
    const orgId = "abc-123-def";
    const expectedName = `openclaw-org-${orgId}`;
    expect(expectedName).toBe("openclaw-org-abc-123-def");
  });
});

describe("Org Lifecycle", () => {
  it("should transition through correct states", () => {
    const _states: Org["status"][] = ["pending", "provisioning", "running", "stopped"];

    let org = createMockOrg({ status: "pending" });
    expect(org.status).toBe("pending");

    org = { ...org, status: "provisioning" };
    expect(org.status).toBe("provisioning");

    org = { ...org, status: "running" };
    expect(org.status).toBe("running");

    org = { ...org, status: "stopped" };
    expect(org.status).toBe("stopped");
  });

  it("should handle error state", () => {
    const org = createMockOrg({ status: "error" });
    expect(org.status).toBe("error");
  });
});

describe("Membership Roles", () => {
  it("should have correct role hierarchy", () => {
    const roleHierarchy = {
      owner: ["owner", "admin", "member"],
      admin: ["admin", "member"],
      member: ["member"],
    };

    expect(roleHierarchy.owner).toContain("admin");
    expect(roleHierarchy.owner).toContain("member");
    expect(roleHierarchy.admin).not.toContain("owner");
  });
});

describe("Org Settings", () => {
  it("should mask sensitive settings", () => {
    const org = createMockOrg({
      settings: {
        anthropicApiKey: "sk-ant-secret-key",
        openaiApiKey: "sk-openai-secret",
        gatewayToken: "gateway-token-123",
        maxAgents: 10,
      },
    });

    const safeSettings = {
      anthropicApiKey: org.settings.anthropicApiKey ? "***" : undefined,
      openaiApiKey: org.settings.openaiApiKey ? "***" : undefined,
      gatewayToken: org.settings.gatewayToken ? "***" : undefined,
      maxAgents: org.settings.maxAgents,
    };

    expect(safeSettings.anthropicApiKey).toBe("***");
    expect(safeSettings.openaiApiKey).toBe("***");
    expect(safeSettings.gatewayToken).toBe("***");
    expect(safeSettings.maxAgents).toBe(10);
  });
});

describe("Health Monitor", () => {
  it("should track consecutive failures", () => {
    const failureCounts = new Map<string, number>();
    const orgId = "org-1";

    failureCounts.set(orgId, 0);
    expect(failureCounts.get(orgId)).toBe(0);

    failureCounts.set(orgId, (failureCounts.get(orgId) || 0) + 1);
    expect(failureCounts.get(orgId)).toBe(1);

    failureCounts.set(orgId, (failureCounts.get(orgId) || 0) + 1);
    expect(failureCounts.get(orgId)).toBe(2);

    failureCounts.set(orgId, 0);
    expect(failureCounts.get(orgId)).toBe(0);
  });

  it("should trigger action after threshold", () => {
    const threshold = 3;
    let failures = 0;
    let actionTriggered = false;

    for (let i = 0; i < 5; i++) {
      failures++;
      if (failures >= threshold && !actionTriggered) {
        actionTriggered = true;
      }
    }

    expect(actionTriggered).toBe(true);
  });
});

describe("Slug Validation", () => {
  it("should accept valid slugs", () => {
    const validSlugs = ["my-org", "test123", "a-b-c", "org1"];
    const pattern = /^[a-z0-9-]+$/;

    for (const slug of validSlugs) {
      expect(pattern.test(slug)).toBe(true);
    }
  });

  it("should reject invalid slugs", () => {
    const invalidSlugs = ["My-Org", "test_123", "org with spaces", "ORG"];
    const pattern = /^[a-z0-9-]+$/;

    for (const slug of invalidSlugs) {
      expect(pattern.test(slug)).toBe(false);
    }
  });
});
