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
BACKUP_LABEL="com.drseim.off-guard-backup"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TEMPLATE="$HERE/${LABEL}.plist"
TARGET="$HOME/Library/LaunchAgents/${LABEL}.plist"
BACKUP_TEMPLATE="$HERE/${BACKUP_LABEL}.plist"
BACKUP_TARGET="$HOME/Library/LaunchAgents/${BACKUP_LABEL}.plist"
DOMAIN="gui/$(id -u)"

# Unload, and wait for launchd to actually finish.
#
# `bootout` returns before the job is gone, and a `bootstrap` issued into that
# gap fails with "Input/output error" -- which on a re-run leaves the agent
# uninstalled and not reinstalled, the worst of both. So poll until the label
# really is absent.
unload() {
  local label="${1:-$LABEL}"
  # `bootout` fails when nothing is loaded, which is not an error here.
  launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
  for _ in $(seq 1 40); do
    launchctl print "$DOMAIN/$label" > /dev/null 2>&1 || return 0
    sleep 0.25
  done
  echo "launchd is still holding $label after ten seconds." >&2
  return 1
}

# And bootstrap with a retry, for the same reason from the other side.
bootstrap() {
  local target="${1:-$TARGET}"
  for attempt in 1 2 3; do
    if launchctl bootstrap "$DOMAIN" "$target" 2>/dev/null; then return 0; fi
    sleep 1
  done
  # Let the last attempt print its own error.
  launchctl bootstrap "$DOMAIN" "$target"
}

# Fill this machine's real paths into a plist template.
#
# `|` as the delimiter, because every value here is a path. The check afterwards
# is the point: a surviving placeholder loads an agent that cannot start, and
# launchd reports EX_CONFIG into a log file it also cannot open, so there is
# nothing on screen and nothing on disk.
render() {
  local template="$1" target="$2"
  sed \
    -e "s|<string>/usr/local/bin/node</string>|<string>${NODE}</string>|" \
    -e "s|/Users/YOU/Documents/VSCode/off-guard|${ROOT}|" \
    -e "s|/Users/YOU/Library/Application Support/off-guard|${DB_DIR}|" \
    -e "s|/Users/YOU/Library/Logs|${LOG_DIR}|" \
    "$template" > "$target"

  if grep -q "/Users/YOU" "$target"; then
    echo "A placeholder survived substitution; refusing to install a broken agent." >&2
    grep -n "/Users/YOU" "$target" >&2
    rm -f "$target"
    exit 1
  fi
  plutil -lint "$target" > /dev/null
}

if [[ "${1:-}" == "--uninstall" ]]; then
  unload "$BACKUP_LABEL"
  rm -f "$BACKUP_TARGET"
  unload "$LABEL"
  rm -f "$TARGET"
  echo "Removed both agents. The database at ~/Library/Application Support/off-guard"
  echo "and anything in ~/off-guard-backups are untouched."
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

# --- make the shell agree with the service ------------------------------------
#
# The plist tells the service where the database is. A `node tools/...` typed
# into a terminal would otherwise take the default and quietly work on a
# different file -- which is how "A GM token already exists" gets reported about
# a database the running server has never opened. `.env` is what both read.

ENV_FILE="$ROOT/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  {
    echo "# Written by deploy/macos/install.sh. See .env.example for everything else."
    echo "# Read by the server and by every tool in tools/, so a command typed into a"
    echo "# shell works on the same database the service does."
    echo "OFF_GUARD_DB=${DB_DIR}/off-guard.sqlite"
  } > "$ENV_FILE"
  echo "Wrote $ENV_FILE"
elif ! grep -q '^OFF_GUARD_DB=' "$ENV_FILE"; then
  echo "OFF_GUARD_DB=${DB_DIR}/off-guard.sqlite" >> "$ENV_FILE"
  echo "Added OFF_GUARD_DB to $ENV_FILE"
else
  echo "Leaving the OFF_GUARD_DB already in $ENV_FILE alone."
fi

# --- write the plists ---------------------------------------------------------

render "$TEMPLATE" "$TARGET"
render "$BACKUP_TEMPLATE" "$BACKUP_TARGET"

# --- load them ----------------------------------------------------------------

unload "$LABEL"
bootstrap "$TARGET"
launchctl kickstart -k "$DOMAIN/$LABEL"

# The backup agent is StartCalendarInterval only, so loading it schedules it and
# runs nothing. It is kicked once below, after the server is confirmed up.
unload "$BACKUP_LABEL"
bootstrap "$BACKUP_TARGET"

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

    # Run the backup once now rather than finding out in a week that it was
    # never going to work. A scheduled job that has never run is a plan.
    echo "Taking one backup now, to prove the weekly agent will work:"
    if launchctl kickstart -w "$DOMAIN/$BACKUP_LABEL" > /dev/null 2>&1; then
      for _ in $(seq 1 20); do
        [[ -s "$LOG_DIR/off-guard-backup.log" ]] && break
        sleep 0.5
      done
      sed 's/^/  /' "$LOG_DIR/off-guard-backup.log" 2>/dev/null | tail -8
    else
      echo "  The backup agent did not start. Check:" >&2
      echo "    launchctl print $DOMAIN/$BACKUP_LABEL" >&2
    fi
    echo "  Weekly from now on. Change the day in $(basename "$BACKUP_TEMPLATE")"
    echo "  and run this again."
    echo
    echo "Your GM link, printed once and never again:"
    echo "  cd $ROOT && node tools/mint-gm-token.js"
    echo
    echo "It prints which database it opened. Check that it is the one above."
    exit 0
  fi
  sleep 0.5
done

echo "It loaded but is not answering on ${PORT}. What the agent says:" >&2
launchctl print "$DOMAIN/$LABEL" 2>&1 | grep -E 'state =|last exit' >&2 || true
echo "--- log:" >&2
tail -20 "$LOG_DIR/off-guard.log" >&2 2>/dev/null || echo "  (empty)" >&2
exit 1
