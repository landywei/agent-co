#!/bin/bash
set -e

OCDIR="$HOME/.openclaw"
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="$HOME/.openclaw-backup-$(date +%Y%m%d-%H%M%S)"

echo ""
echo "═══════════════════════════════════════"
echo "  OpenClaw Company Reset (nuclear)"
echo "═══════════════════════════════════════"
echo ""

# 1. Kill gateway
echo "⏹  Stopping gateway..."
pkill -f "openclaw-gateway" 2>/dev/null && sleep 1 && echo "   Stopped." || echo "   Not running."

# 2. Back up and nuke entire .openclaw directory
if [ -d "$OCDIR" ]; then
  echo "💾  Backing up $OCDIR → $BACKUP_DIR ..."
  mv "$OCDIR" "$BACKUP_DIR"
  echo "   Backed up."
else
  echo "   No existing $OCDIR to back up."
fi

rm -rf "$OCDIR"
mkdir -p "$OCDIR"
echo "🗑  Fresh $OCDIR created."

# 3. Restore credentials from backup (keys/tokens survive resets)
if [ -d "$BACKUP_DIR/credentials" ]; then
  echo "🔑  Restoring credentials..."
  cp -r "$BACKUP_DIR/credentials" "$OCDIR/credentials"
  echo "   Done."
fi

# 4. Restore sessions (Pi sessions) from backup
if [ -d "$BACKUP_DIR/sessions" ]; then
  echo "🔑  Restoring sessions..."
  cp -r "$BACKUP_DIR/sessions" "$OCDIR/sessions"
  echo "   Done."
fi

# 5. Write openclaw.json from config-backup (model providers, gateway.mode, keys)
echo "🔧  Writing openclaw.json..."
BACKUP_CFG="$REPO_DIR/config-backup.json"
if [ -f "$BACKUP_CFG" ]; then
  node -e '
const fs = require("fs");
const backup = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const cfg = {};

if (backup.models) {
  cfg.models = { providers: {} };
  for (const [k, v] of Object.entries(backup.models.providers || {})) {
    cfg.models.providers[k] = v;
  }
}

function setPath(obj, path, val) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
}
for (const [k, v] of Object.entries(backup)) {
  if (k === "models") continue;
  setPath(cfg, k, v);
}

fs.writeFileSync(process.argv[2], JSON.stringify(cfg, null, 2) + "\n");
console.log("   Done (from config-backup.json).");
' "$BACKUP_CFG" "$OCDIR/openclaw.json"
else
  echo '{}' > "$OCDIR/openclaw.json"
  echo "   ⚠  No config-backup.json — wrote empty config."
fi

# 6. Sync okkslides skill (non-bundled, needs per-instance config)
if [ -d "$REPO_DIR/skills/okkslides" ]; then
  echo "📊  Syncing okkslides skill..."
  mkdir -p "$OCDIR/skills"
  cp -r "$REPO_DIR/skills/okkslides" "$OCDIR/skills/"
  echo "   Done."
fi

# 7. Reset timestamp (tells frontend to wipe localStorage and show "Create Company")
RESET_TS=$(date +%s)
echo "window.__RESET_TS=${RESET_TS};" > "$OCDIR/reset-ts.js"
echo "   Reset timestamp: ${RESET_TS}"

# 8. Start gateway
echo "🚀  Starting gateway..."
"$REPO_DIR/openclaw.mjs" gateway run --port 18789 --bind loopback --force &
sleep 2

echo ""
echo "═══════════════════════════════════════"
echo "  ✓ Nuclear reset complete!"
echo ""
echo "  Backup at: $BACKUP_DIR"
echo ""
echo "  Next: open workstream.html and"
echo "  create your new company."
echo "═══════════════════════════════════════"
echo ""
