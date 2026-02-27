import crypto from "node:crypto";
import { listAgentIds } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import { callGateway } from "../gateway/call.js";
import type { GatewayBroadcastFn } from "../gateway/server-broadcast.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { CompanyChannelStore } from "./store.js";

const log = createSubsystemLogger("company-channels");

const TRIGGER_COOLDOWN_MS = 5_000;
const recentTriggers = new Map<string, number>();

function shouldTrigger(agentId: string, channelId: string): boolean {
  const key = `${agentId}:${channelId}`;
  const last = recentTriggers.get(key);
  const now = Date.now();
  if (last && now - last < TRIGGER_COOLDOWN_MS) {
    return false;
  }
  recentTriggers.set(key, now);
  return true;
}

function pruneOldTriggers(): void {
  const now = Date.now();
  for (const [key, ts] of recentTriggers) {
    if (now - ts > TRIGGER_COOLDOWN_MS * 2) {
      recentTriggers.delete(key);
    }
  }
}

export function setupChannelTriggers(
  store: CompanyChannelStore,
  _broadcast: GatewayBroadcastFn,
): void {
  const interval = setInterval(pruneOldTriggers, 30_000);
  interval.unref();

  store.on("event", (event) => {
    if (event.type !== "channel.message") {
      return;
    }

    const { message, channelName } = event;
    const senderId = message.senderId;
    const channelId = message.channelId;

    const members = store.getMembers(channelId);
    const cfg = loadConfig();
    const knownAgentIds = new Set(listAgentIds(cfg));

    const agentMembers = members
      .filter((m) => m.memberId !== senderId)
      .filter((m) => knownAgentIds.has(m.memberId));

    if (agentMembers.length === 0) {
      return;
    }

    const recentMessages = store.getMessages(channelId, { limit: 15 });
    const transcript = recentMessages.map((m) => `[${m.senderId}]: ${m.text}`).join("\n");

    for (const member of agentMembers) {
      if (!shouldTrigger(member.memberId, channelId)) {
        log.info?.(`skipping trigger for ${member.memberId} on #${channelName} (cooldown)`);
        continue;
      }

      const sessionKey = `agent:${member.memberId}:webchat:channel:${channelId}`;
      const prompt =
        `New message in #${channelName} from ${senderId}:\n\n` +
        `"${message.text}"\n\n` +
        `--- Recent conversation ---\n${transcript}\n---\n\n` +
        `You are in the #${channelName} channel. ` +
        `To respond, use channel_post with channel="${channelName}". ` +
        `Use channel_read if you need more context. ` +
        `If you have nothing to add right now, simply say "PASS" and do not post anything.`;

      triggerAgent(member.memberId, sessionKey, prompt, channelName).catch((err) => {
        log.warn?.(
          `failed to trigger ${member.memberId} for #${channelName}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  });
}

async function triggerAgent(
  agentId: string,
  sessionKey: string,
  message: string,
  channelName: string,
): Promise<void> {
  log.info?.(`triggering ${agentId} for #${channelName}`);
  try {
    await callGateway({
      method: "agent",
      params: {
        sessionKey,
        message,
        deliver: false,
        idempotencyKey: `chtrigger_${crypto.randomUUID()}`,
        timeout: 300,
      },
    });
  } catch (err) {
    log.warn?.(
      `trigger call failed for ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
