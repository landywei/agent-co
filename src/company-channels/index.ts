import path from "node:path";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { CompanyChannelStore } from "./store.js";

export { CompanyChannelStore } from "./store.js";
export type {
  ChannelMessage,
  ChannelMember,
  ChannelType,
  CompanyChannel,
  CompanyChannelEvent,
  CompanyChannelPreview,
  CompanyChannelWithMembers,
  MemberRole,
} from "./types.js";

let _store: CompanyChannelStore | null = null;

export function getCompanyChannelStore(): CompanyChannelStore {
  if (!_store) {
    const homeDir = resolveRequiredHomeDir();
    const dbPath = path.join(homeDir, ".openclaw", "company", "channels.db");
    _store = new CompanyChannelStore(dbPath);
  }
  return _store;
}

export function closeCompanyChannelStore(): void {
  if (_store) {
    _store.close();
    _store = null;
  }
}
