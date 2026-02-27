#!/usr/bin/env node
/**
 * fire-agent.mjs
 *
 * Used by the CEO to terminate an agent.
 * Archives their workspace (doesn't delete), removes from config.
 *
 * Usage:
 *   node fire-agent.mjs --id researcher --reason "Position eliminated"
 */

import { execSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const OPENCLAW_DIR = join(homedir(), ".openclaw");
const WORKSPACES_DIR = join(OPENCLAW_DIR, "workspaces");
const COMPANY_DIR = join(OPENCLAW_DIR, "company");
const CONFIG_PATH = join(OPENCLAW_DIR, "openclaw.json");

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function saveJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      parsed[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return parsed;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.id) {
    console.error('Usage: node fire-agent.mjs --id <agent_id> [--reason "Reason"]');
    process.exit(1);
  }

  const { id, reason } = opts;
  const reasonText = reason || "No reason specified";

  if (id === "main") {
    console.error("  ✗ Cannot fire the CEO (main agent).");
    process.exit(1);
  }

  console.log(`\n🚪 Terminating: ${id}\n`);
  console.log(`  Reason: ${reasonText}\n`);

  // 1. Archive workspace
  const wsDir = join(WORKSPACES_DIR, id);
  if (existsSync(wsDir)) {
    const archiveDir = join(WORKSPACES_DIR, ".archive");
    mkdirSync(archiveDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const archivePath = join(archiveDir, `${id}-${ts}`);
    renameSync(wsDir, archivePath);
    console.log(`  ✓ Workspace archived to: ${archivePath}`);
  } else {
    console.log("  ⚠ No workspace found (may have already been removed)");
  }

  // 2. Delete from OpenClaw
  run(`openclaw agents delete "${id}" --yes 2>/dev/null`);
  console.log("  ✓ Agent deregistered");

  // 3. Update config
  const config = loadJson(CONFIG_PATH);

  if (config.agents?.list) {
    config.agents.list = config.agents.list.filter((a) => a.id !== id);
  }

  if (config.tools?.agentToAgent?.allow) {
    config.tools.agentToAgent.allow = config.tools.agentToAgent.allow.filter((a) => a !== id);
  }

  saveJson(CONFIG_PATH, config);
  console.log("  ✓ Config updated");

  // 4. Update roster
  const rosterPath = join(COMPANY_DIR, "ROSTER.md");
  if (existsSync(rosterPath)) {
    let roster = readFileSync(rosterPath, "utf-8");
    const now = new Date().toISOString().split("T")[0];

    // Find the agent's row in Active Team and extract info
    const rowRegex = new RegExp(`\\| ${id} \\| ([^|]+)\\| ([^|]+)\\| ([^|]+)\\| Active \\|`);
    const match = roster.match(rowRegex);

    if (match) {
      const title = match[1].trim();
      const hired = match[3].trim();

      // Remove from active team
      roster = roster.replace(new RegExp(`\\n\\| ${id} \\|[^\\n]+`), "");

      // Add to departed section
      const departedRow = `| ${id} | ${title} | ${hired} | ${now} | ${reasonText} |`;
      if (roster.includes("## Departed")) {
        roster = roster.replace(
          /(\| Agent ID \| Title \| Hired \| Departed \| Reason \|\n\|[^\n]+\|)/,
          `$1\n${departedRow}`,
        );
      }

      writeFileSync(rosterPath, roster);
      console.log("  ✓ Roster updated");
    }
  }

  // Regenerate agents-data.js for frontend
  try {
    const inspFiles = [
      "IDENTITY.md",
      "SOUL.md",
      "AGENTS.md",
      "MEMORY.md",
      "HEARTBEAT.md",
      "TOOLS.md",
      "RECRUITMENT.md",
    ];
    const agentsData = {};
    const ceoWs = join(OPENCLAW_DIR, "workspace");
    if (existsSync(ceoWs)) {
      agentsData.main = {};
      for (const f of inspFiles) {
        const fp = join(ceoWs, f);
        if (existsSync(fp)) {
          agentsData.main[f] = readFileSync(fp, "utf8");
        }
      }
    }
    if (existsSync(WORKSPACES_DIR)) {
      for (const d of readdirSync(WORKSPACES_DIR)) {
        const aw = join(WORKSPACES_DIR, d);
        if (!statSync(aw).isDirectory() || d.startsWith(".")) {
          continue;
        }
        agentsData[d] = {};
        for (const f of inspFiles) {
          const fp = join(aw, f);
          if (existsSync(fp)) {
            agentsData[d][f] = readFileSync(fp, "utf8");
          }
        }
      }
    }
    writeFileSync(
      join(OPENCLAW_DIR, "agents-data.js"),
      "window.__AGENTS_DATA=" + JSON.stringify(agentsData) + ";\n",
    );
    console.log("  ✓ agents-data.js updated");
  } catch (e) {
    console.log("  ⚠ agents-data.js update failed:", e.message);
  }

  console.log(`\n─────────────────────────────────────────`);
  console.log(`✓ ${id} terminated.\n`);
  console.log("⚠ IMPORTANT — Gateway restart required to fully deregister.");
  console.log("  After you finish all hires/fires, schedule resume + restart:");
  console.log(
    '  1. openclaw cron add --agent main --at "+1m" --message "Resume after gateway restart" --delete-after-run --timeout 300000',
  );
  console.log("  2. openclaw gateway restart");
  console.log("");
  console.log("Other next steps:");
  console.log("  1. Update team roster, org structure, and decision log in the KB");
  console.log("  2. Reassign any pending work\n");
}

main();
