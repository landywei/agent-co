#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
OPENCLAW_DIR="$HOME/.openclaw"
BACKUP="$REPO_DIR/config-backup.json"

echo "=== Fresh Start ==="
echo "Repo:    $REPO_DIR"
echo "State:   $OPENCLAW_DIR"
echo ""

# 1. Kill gateway
echo "[1/6] Killing gateway..."
pkill -9 -f openclaw-gateway 2>/dev/null || true
sleep 1

# 2. Wipe state
echo "[2/6] Removing $OPENCLAW_DIR..."
rm -rf "$OPENCLAW_DIR"

# 3. Build
echo "[3/6] Building..."
cd "$REPO_DIR"
pnpm build --silent 2>&1 | tail -1

# 4. Onboard
echo "[4/6] Onboarding..."
"$REPO_DIR/openclaw.mjs" onboard \
  --non-interactive \
  --accept-risk \
  --mode local \
  --auth-choice custom-api-key \
  --custom-base-url "http://build-api-1.ifmapp.net:8000/v1" \
  --custom-api-key "sk-XRQV0fFqJ7VfUIcfswIpZTckzFfL8LTqC1M2R1O30z7d2KQA2S" \
  --custom-compatibility openai \
  --custom-model-id "LLM360/K2-Think-V2" \
  --custom-provider-id "k2-think-v2" \
  --gateway-auth token \
  --gateway-token "d6d3d19f4425cf12d044525311e173f80b42f581c41058bb" \
  --gateway-port 18789 \
  --gateway-bind loopback \
  --skip-channels \
  --skip-skills \
  --skip-daemon \
  --skip-ui \
  2>&1 | grep -v "^Error:" || true

# 5. Patch config (fix model metadata + inject credentials)
echo "[5/6] Patching config from $BACKUP..."
node -e '
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const backup = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

// Fix model context window / max tokens (onboard defaults to 4096)
const model = cfg.models.providers["k2-think-v2"].models[0];
model.contextWindow = 131072;
model.maxTokens = 64000;
model.name = "K2 Think V2";

// Model alias
cfg.agents.defaults.models = backup["agents.defaults.models"];

// Web search
if (!cfg.tools) cfg.tools = {};
if (!cfg.tools.web) cfg.tools.web = {};
if (!cfg.tools.web.search) cfg.tools.web.search = {};
cfg.tools.web.search.apiKey = backup["tools.web.search.apiKey"];

// Slack
if (!cfg.channels) cfg.channels = {};
if (!cfg.channels.slack) cfg.channels.slack = {};
cfg.channels.slack.botToken = backup["channels.slack.botToken"];
cfg.channels.slack.appToken = backup["channels.slack.appToken"];

// WhatsApp
if (!cfg.channels.whatsapp) cfg.channels.whatsapp = {};
cfg.channels.whatsapp.allowFrom = backup["channels.whatsapp.allowFrom"];

fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2) + "\n");
' "$OPENCLAW_DIR/openclaw.json" "$BACKUP"

# 6. Start gateway
echo "[6/6] Starting gateway..."
"$REPO_DIR/openclaw.mjs" gateway run --port 18789 --bind loopback --force &
GW_PID=$!

# Wait for startup
for i in $(seq 1 15); do
  sleep 1
  if grep -q "listening on ws://" /tmp/openclaw/openclaw-"$(date +%Y-%m-%d)".log 2>/dev/null; then
    break
  fi
done

echo ""
echo "=== Done ==="
echo "Gateway PID: $GW_PID"
echo "Portal:      http://127.0.0.1:18789"
echo "CEO SOUL:    $OPENCLAW_DIR/workspace/SOUL.md"
echo "Company:     $OPENCLAW_DIR/company/"
echo "KB files:    $(ls "$OPENCLAW_DIR/company/kb/" | wc -l | tr -d ' ')"
echo ""
echo "If the browser shows stale data, clear site data for 127.0.0.1:18789"
