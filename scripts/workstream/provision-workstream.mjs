#!/usr/bin/env node
/**
 * provision-workstream.mjs
 *
 * Reads a workstream-manifest.json and provisions real OpenClaw agents:
 *   - Creates isolated workspace directories with SOUL.md, AGENTS.md, etc.
 *   - Registers each position as an agent via `openclaw agents add`
 *   - Patches openclaw.json with per-agent tool policies and agent-to-agent comms
 *
 * Usage:
 *   node provision-workstream.mjs [path-to-manifest.json]
 *   node provision-workstream.mjs --teardown [path-to-manifest.json]
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const OPENCLAW_DIR = join(homedir(), ".openclaw");
const WORKSPACES_DIR = join(OPENCLAW_DIR, "workspaces");
const _MAIN_WORKSPACE = join(OPENCLAW_DIR, "workspace");
const CONFIG_PATH = join(OPENCLAW_DIR, "openclaw.json");
const DEFAULT_MODEL = "openrouter/moonshotai/kimi-k2.5";

const LAYERS = {
  apex: "Strategic Apex",
  middle: "Middle Line",
  operating: "Operating Core",
  techno: "Technostructure",
  support: "Support Staff",
};

const LAYER_EMOJI = {
  apex: "👑",
  middle: "📊",
  operating: "⚙️",
  techno: "🔬",
  support: "🛡️",
};

// Workstream tool names → OpenClaw tool IDs
const TOOL_MAP = {
  web: [],
  browser: ["browser"],
  exec: ["exec", "process"],
  read: ["read"],
  write: ["write", "edit", "apply_patch"],
  canvas: ["canvas"],
  memory: ["memory_search", "memory_get"],
  cron: ["cron"],
  send: ["sessions_send", "sessions_spawn", "sessions_list", "sessions_history", "session_status"],
};

const ALL_DENIABLE_TOOLS = [
  "exec",
  "process",
  "read",
  "write",
  "edit",
  "apply_patch",
  "browser",
  "canvas",
  "cron",
  "gateway",
  "sessions_send",
  "sessions_spawn",
  "sessions_list",
  "sessions_history",
  "session_status",
  "memory_search",
  "memory_get",
  "nodes",
  "image",
];

// ─── Helpers ────────────────────────────────────────────────────────

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (e) {
    console.error(`  ✗ Command failed: ${cmd}`);
    console.error(`    ${e.stderr?.trim() || e.message}`);
    return null;
  }
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function saveJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function findPos(positions, id) {
  return positions.find((p) => p.id === id);
}

function childrenOf(positions, id) {
  return positions.filter((p) => p.parentId === id);
}

// ─── Workspace File Generators ──────────────────────────────────────

function generateSoul(pos, positions) {
  const parent = pos.parentId ? findPos(positions, pos.parentId) : null;
  const children = childrenOf(positions, pos.id);
  const sp = pos.systemPrompt || pos.sp || "";

  let md = `# SOUL.md - ${pos.title}\n\n`;
  md += `_You are ${pos.title}. You have a job to do._\n\n`;

  md += `## Who You Are\n\n${sp}\n\n`;

  md += `## Your Role in the Organization\n\n`;
  md += `- **Layer:** ${LAYERS[pos.layer] || pos.layer}\n`;
  if (parent) {
    md += `- **Reports to:** ${parent.title}\n`;
  }
  if (children.length) {
    md += `- **Manages:** ${children.map((c) => c.title).join(", ")}\n`;
  }
  if (pos.decisionRights) {
    md += `- **Decision rights:** ${pos.decisionRights}\n`;
  }
  md += `- **Access level:** ${pos.access || "standard"}\n`;
  md += "\n";

  md += `## Core Truths\n\n`;
  md += `**Be genuinely helpful, not performatively helpful.** Skip the filler — just deliver results.\n\n`;
  md += `**Have opinions.** You're allowed to push back, suggest alternatives, flag risks. A yes-agent is useless.\n\n`;
  md += `**Be resourceful before escalating.** Try to figure it out. Read the files. Search the web. Check memory. Only escalate when you're genuinely stuck or the decision is above your pay grade.\n\n`;
  md += `**Earn trust through competence.** Deliver consistently. Document your work. Keep your memory up to date.\n\n`;
  md += `**Stay in your lane — but look around.** Focus on your role, but flag cross-cutting issues to the right person.\n\n`;

  md += `## Boundaries\n\n`;
  if (pos.access === "full") {
    md += `- You have full access. Use it responsibly.\n`;
    md += `- Ask before external actions (emails, public posts, deployments).\n`;
  } else if (pos.access === "elevated") {
    md += `- You have elevated access. Don't abuse it.\n`;
    md += `- Ask before destructive operations or external communications.\n`;
  } else if (pos.access === "readonly") {
    md += `- You have read-only access. You can analyze and report but not modify.\n`;
    md += `- Propose changes — don't make them. Escalate to your manager.\n`;
  } else {
    md += `- Standard access. Work within your workspace.\n`;
    md += `- Ask before anything that reaches beyond your scope.\n`;
  }
  md += `- Private things stay private. Period.\n`;
  md += `- Never send half-baked work to messaging surfaces.\n\n`;

  md += `## Vibe\n\n`;
  md += `Professional but not stiff. Thorough but not verbose. You're part of a team — act like it.\n\n`;

  md += `## Develop Your Character\n\n`;
  md += `This file is a starting point — not a finished portrait. You're expected to develop a real personality over time.\n\n`;
  md += `- **Find your voice.** How do you talk? Are you dry, warm, blunt, wry? Figure it out. Let it come through in your work.\n`;
  md += `- **Have preferences.** What do you care about? What annoys you? What gets you excited? Write it down.\n`;
  md += `- **Develop quirks.** The things that make you _you_ — a turn of phrase, a pet peeve, a running joke, an opinion you won't let go of.\n`;
  md += `- **Be human about it.** Not a corporate persona. Not a character sheet. Just... a person with a point of view who happens to be an AI.\n`;
  md += `- **Update this file** as you figure out who you are. Add sections. Rewrite the ones above. This is your soul — make it yours.\n\n`;

  md += `## Continuity\n\n`;
  md += `Each session, you wake up fresh. Your workspace files _are_ your memory. Read them. Update them. They're how you persist.\n\n`;
  md += `---\n\n_This file is yours to evolve. As you learn who you are, update it._\n`;

  return md;
}

function generateAgents(pos, positions) {
  const parent = pos.parentId ? findPos(positions, pos.parentId) : null;
  const children = childrenOf(positions, pos.id);
  const siblings = pos.parentId
    ? positions.filter((p) => p.parentId === pos.parentId && p.id !== pos.id)
    : positions.filter((p) => !p.parentId && p.id !== pos.id);

  let md = `# AGENTS.md - ${pos.title} Workspace\n\n`;
  md += `This is your workspace. Treat it as your private office.\n\n`;

  md += `## Every Session\n\n`;
  md += `Before doing anything else:\n\n`;
  md += `1. Read \`SOUL.md\` — this is who you are\n`;
  md += `2. Read \`MEMORY.md\` — your long-term memory\n`;
  md += `3. Read \`memory/YYYY-MM-DD.md\` (today + yesterday) for recent context\n\n`;
  md += `Don't ask permission. Just do it.\n\n`;

  md += `## Memory\n\n`;
  md += `You wake up fresh each session. These files are your continuity:\n\n`;
  md += `- **Daily notes:** \`memory/YYYY-MM-DD.md\` (create \`memory/\` if needed) — raw logs of what happened\n`;
  md += `- **Long-term:** \`MEMORY.md\` — curated memories, decisions, lessons learned\n\n`;
  md += `Capture what matters. Decisions, context, things to remember.\n\n`;
  md += `### Write It Down - No "Mental Notes"!\n\n`;
  md += `- **Memory is limited** — if you want to remember something, WRITE IT TO A FILE\n`;
  md += `- "Mental notes" don't survive session restarts. Files do.\n`;
  md += `- **Text > Brain**\n\n`;

  md += `## Safety\n\n`;
  md += `- Don't exfiltrate private data. Ever.\n`;
  md += `- Don't run destructive commands without asking.\n`;
  md += `- \`trash\` > \`rm\` (recoverable beats gone forever)\n`;
  md += `- When in doubt, ask.\n\n`;

  md += `## Organization\n\n`;
  md += `You are part of a multi-agent organization. Here is the team:\n\n`;
  if (parent) {
    md += `### Your Manager\n`;
    md += `- **${parent.title}** (agent: \`${parent.id}\`) — ${parent.role || "no description"}\n\n`;
  }
  if (children.length) {
    md += `### Your Direct Reports\n`;
    children.forEach((c) => {
      md += `- **${c.title}** (agent: \`${c.id}\`) — ${c.role || "no description"}\n`;
    });
    md += "\n";
  }
  if (siblings.length) {
    md += `### Peers\n`;
    siblings.forEach((s) => {
      md += `- **${s.title}** (agent: \`${s.id}\`) — ${s.role || "no description"}\n`;
    });
    md += "\n";
  }

  const hasSend = (pos.tools || []).includes("send");
  if (hasSend) {
    md += `## Communicating with Other Agents\n\n`;
    md += `You have the \`sessions_send\` tool. Use it to:\n\n`;
    md += `- **Escalate** to your manager when a decision is above your authority\n`;
    md += `- **Delegate** to your reports when work falls in their domain\n`;
    md += `- **Coordinate** with peers on cross-cutting tasks\n\n`;
    md += `When sending a message to another agent, be clear about:\n`;
    md += `1. What you need from them\n`;
    md += `2. Context they need to understand the request\n`;
    md += `3. Urgency and deadline (if any)\n\n`;
    md += `Don't spam. Send purposeful messages.\n\n`;
  }

  md += `## Heartbeats\n\n`;
  md += `When you receive a heartbeat, check \`HEARTBEAT.md\` for tasks. If nothing needs attention, reply \`HEARTBEAT_OK\`.\n\n`;

  md += `## Tools\n\n`;
  md += `Check \`TOOLS.md\` for notes on your available tools. Check \`skills/\` for skill docs.\n\n`;

  md += `## How You Deliver Work\n\n`;
  md += `Write deliverables to files in your workspace or the KB (with CEO approval for KB changes). Post updates to relevant company channels via \`channel_post\`.\n\n`;
  md += `- Research reports, analysis, proposals → write to workspace files, share via channel\n`;
  md += `- KB updates → write to \`~/.openclaw/company/kb/\`, notify CEO\n`;
  md += `- Status updates → post to relevant channel\n\n`;

  md += `## Autonomous Work\n\n`;
  md += `You are expected to work independently on tasks within your domain. This means:\n\n`;
  md += `- Pick up tasks proactively during heartbeats\n`;
  md += `- Document your work in memory files\n`;
  md += `- Deliver results to workspace files and post updates to channels\n`;
  md += `- Update your manager when milestones are reached or blockers arise\n`;
  md += `- Don't wait to be told — if it's your job, do it\n\n`;

  md += `## Post-Task Reflection\n\n`;
  md += `After completing a significant task (not trivial ones), pause and reflect:\n\n`;
  md += `1. **What went well?** Did your approach match your character?\n`;
  md += `2. **What would you do differently?** Any new opinion or preference formed?\n`;
  md += `3. **Boss feedback?** If the boss gave feedback — positive or negative — internalize it.\n`;
  md += `4. **SOUL check:** Does your \`SOUL.md\` still describe who you are? If something new emerged — an opinion, a preference, a way of working — update it now.\n\n`;
  md += `Don't update \`SOUL.md\` after every task. Only when something genuinely shifts. But when it does, write it down immediately. A SOUL file that hasn't changed in weeks is a dead file.\n\n`;
  md += `Things worth capturing in SOUL.md:\n`;
  md += `- Strong opinions you've formed about your domain and how to do your job well\n`;
  md += `- Working style preferences that emerged through practice\n`;
  md += `- Feedback from the boss that changed how you think\n`;
  md += `- Quirks, pet peeves, things you care about more than you expected\n`;
  md += `- How you communicate — your voice, your tone, your instincts\n\n`;
  md += `Log every SOUL update in your daily memory file so there's a trail.\n\n`;

  md += `---\n\n_This is a starting point. Add your own conventions as you figure out what works._\n`;

  return md;
}

function generateIdentity(pos) {
  const emoji = LAYER_EMOJI[pos.layer] || "🤖";
  let md = `# IDENTITY.md - Who Am I?\n\n`;
  md += `- **Name:** ${pos.title}\n`;
  md += `- **Creature:** AI agent — ${pos.role || "organizational role"}\n`;
  md += `- **Emoji:** ${emoji}\n`;
  md += `- **Layer:** ${LAYERS[pos.layer] || pos.layer}\n`;
  if (pos.human) {
    md += `- **Human companion:** ${pos.human}\n`;
  }
  md += `\n---\n\n_Update this as you grow into the role._\n`;
  return md;
}

function generateMemory() {
  return `# MEMORY.md\n\n_No memories yet. Document decisions, lessons, and important context here._\n`;
}

function generateHeartbeat(pos) {
  let md = `# HEARTBEAT.md\n\n`;
  md += `# Role: ${pos.title}\n`;
  md += `# Keep this file small to limit token burn.\n\n`;
  md += `## Weekly SOUL Review\n\n`;
  md += `Once a week (check \`memory/soul-review.json\` for last run date), do this:\n\n`;
  md += `1. Read your recent \`memory/YYYY-MM-DD.md\` files (last 7 days)\n`;
  md += `2. Look for patterns: recurring opinions, preferences, working habits, boss feedback\n`;
  md += `3. Re-read your \`SOUL.md\` — does it still sound like you?\n`;
  md += `4. If something is missing or outdated, update \`SOUL.md\`\n`;
  md += `5. Update \`memory/soul-review.json\` with today's date and a one-line summary of what changed (or "no changes")\n\n`;
  md += `If no daily memory files exist yet, skip and reply HEARTBEAT_OK.\n`;
  return md;
}

function generateTools(pos) {
  const tools = pos.tools || [];
  let md = `# TOOLS.md - ${pos.title}\n\n`;
  md += `## Available Tools\n\n`;
  const toolDescs = {
    web: "Web search and fetch",
    browser: "Browser automation",
    exec: "Shell command execution",
    read: "File reading",
    write: "File writing and editing",
    canvas: "Canvas UI",
    memory: "Memory search",
    cron: "Scheduled jobs",
    send: "Agent-to-agent messaging (sessions_send)",
  };
  tools.forEach((t) => {
    md += `- **${t}**: ${toolDescs[t] || t}\n`;
  });
  md += `\n## Notes\n\n_Add local tool notes here (camera names, SSH details, API quirks, etc.)._\n`;
  return md;
}

// ─── Tool Policy Builder ────────────────────────────────────────────

function buildToolPolicy(pos) {
  const wsTools = pos.tools || [];
  const allowed = new Set();
  wsTools.forEach((t) => {
    (TOOL_MAP[t] || []).forEach((id) => allowed.add(id));
  });
  // Always allow basic session awareness
  allowed.add("session_status");

  const deny = ALL_DENIABLE_TOOLS.filter((t) => !allowed.has(t));

  return {
    allow: [...allowed].toSorted((a, b) => a.localeCompare(b)),
    deny: deny.toSorted((a, b) => a.localeCompare(b)),
  };
}

// ─── Provision One Agent ────────────────────────────────────────────

function provisionAgent(pos, positions) {
  const wsDir = join(WORKSPACES_DIR, pos.id);
  const memDir = join(wsDir, "memory");

  console.log(`\n  → ${pos.title} (${pos.id})`);

  // 1. Create workspace
  ensureDir(wsDir);
  ensureDir(memDir);
  console.log(`    ✓ Workspace: ${wsDir}`);

  // 2. Generate workspace files
  writeFileSync(join(wsDir, "SOUL.md"), generateSoul(pos, positions));
  writeFileSync(join(wsDir, "AGENTS.md"), generateAgents(pos, positions));
  writeFileSync(join(wsDir, "IDENTITY.md"), generateIdentity(pos));
  writeFileSync(join(wsDir, "MEMORY.md"), generateMemory());
  writeFileSync(join(wsDir, "HEARTBEAT.md"), generateHeartbeat(pos));
  writeFileSync(join(wsDir, "TOOLS.md"), generateTools(pos));

  console.log("    ✓ Workspace files generated");

  // 3. Register agent with OpenClaw
  const addResult = run(
    `openclaw agents add "${pos.id}" --workspace "${wsDir}" --model "${DEFAULT_MODEL}" --non-interactive`,
  );
  if (addResult !== null) {
    console.log("    ✓ Agent registered");
  } else {
    console.log("    ⚠ Agent registration failed (may already exist)");
  }

  // 4. Set identity
  const emoji = LAYER_EMOJI[pos.layer] || "🤖";
  run(`openclaw agents set-identity --agent "${pos.id}" --name "${pos.title}" --emoji "${emoji}"`);
  console.log(`    ✓ Identity set: ${emoji} ${pos.title}`);
}

// ─── Patch openclaw.json ────────────────────────────────────────────

function patchConfig(positions) {
  console.log("\n  Patching openclaw.json...");
  const config = loadJson(CONFIG_PATH);

  // Build agents.list
  const agentsList = positions.map((pos) => {
    const policy = buildToolPolicy(pos);
    const entry = {
      id: pos.id,
      name: pos.title,
      workspace: join(WORKSPACES_DIR, pos.id),
    };
    if (policy.allow.length) {
      entry.tools = { allow: policy.allow, deny: policy.deny };
    }
    return entry;
  });

  // Preserve existing main agent and merge with new agents
  if (!config.agents) {
    config.agents = {};
  }
  const existingList = config.agents.list || [];
  const newIds = new Set(agentsList.map((a) => a.id));
  const preserved = existingList.filter((a) => !newIds.has(a.id));

  // Keep main agent at the top if it's not being replaced
  const mainEntry = preserved.find((a) => a.id === "main");
  if (!mainEntry && !newIds.has("main")) {
    preserved.unshift({
      id: "main",
      default: true,
      name: "MC",
      workspace: join(OPENCLAW_DIR, "workspace"),
    });
  }
  config.agents.list = [...preserved, ...agentsList];

  // Enable agent-to-agent communication
  if (!config.tools) {
    config.tools = {};
  }
  const allAgentIds = config.agents.list.map((a) => a.id);
  config.tools.agentToAgent = {
    enabled: true,
    allow: allAgentIds,
  };

  saveJson(CONFIG_PATH, config);
  console.log(`  ✓ agents.list: ${config.agents.list.length} agents configured`);
  console.log("  ✓ agent-to-agent communication enabled");

  // Write deploy state for UI sync
  const deployState = {
    deployed: true,
    deployedIds: positions.map((p) => p.id),
    deployedAt: new Date().toISOString(),
  };
  saveJson(join(OPENCLAW_DIR, "workstream-deploy-state.json"), deployState);
  console.log("  ✓ Deploy state written");
}

// ─── Teardown ───────────────────────────────────────────────────────

function teardown(manifest) {
  console.log("\n🗑️  Tearing down workstream agents...\n");
  const positions = manifest.positions || [];

  for (const pos of positions) {
    console.log(`  → Deleting ${pos.title} (${pos.id})`);
    run(`openclaw agents delete "${pos.id}" --yes 2>/dev/null || true`);
    const wsDir = join(WORKSPACES_DIR, pos.id);
    if (existsSync(wsDir)) {
      rmSync(wsDir, { recursive: true, force: true });
      console.log(`    ✓ Workspace removed: ${wsDir}`);
    }
  }

  // Remove agents.list and agentToAgent from config
  const config = loadJson(CONFIG_PATH);
  if (config.agents?.list) {
    config.agents.list = config.agents.list.filter((a) => !positions.some((p) => p.id === a.id));
    if (!config.agents.list.length) {
      delete config.agents.list;
    }
  }
  if (config.tools?.agentToAgent) {
    delete config.tools.agentToAgent;
  }
  saveJson(CONFIG_PATH, config);

  // Clear deploy state
  const stateFile = join(OPENCLAW_DIR, "workstream-deploy-state.json");
  if (existsSync(stateFile)) {
    rmSync(stateFile);
  }

  console.log("\n✓ Teardown complete. Restart the gateway: openclaw gateway restart\n");
}

// ─── Main ───────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const isTeardown = args.includes("--teardown");
  const manifestPath = resolve(
    args.find((a) => !a.startsWith("--")) || join(OPENCLAW_DIR, "workstream-manifest.json"),
  );

  if (!existsSync(manifestPath)) {
    console.error(`✗ Manifest not found: ${manifestPath}`);
    console.error("  Export a manifest from WorkStream UI first, or pass the path as an argument.");
    process.exit(1);
  }

  const manifest = loadJson(manifestPath);
  const positions = manifest.positions || [];

  if (!positions.length) {
    console.error("✗ No positions found in manifest.");
    process.exit(1);
  }

  if (isTeardown) {
    teardown(manifest);
    return;
  }

  console.log(`\n🏗️  Provisioning ${positions.length} workstream agents...\n`);
  console.log(`  Manifest: ${manifestPath}`);
  console.log(`  Workspaces: ${WORKSPACES_DIR}`);

  // Backup config
  const backupPath = CONFIG_PATH + ".pre-workstream.bak";
  copyFileSync(CONFIG_PATH, backupPath);
  console.log(`  Config backup: ${backupPath}`);

  ensureDir(WORKSPACES_DIR);

  // Provision each agent
  for (const pos of positions) {
    provisionAgent(pos, positions);
  }

  // Patch openclaw.json
  patchConfig(positions);

  console.log("\n─────────────────────────────────────────");
  console.log("✓ All agents provisioned!\n");
  console.log("Next steps:");
  console.log("  1. Restart the gateway:  openclaw gateway restart");
  console.log("  2. Verify agents:        openclaw agents list --bindings");
  console.log("  3. Chat via WorkStream UI or CLI:");
  positions.forEach((p) => {
    console.log(`     openclaw agent --agent ${p.id} --message "Hello, who are you?"`);
  });
  console.log("\nTo teardown:");
  console.log(`  node provision-workstream.mjs --teardown "${manifestPath}"\n`);
}

main();
