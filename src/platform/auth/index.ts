import type { Request, Response, NextFunction } from "express";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { PlatformDb } from "../db/index.js";
import type { JwtPayload, Membership, OrgId, User, UserId } from "../types.js";

const log = createSubsystemLogger("platform:auth");

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
  refreshTokenExpiresIn: string;
  bcryptRounds: number;
}

export interface AuthService {
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, hash: string): Promise<boolean>;
  generateToken(user: User): string;
  generateRefreshToken(userId: UserId): Promise<string>;
  verifyToken(token: string): Promise<JwtPayload | null>;
  signup(email: string, password: string, name: string): Promise<{ user: User; token: string }>;
  login(email: string, password: string): Promise<{ user: User; token: string } | null>;
  refreshToken(refreshToken: string): Promise<{ token: string } | null>;
}

export interface AuthMiddleware {
  requireAuth: (req: Request, res: Response, next: NextFunction) => Promise<void>;
  requireOrgAccess: (
    roles?: Membership["role"][],
  ) => (req: Request, res: Response, next: NextFunction) => Promise<void>;
  optionalAuth: (req: Request, res: Response, next: NextFunction) => Promise<void>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
      orgId?: OrgId;
      membership?: Membership;
    }
  }
}

export async function createAuthService(db: PlatformDb, config: AuthConfig): Promise<AuthService> {
  const bcrypt = await import("bcrypt");
  const jwt = await import("jsonwebtoken");

  async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, config.bcryptRounds);
  }

  async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  function generateToken(user: User): string {
    const payload = {
      userId: user.id,
      email: user.email,
    };
    return jwt.default.sign(payload, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn,
    } as object);
  }

  async function generateRefreshToken(_userId: UserId): Promise<string> {
    const crypto = await import("node:crypto");
    return crypto.randomBytes(64).toString("hex");
  }

  async function verifyToken(token: string): Promise<JwtPayload | null> {
    try {
      const decoded = jwt.default.verify(token, config.jwtSecret) as JwtPayload;
      return decoded;
    } catch {
      return null;
    }
  }

  return {
    hashPassword,
    verifyPassword,
    generateToken,
    generateRefreshToken,
    verifyToken,

    async signup(email, password, name) {
      const existingUser = await db.users.findByEmail(email);
      if (existingUser) {
        throw new Error("Email already registered");
      }

      const passwordHash = await hashPassword(password);
      const user = await db.users.create(email, passwordHash, name);
      const token = generateToken(user);

      await db.auditLogs.log({
        userId: user.id,
        action: "user.signup",
        details: { email },
      });

      log.info(`User signed up: ${email}`);
      return { user, token };
    },

    async login(email, password) {
      const user = await db.users.findByEmail(email);
      if (!user) {
        return null;
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        await db.auditLogs.log({
          userId: user.id,
          action: "user.login.failed",
          details: { reason: "invalid_password" },
        });
        return null;
      }

      const token = generateToken(user);

      await db.auditLogs.log({
        userId: user.id,
        action: "user.login",
      });

      log.info(`User logged in: ${email}`);
      return { user, token };
    },

    async refreshToken(_refreshToken) {
      return null;
    },
  };
}

export function createAuthMiddleware(db: PlatformDb, authService: AuthService): AuthMiddleware {
  return {
    async requireAuth(req, res, next) {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing or invalid authorization header" });
        return;
      }

      const token = authHeader.slice(7);
      const payload = await authService.verifyToken(token);
      if (!payload) {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }

      req.user = payload;
      next();
    },

    requireOrgAccess(roles) {
      return async (req, res, next) => {
        if (!req.user) {
          res.status(401).json({ error: "Authentication required" });
          return;
        }

        const orgId = req.params.orgId || req.body?.orgId;
        if (!orgId) {
          res.status(400).json({ error: "Organization ID required" });
          return;
        }

        const membership = await db.memberships.findByUserAndOrg(req.user.userId, orgId);
        if (!membership) {
          res.status(403).json({ error: "Not a member of this organization" });
          return;
        }

        if (roles && roles.length > 0 && !roles.includes(membership.role)) {
          res.status(403).json({ error: "Insufficient permissions" });
          return;
        }

        req.orgId = orgId;
        req.membership = membership;
        next();
      };
    },

    async optionalAuth(req, _res, next) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        const payload = await authService.verifyToken(token);
        if (payload) {
          req.user = payload;
        }
      }
      next();
    },
  };
}
