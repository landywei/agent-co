export type OrgId = string;
export type UserId = string;
export type MembershipId = string;

export type OrgStatus = "pending" | "provisioning" | "running" | "stopped" | "error";
export type MemberRole = "owner" | "admin" | "member";

export interface Org {
  id: OrgId;
  name: string;
  slug: string;
  status: OrgStatus;
  containerId: string | null;
  containerPort: number | null;
  createdAt: Date;
  updatedAt: Date;
  settings: OrgSettings;
}

export interface OrgSettings {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  gatewayToken?: string;
  maxAgents?: number;
  maxWorkspaceSize?: number;
}

export interface User {
  id: UserId;
  email: string;
  passwordHash: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Membership {
  id: MembershipId;
  userId: UserId;
  orgId: OrgId;
  role: MemberRole;
  createdAt: Date;
}

export interface OrgContainer {
  orgId: OrgId;
  containerId: string;
  port: number;
  status: "starting" | "running" | "stopping" | "stopped" | "error";
  lastHealthCheck: Date | null;
  errorMessage: string | null;
}

export interface JwtPayload {
  userId: UserId;
  email: string;
  iat: number;
  exp: number;
}

export interface AuthenticatedRequest {
  user: JwtPayload;
  orgId?: OrgId;
  membership?: Membership;
}
