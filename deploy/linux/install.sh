#!/usr/bin/env bash
#
# Install Off-Guard as a systemd service.
#
#     sudo ./deploy/linux/install.sh
#
# The counterpart to deploy/macos/install.sh, and the same idea: the unit file
# beside it names paths that are right on some machines and wrong on others,
# and hand-editing them is a step that gets skipped. This fills in what this
# machine actually has, checks the result points at things that exist, and
# waits for /healthz before claiming anything.
#
# Reversible:
#
#     sudo ./deploy/linux/install.sh --uninstall
#
# which stops and disables the service and removes the unit. It does not touch
# /var/lib/off-guard: that is the database, and an uninstall script is not the
# right place to delete somebody's campaign.
set -euo pipefail

NAME="off-guard"
USER_NAME="off-guard"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TEMPLATE="$ROOT/deploy/${NAME}.service"
TARGET="/etc/systemd/system/${NAME}.service"
DB_DIR="/var/lib/${NAME}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "This needs root: it creates a system user and writes to /etc/systemd/system." >&2
  echo "  sudo $0${*:+ $*}" >&2
  exit 1
fi

if ! command -v systemctl > /dev/null; then
  echo "There is no systemctl here, so this is not a systemd machine." >&2
  echo "deploy/macos/install.sh is the launchd equivalent." >&2
  exit 1
fi

if [[ "${1:-}" == "--uninstall" ]]; then
  systemctl disable --now "${NAME}" 2>/dev/null || true
  rm -f "$TARGET"
  systemctl daemon-reload
  echo "Removed. The database at ${DB_DIR} and the ${USER_NAME} user are untouched."
  exit 0
fi

# --- what this machine actually has -------------------------------------------

# `sudo` usually resets PATH, and the invoking user's node may not be on it.
NODE="$(command -v node || true)"
if [[ -z "$NODE" && -n "${SUDO_USER:-}" ]]; then
  NODE="$(sudo -u "$SUDO_USER" -i command -v node 2>/dev/null || true)"
fi
if [[ -z "$NODE" ]]; then
  echo "node is not on the PATH, including root's. Install Node 20 or newer." >&2
  exit 1
fi

NODE_MAJOR="$("$NODE" -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')"
if (( NODE_MAJOR < 20 )); then
  echo "node $NODE_MAJOR is too old; Off-Guard needs 20 or newer." >&2
  exit 1
fi

if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "Dependencies are not installed. Run: npm ci" >&2
  exit 1
fi

# better-sqlite3 is a native module: a node_modules copied from another machine,
# or built against a different Node, fails at require time and the service dies
# in a loop with the reason in the journal and nowhere else.
if ! "$NODE" -e 'require("better-sqlite3")' 2>/dev/null; then
  echo "better-sqlite3 will not load under ${NODE}." >&2
  echo "It is a native module: run \`npm rebuild better-sqlite3\` in ${ROOT}." >&2
  exit 1
fi

# --- the user and its one writable directory ----------------------------------

if ! id -u "$USER_NAME" > /dev/null 2>&1; then
  useradd --system --home-dir "$DB_DIR" --shell /usr/sbin/nologin "$USER_NAME"
  echo "Created the ${USER_NAME} system user."
fi

install -d -o "$USER_NAME" -g "$USER_NAME" -m 0750 "$DB_DIR"

# The unit is ProtectSystem=strict with ReadWritePaths=/var/lib/off-guard, so
# the checkout is read-only to the service. It still has to be readable by it.
if ! sudo -u "$USER_NAME" test -r "$ROOT/src/server/index.js"; then
  echo "${USER_NAME} cannot read ${ROOT}." >&2
  echo "Either move the checkout somewhere world-readable, or:" >&2
  echo "  chmod o+rx $(dirname "$ROOT") $ROOT" >&2
  exit 1
fi

# --- write the unit -----------------------------------------------------------

# `|` as the delimiter, because every value here is a path.
sed \
  -e "s|^WorkingDirectory=.*|WorkingDirectory=${ROOT}|" \
  -e "s|^ExecStart=.*|ExecStart=${NODE} src/server/index.js|" \
  -e "s|^Environment=OFF_GUARD_DB=.*|Environment=OFF_GUARD_DB=${DB_DIR}/off-guard.sqlite|" \
  "$TEMPLATE" > "$TARGET"

# Check the result rather than trusting the substitution: a unit whose
# ExecStart does not exist starts, fails, and says so only in the journal.
UNIT_NODE="$(awk -F'=' '/^ExecStart=/ { print $2 }' "$TARGET" | awk '{ print $1 }')"
UNIT_DIR="$(awk -F'=' '/^WorkingDirectory=/ { print $2 }' "$TARGET")"
if [[ ! -x "$UNIT_NODE" || ! -f "$UNIT_DIR/src/server/index.js" ]]; then
  echo "The unit would point at something that is not there:" >&2
  echo "  ExecStart node:      $UNIT_NODE" >&2
  echo "  WorkingDirectory:    $UNIT_DIR" >&2
  rm -f "$TARGET"
  exit 1
fi

if command -v systemd-analyze > /dev/null; then
  systemd-analyze verify "$TARGET"
fi

# --- make the shell agree with the service ------------------------------------
#
# Same reason as the macOS installer: a `node tools/...` typed into a terminal
# would otherwise take the default database path and quietly work on a
# different file from the one the service has open.

ENV_FILE="$ROOT/.env"
if ! grep -q '^OFF_GUARD_DB=' "$ENV_FILE" 2>/dev/null; then
  {
    echo "# Written by deploy/linux/install.sh. See .env.example for everything else."
    echo "# Read by the server and by every tool in tools/, so a command typed into a"
    echo "# shell works on the same database the service does."
    echo "OFF_GUARD_DB=${DB_DIR}/off-guard.sqlite"
  } >> "$ENV_FILE"
  echo "Wrote OFF_GUARD_DB to $ENV_FILE"
fi

# --- start it -----------------------------------------------------------------

systemctl daemon-reload
systemctl enable --now "$NAME"
systemctl restart "$NAME"

PORT="$(awk -F'=' '/^Environment=OFF_GUARD_PORT=/ { print $3 }' "$TARGET")"
PORT="${PORT:-8787}"

for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT}/healthz" > /dev/null 2>&1; then
    echo
    echo "Off-Guard is running on http://127.0.0.1:${PORT}"
    echo
    echo "  node:      $NODE"
    echo "  from:      $ROOT"
    echo "  database:  ${DB_DIR}/off-guard.sqlite"
    echo "  logs:      journalctl -u ${NAME} -f"
    echo
    echo "It binds loopback. Put TLS in front of it -- deploy/nginx.conf, or a"
    echo "Cloudflare Tunnel: deploy/cloudflared/setup.sh."
    echo
    echo "Your GM link, printed once and never again:"
    echo "  cd $ROOT && node tools/mint-gm-token.js"
    echo
    echo "Moving an existing table here instead? Do not mint one: restore the"
    echo "backup first and every link that already works keeps working."
    echo "  deploy/MIGRATING.md"
    echo
    exit 0
  fi
  sleep 0.5
done

echo "It started but is not answering on ${PORT}. What the journal says:" >&2
journalctl -u "$NAME" -n 20 --no-pager >&2 || true
exit 1
