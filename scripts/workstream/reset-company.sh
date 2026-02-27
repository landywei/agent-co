#!/bin/bash
set -e

OCDIR="$HOME/.openclaw"
DATE=$(date +%Y-%m-%d)

echo ""
echo "═══════════════════════════════════════"
echo "  OpenClaw Company Reset"
echo "═══════════════════════════════════════"
echo ""

# 1. Kill gateway
echo "⏹  Stopping gateway..."
pkill -f "openclaw-gateway" 2>/dev/null && sleep 1 && echo "   Stopped." || echo "   Not running."

# 2. Remove all hired agent workspaces
echo "🗑  Removing agent workspaces..."
rm -rf "$OCDIR/workspaces/"*/
echo "   Done."

# 3. Remove all agent registrations (including main sessions)
echo "🗑  Removing agent registrations..."
rm -rf "$OCDIR/agents/"*/
echo "   Done."

# 4. Reset CEO workspace memory
echo "🧹  Resetting CEO memory..."
rm -rf "$OCDIR/workspace/memory"
cat > "$OCDIR/workspace/MEMORY.md" << 'EOF'
# MEMORY.md

_No memories yet. This is a fresh start._
EOF
echo "   Done."

# 5. Clear cron jobs
echo "🧹  Clearing cron jobs..."
echo '{"version":1,"jobs":[]}' > "$OCDIR/cron/jobs.json"
echo "   Done."

# 6. Restore clean openclaw.json
echo "🔧  Restoring clean config..."
cp "$OCDIR/openclaw.clean.json" "$OCDIR/openclaw.json"
echo "   Done."

# 6b. Sync okkslides skill (when run from repo)
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
if [ -d "$REPO_DIR/skills/okkslides" ]; then
  echo "📊  Syncing okkslides skill..."
  mkdir -p "$OCDIR/skills"
  cp -r "$REPO_DIR/skills/okkslides" "$OCDIR/skills/"
  echo "   Done."
fi

# 7. Reset company files
echo "📄  Resetting company files..."
cat > "$OCDIR/company/CHARTER.md" << EOF
# Company Charter

## Company Goal

> [To be set when company is created]

## Founded
- **Date:** $DATE
- **Founder Role:** Investor (Human)
- **CEO:** AI Agent (main)

## Operating Principles
1. The CEO runs the company autonomously
2. The investor provides funding and strategic guidance
3. All decisions are documented in the knowledge base
4. Transparency through regular investor updates

## Initial Investment
- **Amount:** [To be set]
- **Runway:** [To be calculated]

## Success Criteria
> [CEO defines based on goal]
EOF

cat > "$OCDIR/company/ROSTER.md" << 'EOF'
# Company Roster

## Active Team

| Agent ID | Title | Role | Hired | Status |
|----------|-------|------|-------|--------|
| main | CEO | Chief Agent Officer | Founding | Active |

## Open Positions

_None yet — CEO will identify hiring needs._
EOF

cat > "$OCDIR/company/BUDGET.md" << 'EOF'
# Company Budget

## Investment
- **Total Invested:** $0
- **Available:** $0

## Monthly Costs

| Item | Cost | Notes |
|------|------|-------|
| AI Inference | Variable | Per-token costs |

## Runway
- **Current Burn Rate:** $0/mo
- **Runway:** N/A

## Budget Requests
_None pending._
EOF

echo '{"created":false}' > "$OCDIR/company-state.json"
echo "   Done."

# 8. Reset KB directory (empty — CEO creates files organically)
echo "📚  Resetting KB..."
rm -rf "$OCDIR/company/kb"
mkdir -p "$OCDIR/company/kb"

echo "   KB directory cleared (CEO will create files as needed)."

# 9. Reset channels & frontend reset signal
echo "💬  Resetting channels..."
echo '[]' > "$OCDIR/company/channels.json"
echo 'window.__CHANNELS_DATA=[];' > "$OCDIR/channels-data.js"
RESET_TS=$(date +%s)
echo "window.__RESET_TS=${RESET_TS};" > "$OCDIR/reset-ts.js"
echo "   Done (reset timestamp: ${RESET_TS})."

# 10. Regenerate frontend cache files
echo "⚡  Regenerating frontend caches..."
node -e "
const fs = require('fs'), p = require('path'), os = require('os');
const ocDir = p.join(os.homedir(), '.openclaw');
const d = p.join(ocDir, 'company/kb'), s = {};
fs.readdirSync(d).filter(f => f.endsWith('.md')).sort().forEach(f => { s[f] = fs.readFileSync(p.join(d, f), 'utf8'); });
const k = Object.keys(s).sort();
fs.writeFileSync(p.join(ocDir, 'kb-data.js'), 'window.__KB_DATA=' + JSON.stringify(s) + ';\nwindow.__KB_FILES=' + JSON.stringify(k) + ';\n');
const I = ['IDENTITY.md','SOUL.md','AGENTS.md','MEMORY.md','HEARTBEAT.md','TOOLS.md','RECRUITMENT.md'];
const a = { main: {} };
const cw = p.join(ocDir, 'workspace');
I.forEach(f => { const x = p.join(cw, f); if (fs.existsSync(x)) a.main[f] = fs.readFileSync(x, 'utf8'); });
fs.writeFileSync(p.join(ocDir, 'agents-data.js'), 'window.__AGENTS_DATA=' + JSON.stringify(a) + ';\n');
const ch = JSON.parse(fs.readFileSync(p.join(ocDir, 'company/channels.json'), 'utf8'));
fs.writeFileSync(p.join(ocDir, 'channels-data.js'), 'window.__CHANNELS_DATA=' + JSON.stringify(ch) + ';\n');
console.log('   kb-data.js: ' + k.length + ' files, agents-data.js: 1 agent, channels-data.js: ' + ch.length + ' channels');
"

# 11. Start gateway
echo "🚀  Starting gateway..."
openclaw gateway start
sleep 2

echo ""
echo "═══════════════════════════════════════"
echo "  ✓ Reset complete!"
echo ""
echo "  Next: open workstream.html and"
echo "  create your new company."
echo "═══════════════════════════════════════"
echo ""
