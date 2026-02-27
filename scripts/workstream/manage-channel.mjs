#!/usr/bin/env node
/**
 * manage-channel.mjs
 *
 * Agent tool for creating and managing channels.
 * Channels are persisted in ~/.openclaw/company/channels.json
 * and cached in ~/.openclaw/channels-data.js for the frontend.
 *
 * Usage:
 *   node manage-channel.mjs create --name "product-design" --desc "Product design discussions" --members "main,researcher"
 *   node manage-channel.mjs add-member --channel "product-design" --member "engineer"
 *   node manage-channel.mjs remove-member --channel "product-design" --member "engineer"
 *   node manage-channel.mjs post --channel "product-design" --from "main" --message "Let's discuss the MVP"
 *   node manage-channel.mjs list
 *   node manage-channel.mjs info --channel "product-design"
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const OPENCLAW_DIR = join(homedir(), ".openclaw");
const CHANNELS_PATH = join(OPENCLAW_DIR, "company", "channels.json");
const CHANNELS_DATA_PATH = join(OPENCLAW_DIR, "channels-data.js");

function loadChannels() {
  if (!existsSync(CHANNELS_PATH)) {
    return [];
  }
  try {
    return JSON.parse(readFileSync(CHANNELS_PATH, "utf8"));
  } catch {
    return [];
  }
}

function saveChannels(channels) {
  writeFileSync(CHANNELS_PATH, JSON.stringify(channels, null, 2) + "\n");
  writeFileSync(CHANNELS_DATA_PATH, "window.__CHANNELS_DATA=" + JSON.stringify(channels) + ";\n");
}

const BOOLEAN_FLAGS = new Set(["deliver"]);

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        opts[key] = "true";
      } else if (i + 1 < argv.length) {
        opts[key] = argv[i + 1];
        i++;
      }
    } else if (!opts._cmd) {
      opts._cmd = argv[i];
    }
  }
  return opts;
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function genId() {
  return "ch_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function findChannel(channels, nameOrId) {
  const slug = slugify(nameOrId);
  return channels.find((c) => c.id === nameOrId || slugify(c.name) === slug || c.name === nameOrId);
}

// ─── Commands ────────────────────────────────────────────────────────

function cmdCreate(opts) {
  const name = opts.name;
  if (!name) {
    console.error("Error: --name is required");
    process.exit(1);
  }

  const channels = loadChannels();
  if (findChannel(channels, name)) {
    console.error(`Error: Channel "${name}" already exists`);
    process.exit(1);
  }

  const members = (opts.members || "main")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const type = opts.type || (members.length === 2 && !opts.desc ? "dm" : "group");

  const ch = {
    id: genId(),
    name,
    description: opts.desc || "",
    type,
    createdBy: opts.from || "main",
    createdAt: Date.now(),
    members,
    messages: [],
    maxTurns: parseInt(opts["max-turns"]) || 10,
  };

  if (opts.welcome !== "false") {
    ch.messages.push({
      id: "m_" + Date.now(),
      senderId: opts.from || "main",
      text: opts.welcome || `Channel #${name} created. ${opts.desc || ""}`.trim(),
      timestamp: Date.now(),
    });
  }

  channels.push(ch);
  saveChannels(channels);

  console.log(`✓ Channel created: #${name}`);
  console.log(`  ID: ${ch.id}`);
  console.log(`  Type: ${ch.type}`);
  console.log(`  Members: ${ch.members.join(", ")}`);
}

function cmdAddMember(opts) {
  if (!opts.channel || !opts.member) {
    console.error("Error: --channel and --member are required");
    process.exit(1);
  }

  const channels = loadChannels();
  const ch = findChannel(channels, opts.channel);
  if (!ch) {
    console.error(`Error: Channel "${opts.channel}" not found`);
    process.exit(1);
  }

  const members = opts.member
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const added = [];
  for (const m of members) {
    if (!ch.members.includes(m)) {
      ch.members.push(m);
      added.push(m);
    }
  }

  if (added.length) {
    ch.messages.push({
      id: "m_" + Date.now(),
      senderId: "system",
      text: `${added.join(", ")} joined #${ch.name}`,
      timestamp: Date.now(),
    });
    saveChannels(channels);
    console.log(`✓ Added ${added.join(", ")} to #${ch.name}`);
  } else {
    console.log(`All members already in #${ch.name}`);
  }
}

function cmdRemoveMember(opts) {
  if (!opts.channel || !opts.member) {
    console.error("Error: --channel and --member are required");
    process.exit(1);
  }

  const channels = loadChannels();
  const ch = findChannel(channels, opts.channel);
  if (!ch) {
    console.error(`Error: Channel "${opts.channel}" not found`);
    process.exit(1);
  }

  const members = opts.member
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const removed = [];
  for (const m of members) {
    const idx = ch.members.indexOf(m);
    if (idx >= 0) {
      ch.members.splice(idx, 1);
      removed.push(m);
    }
  }

  if (removed.length) {
    ch.messages.push({
      id: "m_" + Date.now(),
      senderId: "system",
      text: `${removed.join(", ")} left #${ch.name}`,
      timestamp: Date.now(),
    });
    saveChannels(channels);
    console.log(`✓ Removed ${removed.join(", ")} from #${ch.name}`);
  } else {
    console.log(`Members not found in #${ch.name}`);
  }
}

function cmdPost(opts) {
  if (!opts.channel || !opts.message) {
    console.error("Error: --channel and --message are required");
    process.exit(1);
  }

  const channels = loadChannels();
  const ch = findChannel(channels, opts.channel);
  if (!ch) {
    console.error(`Error: Channel "${opts.channel}" not found`);
    process.exit(1);
  }

  const sender = opts.from || "main";

  ch.messages.push({
    id: "m_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
    senderId: sender,
    text: opts.message,
    timestamp: Date.now(),
  });

  saveChannels(channels);
  console.log(`✓ Posted to #${ch.name} as ${sender}`);

  if (opts.deliver !== undefined && opts.deliver !== "false") {
    const recipients = ch.members.filter((m) => m !== sender);
    if (!recipients.length) {
      console.log("  No other members to deliver to.");
      return;
    }
    const prefix = ch.type === "dm" ? "" : `[#${ch.name}] `;
    const fullMsg = `${prefix}${opts.message}`;
    console.log(`  Delivering to ${recipients.length} member(s) (fire-and-forget)...`);
    for (const agentId of recipients) {
      const child = spawn(
        "openclaw",
        ["agent", "--agent", agentId, "--message", fullMsg, "--timeout", "600"],
        { detached: true, stdio: "ignore" },
      );
      child.unref();
      console.log(`  ✓ Dispatched to ${agentId} (pid ${child.pid})`);
    }
  }
}

function cmdList() {
  const channels = loadChannels();
  if (!channels.length) {
    console.log("No channels yet.");
    return;
  }
  console.log(`\n${channels.length} channel(s):\n`);
  for (const ch of channels) {
    const msgCount = ch.messages.filter((m) => m.senderId !== "system").length;
    console.log(`  #${ch.name} (${ch.type}) — ${ch.members.length} members, ${msgCount} messages`);
    console.log(`    ${ch.description || "(no description)"}`);
    console.log(`    Members: ${ch.members.join(", ")}`);
    console.log(`    ID: ${ch.id}`);
    console.log("");
  }
}

function cmdInfo(opts) {
  if (!opts.channel) {
    console.error("Error: --channel is required");
    process.exit(1);
  }

  const channels = loadChannels();
  const ch = findChannel(channels, opts.channel);
  if (!ch) {
    console.error(`Error: Channel "${opts.channel}" not found`);
    process.exit(1);
  }

  console.log(`\n#${ch.name}`);
  console.log(`  ID: ${ch.id}`);
  console.log(`  Type: ${ch.type}`);
  console.log(`  Description: ${ch.description || "(none)"}`);
  console.log(`  Created by: ${ch.createdBy}`);
  console.log(`  Members: ${ch.members.join(", ")}`);
  console.log(`  Messages: ${ch.messages.length}`);
  console.log(`  Max turns: ${ch.maxTurns}`);

  const recent = ch.messages.slice(-5);
  if (recent.length) {
    console.log("\n  Recent messages:");
    for (const m of recent) {
      const time = new Date(m.timestamp).toISOString().slice(0, 16).replace("T", " ");
      console.log(`    [${time}] ${m.senderId}: ${m.text.slice(0, 120)}`);
    }
  }
  console.log("");
}

// ─── Main ────────────────────────────────────────────────────────────

const opts = parseArgs(process.argv.slice(2));
const cmd = opts._cmd;

switch (cmd) {
  case "create":
    cmdCreate(opts);
    break;
  case "add-member":
    cmdAddMember(opts);
    break;
  case "remove-member":
    cmdRemoveMember(opts);
    break;
  case "post":
    cmdPost(opts);
    break;
  case "list":
    cmdList();
    break;
  case "info":
    cmdInfo(opts);
    break;
  default:
    console.log(`manage-channel.mjs — Channel management for AI agents

Commands:
  create         Create a new channel
    --name       Channel name (required)
    --desc       Description
    --members    Comma-separated member IDs (default: "main")
    --from       Creator agent ID (default: "main")
    --type       "group" or "dm" (auto-detected)
    --welcome    Custom welcome message (or "false" to skip)
    --max-turns  Max agent turns per round (default: 10)

  add-member     Add member(s) to a channel
    --channel    Channel name or ID (required)
    --member     Comma-separated member IDs (required)

  remove-member  Remove member(s) from a channel
    --channel    Channel name or ID (required)
    --member     Comma-separated member IDs (required)

  post           Post a message to a channel
    --channel    Channel name or ID (required)
    --message    Message text (required)
    --from       Sender agent ID (default: "main")
    --deliver    Also send the message to all other channel members via gateway

  list           List all channels
  info           Show channel details
    --channel    Channel name or ID (required)
`);
    if (cmd) {
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
    }
}
