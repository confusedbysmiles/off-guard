#!/usr/bin/env bash
#
# Put Off-Guard on the internet from a systemd machine.
#
#     sudo ./deploy/cloudflared/linux.sh <hostname> <tunnel-name>
#     sudo ./deploy/cloudflared/linux.sh --uninstall
#
# The Linux counterpart to setup.sh, which is macOS and launchd. Same two
# lessons behind both:
#
#   1. Every argument the connector needs is written into the unit, not left to
#      `cloudflared service install` and a config file it finds by convention.
#      That command, on macOS, produced a daemon that ran as root, read a
#      directory that did not exist, and was reported healthy by the service
#      manager for days while the site served error 1033.
#
#   2. Success is checked against the public hostname, not localhost. The
#      application answering on 127.0.0.1 proves nothing about the tunnel.
#
# This does not create the tunnel or the DNS record -- `cloudflared tunnel
# create` and `cloudflared tunnel route dns` do, once, from wherever you are
# logged in. This installs a connector for a tunnel that already exists.
set -euo pipefail

NAME="off-guard-tunnel"
USER_NAME="cloudflared"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$HERE/${NAME}.service"
TARGET="/etc/systemd/system/${NAME}.service"
CONF_DIR="/etc/cloudflared"

if [[ "${EUID}" -ne 0 ]]; then
  echo "This needs root: it creates a system user and writes to /etc/systemd/system." >&2
  echo "  sudo $0${*:+ $*}" >&2
  exit 1
fi

if [[ "${1:-}" == "--uninstall" ]]; then
  systemctl disable --now "$NAME" 2>/dev/null || true
  rm -f "$TARGET"
  systemctl daemon-reload
  echo "Removed. ${CONF_DIR} is untouched: it holds the tunnel's credentials."
  exit 0
fi

HOSTNAME_ARG="${1:-}"
TUNNEL="${2:-off-guard}"
if [[ -z "$HOSTNAME_ARG" ]]; then
  echo "Which hostname? e.g. sudo $0 offguard.example.com off-guard" >&2
  exit 1
fi

command -v cloudflared > /dev/null || {
  echo "cloudflared is not installed. It is not in Debian; add Cloudflare's repo:" >&2
  echo "  https://pkg.cloudflare.com" >&2
  exit 1
}

# --- the credentials ----------------------------------------------------------
#
# The connector needs one file: the tunnel's own <UUID>.json. It does not need
# cert.pem, which is the account credential used to create tunnels and route
# DNS -- so that one stays on whichever machine you log in from.

shopt -s nullglob
CREDS=("$CONF_DIR"/*.json)
shopt -u nullglob
if (( ${#CREDS[@]} == 0 )); then
  echo "No tunnel credentials in ${CONF_DIR}." >&2
  echo "Copy the tunnel's <UUID>.json there from the machine that created it:" >&2
  echo "  scp ~/.cloudflared/<UUID>.json this-machine:/tmp/ && sudo install -o ${USER_NAME} \\" >&2
  echo "      -g ${USER_NAME} -m 0400 /tmp/<UUID>.json ${CONF_DIR}/" >&2
  exit 1
fi
if (( ${#CREDS[@]} > 1 )); then
  echo "More than one credentials file in ${CONF_DIR}; leave only the tunnel's own:" >&2
  printf '  %s\n' "${CREDS[@]}" >&2
  exit 1
fi
CREDENTIALS="${CREDS[0]}"

# --- the user -----------------------------------------------------------------

if ! id -u "$USER_NAME" > /dev/null 2>&1; then
  useradd --system --home-dir "$CONF_DIR" --shell /usr/sbin/nologin "$USER_NAME"
  echo "Created the ${USER_NAME} system user."
fi
chown -R "$USER_NAME":"$USER_NAME" "$CONF_DIR"
chmod 0750 "$CONF_DIR"
chmod 0400 "$CREDENTIALS"

# --- the config ---------------------------------------------------------------

cat > "$CONF_DIR/config.yml" <<YAML
# Written by off-guard/deploy/cloudflared/linux.sh.
#
# Off-Guard's SSE heartbeat is every 25 seconds, comfortably inside
# Cloudflare's idle timeout, so the shared screen's stream stays open between
# turns without any tuning here.

tunnel: ${TUNNEL}
credentials-file: ${CREDENTIALS}

ingress:
  - hostname: ${HOSTNAME_ARG}
    service: http://127.0.0.1:8787

  # Anything else that reaches this tunnel is not Off-Guard.
  - service: http_status:404
YAML
chown "$USER_NAME":"$USER_NAME" "$CONF_DIR/config.yml"
chmod 0440 "$CONF_DIR/config.yml"

# --- the unit -----------------------------------------------------------------

CLOUDFLARED="$(command -v cloudflared)"
sed -e "s|^ExecStart=.*|ExecStart=${CLOUDFLARED} --config ${CONF_DIR}/config.yml --no-autoupdate tunnel run ${TUNNEL}|" \
  "$TEMPLATE" > "$TARGET"

UNIT_BIN="$(awk -F'=' '/^ExecStart=/ { print $2 }' "$TARGET" | awk '{ print $1 }')"
if [[ ! -x "$UNIT_BIN" ]]; then
  echo "The unit would run something that is not there: $UNIT_BIN" >&2
  rm -f "$TARGET"
  exit 1
fi
command -v systemd-analyze > /dev/null && systemd-analyze verify "$TARGET"

# --- start it, and check the internet rather than this machine ----------------

systemctl daemon-reload
systemctl enable --now "$NAME"
systemctl restart "$NAME"

echo "Waiting for https://${HOSTNAME_ARG}/healthz ..."
for _ in $(seq 1 40); do
  if curl -fsS --max-time 5 "https://${HOSTNAME_ARG}/healthz" > /dev/null 2>&1; then
    echo
    echo "Off-Guard is reachable at https://${HOSTNAME_ARG}"
    echo
    echo "  tunnel:       ${TUNNEL}"
    echo "  credentials:  ${CREDENTIALS}"
    echo "  logs:         journalctl -u ${NAME} -f"
    echo
    exit 0
  fi
  sleep 3
done

echo "The connector started but ${HOSTNAME_ARG} is not answering." >&2
echo "Error 1033 there means no connector is registered; what the journal says:" >&2
journalctl -u "$NAME" -n 20 --no-pager >&2 || true
exit 1
