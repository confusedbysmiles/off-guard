#!/usr/bin/env bash
#
# Install Off-Guard as a launchd agent on macOS.
#
#     ./deploy/macos/install.sh
#
# The plist next to this script is a template with placeholder paths. Editing
# those by hand is a step that gets skipped, and the failure is silent: launchd
# reports `EX_CONFIG` into a log file it also could not open, so there is
# nothing on screen and nothing on disk. This fills them in instead.
#
# Everything here is reversible:
#
#     ./deploy/macos/install.sh --uninstall
#
set -euo pipefail

LABEL="com.drseim.off-guard"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TEMPLATE="$HERE/${LABEL}.plist"
TARGET="$HOME/Library/LaunchAgents/${LABEL}.plist"
DOMAIN="gui/$(id -u)"

unload() {
  # `bootout` fails when nothing is loaded, which is not an error here.
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
}

if [[ "${1:-}" == "--uninstall" ]]; then
  unload
  rm -f "$TARGET"
  echo "Removed. The database at ~/Library/Application Support/off-guard is untouched."
  exit 0
fi

# --- what this machine actually has ------------------------------------------

NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then
  echo "node is not on your PATH. Install Node 20 or newer first." >&2
  exit 1
fi

NODE_MAJOR="$("$NODE" -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')"
if (( NODE_MAJOR < 20 )); then
  echo "node $NODE_MAJOR is too old; Off-Guard needs 20 or newer." >&2
  exit 1
fi

DB_DIR="$HOME/Library/Application Support/off-guard"
LOG_DIR="$HOME/Library/Logs"
mkdir -p "$DB_DIR" "$LOG_DIR" "$HOME/Library/LaunchAgents"

if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "Dependencies are not installed. Run: npm ci" >&2
  exit 1
fi

# --- write the plist ----------------------------------------------------------

# `|` as the delimiter, because every value here is a path.
sed \
  -e "s|<string>/usr/local/bin/node</string>|<string>${NODE}</string>|" \
  -e "s|/Users/YOU/Documents/VSCode/off-guard|${ROOT}|" \
  -e "s|/Users/YOU/Library/Application Support/off-guard|${DB_DIR}|" \
  -e "s|/Users/YOU/Library/Logs|${LOG_DIR}|" \
  "$TEMPLATE" > "$TARGET"

if grep -q "/Users/YOU" "$TARGET"; then
  echo "A placeholder survived substitution; refusing to install a broken agent." >&2
  grep -n "/Users/YOU" "$TARGET" >&2
  rm -f "$TARGET"
  exit 1
fi

plutil -lint "$TARGET" > /dev/null

# --- load it ------------------------------------------------------------------

unload
launchctl bootstrap "$DOMAIN" "$TARGET"
launchctl kickstart -k "$DOMAIN/$LABEL"

# --- and prove it is actually answering ---------------------------------------

PORT="$(grep -A1 'OFF_GUARD_PORT' "$TARGET" | tail -1 | sed 's/[^0-9]//g')"
PORT="${PORT:-8787}"

for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT}/healthz" > /dev/null 2>&1; then
    echo "Off-Guard is running on http://127.0.0.1:${PORT}"
    echo
    echo "  node:      $NODE"
    echo "  from:      $ROOT"
    echo "  database:  $DB_DIR/off-guard.sqlite"
    echo "  log:       $LOG_DIR/off-guard.log"
    echo
    echo "Your GM link, printed once and never again:"
    echo "  cd $ROOT && node tools/mint-gm-token.js"
    exit 0
  fi
  sleep 0.5
done

echo "It loaded but is not answering on ${PORT}. What the agent says:" >&2
launchctl print "$DOMAIN/$LABEL" 2>&1 | grep -E 'state =|last exit' >&2 || true
echo "--- log:" >&2
tail -20 "$LOG_DIR/off-guard.log" >&2 2>/dev/null || echo "  (empty)" >&2
exit 1
