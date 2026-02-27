export type ChannelType = "public" | "private" | "dm";

export type MemberRole = "admin" | "member";

export interface CompanyChannel {
  id: string;
  name: string;
  type: ChannelType;
  description: string;
  createdBy: string;
  createdAt: number;
}

export interface ChannelMember {
  channelId: string;
  memberId: string;
  role: MemberRole;
  joinedAt: number;
}

export interface ChannelMessage {
  id: string;
  channelId: string;
  senderId: string;
  text: string;
  timestamp: number;
  threadId: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CompanyChannelWithMembers extends CompanyChannel {
  members: ChannelMember[];
}

export interface CompanyChannelPreview extends CompanyChannel {
  memberCount: number;
  lastMessage: ChannelMessage | null;
}

export type CompanyChannelEvent =
  | { type: "channel.created"; channel: CompanyChannel; members: string[] }
  | { type: "channel.deleted"; channelId: string }
  | { type: "channel.message"; message: ChannelMessage; channelName: string }
  | { type: "channel.member.joined"; channelId: string; memberId: string }
  | { type: "channel.member.left"; channelId: string; memberId: string };
