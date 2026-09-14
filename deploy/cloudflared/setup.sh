#!/usr/bin/env bash
#
# Point a Cloudflare Tunnel at Off-Guard.
#
#     ./deploy/cloudflared/setup.sh offguard.drseim.com
#
# Safe to run more than once: it creates the tunnel only if it is missing,
# adds the DNS record only if it is absent, and backs up any config.yml it
# replaces.
#
# What it removes is the step that asked you to copy a UUID out of terminal
# scrollback and hand-edit YAML around it. The UUID is already on disk; this
# reads it from there.
#
# Run `cloudflared tunnel login` first. It is interactive -- a browser, a
# Cloudflare login, and picking the zone -- and it is the one step nothing can
# do on your behalf.
set -euo pipefail

TUNNEL="${TUNNEL_NAME:-off-guard}"
HOSTNAME_ARG="${1:-}"
PORT="${OFF_GUARD_PORT:-8787}"
CF_DIR="$HOME/.cloudflared"
CONFIG="$CF_DIR/config.yml"

if [[ -z "$HOSTNAME_ARG" ]]; then
  echo "Usage: $0 <hostname>      e.g. $0 offguard.drseim.com" >&2
  exit 1
fi

# --- 1. logged in? ------------------------------------------------------------

if [[ ! -f "$CF_DIR/cert.pem" ]]; then
  cat >&2 <<'EOF'
No ~/.cloudflared/cert.pem, so cloudflared is not logged in yet.

  cloudflared tunnel login

That opens a browser; log in and pick the zone this hostname belongs to.
It is interactive, and it is the only step here that cannot be scripted.
EOF
  exit 1
fi

# --- 2. the tunnel ------------------------------------------------------------

# `tunnel list` prints a header and then "<uuid> <name> <created> <connections>".
uuid_of() {
  cloudflared tunnel list 2>/dev/null \
    | awk -v want="$TUNNEL" '$2 == want { print $1; exit }'
}

UUID="$(uuid_of)"
if [[ -z "$UUID" ]]; then
  echo "Creating the tunnel '$TUNNEL'..."
  cloudflared tunnel create "$TUNNEL" > /dev/null
  UUID="$(uuid_of)"
fi
if [[ -z "$UUID" ]]; then
  echo "The tunnel '$TUNNEL' still does not exist after creating it." >&2
  exit 1
fi
echo "Tunnel:      $TUNNEL ($UUID)"

CREDENTIALS="$CF_DIR/$UUID.json"
if [[ ! -f "$CREDENTIALS" ]]; then
  echo "The tunnel exists but $CREDENTIALS does not." >&2
  echo "It is written by \`cloudflared tunnel create\` on the machine that ran it." >&2
  exit 1
fi
echo "Credentials: $CREDENTIALS"

# --- 3. the DNS record --------------------------------------------------------
#
# `route dns` refuses when a record already points somewhere else, which is the
# right behaviour and worth passing through rather than forcing.

if cloudflared tunnel route dns "$TUNNEL" "$HOSTNAME_ARG" 2>/dev/null; then
  echo "DNS:         $HOSTNAME_ARG -> this tunnel (created)"
else
  echo "DNS:         $HOSTNAME_ARG already has a record; leaving it alone."
  echo "             If it points somewhere else, fix it in the Cloudflare dashboard."
fi

# --- 4. the config ------------------------------------------------------------

if [[ -f "$CONFIG" ]]; then
  cp "$CONFIG" "$CONFIG.backup-$(date +%Y%m%d%H%M%S)"
  echo "Backed up the existing $CONFIG"
fi

cat > "$CONFIG" <<EOF
# Written by off-guard/deploy/cloudflared/setup.sh.
#
# Off-Guard's SSE heartbeat is every 25 seconds, comfortably inside
# Cloudflare's idle timeout, so the shared screen's stream stays open between
# turns without any tuning here.

tunnel: $TUNNEL
credentials-file: $CREDENTIALS

ingress:
  - hostname: $HOSTNAME_ARG
    service: http://127.0.0.1:$PORT

  # Anything else that reaches this tunnel is not Off-Guard.
  - service: http_status:404
EOF

echo "Config:      $CONFIG"

# `ingress validate` reads the config the same way the tunnel will.
cloudflared tunnel ingress validate

# --- 5. is there anything to point at? ----------------------------------------

if curl -fsS "http://127.0.0.1:$PORT/healthz" > /dev/null 2>&1; then
  echo "Off-Guard:   answering on 127.0.0.1:$PORT"
else
  echo "Off-Guard:   NOT answering on 127.0.0.1:$PORT -- start it first," >&2
  echo "             ./deploy/macos/install.sh" >&2
fi

# --- 6. run it, and keep running it -------------------------------------------
#
# As a launchd *agent*, not `sudo cloudflared service install`.
#
# That command -- which this script used to end by recommending -- installs a
# system daemon running as root. Root reads /etc/cloudflared; the certificate
# and credentials `cloudflared tunnel login` issues live in ~/.cloudflared. The
# daemon therefore has no tunnel to run, and says nothing about it: launchctl
# reports it healthy and running forever while the hostname serves 1033 to
# everyone holding a link.
#
# This deployment lost two weeks to exactly that. The tunnel was alive only
# because a `cloudflared tunnel run` was sitting in a terminal window, and a
# reboot ended it with no sign anywhere that anything had stopped.

AGENT_LABEL="com.drseim.off-guard-tunnel"
AGENT_TEMPLATE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/${AGENT_LABEL}.plist"
AGENT_TARGET="$HOME/Library/LaunchAgents/${AGENT_LABEL}.plist"
DOMAIN="gui/$(id -u)"

CLOUDFLARED_BIN="$(command -v cloudflared)"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

sed \
  -e "s|<string>/opt/homebrew/bin/cloudflared</string>|<string>${CLOUDFLARED_BIN}</string>|" \
  -e "s|/Users/YOU/.cloudflared/config.yml|${CONFIG}|" \
  -e "s|/Users/YOU/Library/Logs|${HOME}/Library/Logs|" \
  -e "s|<string>off-guard</string>|<string>${TUNNEL}</string>|" \
  "$AGENT_TEMPLATE" > "$AGENT_TARGET"

if grep -q "/Users/YOU" "$AGENT_TARGET"; then
  echo "A placeholder survived substitution; refusing to install a broken agent." >&2
  grep -n "/Users/YOU" "$AGENT_TARGET" >&2
  rm -f "$AGENT_TARGET"
  exit 1
fi
plutil -lint "$AGENT_TARGET" > /dev/null

# Anything already running this tunnel has to stop first: a second connector
# does not fail over, it load-balances, and half the requests would reach a
# process nobody is managing.
launchctl bootout "$DOMAIN/$AGENT_LABEL" 2>/dev/null || true
pkill -f "cloudflared.*tunnel run ${TUNNEL}" 2>/dev/null || true
sleep 2

launchctl bootstrap "$DOMAIN" "$AGENT_TARGET"
launchctl kickstart -k "$DOMAIN/$AGENT_LABEL"

echo "Agent:       $AGENT_LABEL"

# --- 7. prove the hostname actually answers -----------------------------------
#
# Through Cloudflare, not against localhost. The whole failure this script now
# guards against looked perfect from the inside.

for _ in $(seq 1 30); do
  if curl -fsS "https://${HOSTNAME_ARG}/healthz" > /dev/null 2>&1; then
    cat <<EOF

https://${HOSTNAME_ARG} is answering.

  tunnel:  $TUNNEL ($UUID)
  config:  $CONFIG
  log:     $HOME/Library/Logs/off-guard-tunnel.log

It comes back by itself on reboot, as long as you are logged in -- the same
condition Off-Guard itself runs under.

If you previously ran \`sudo cloudflared service install\`, remove that daemon:
it does nothing, and a second connector for this tunnel would split traffic.

  sudo launchctl bootout system/com.cloudflare.cloudflared
  sudo rm /Library/LaunchDaemons/com.cloudflare.cloudflared.plist

EOF
    exit 0
  fi
  sleep 2
done

echo "The agent loaded but https://${HOSTNAME_ARG} is not answering." >&2
echo "What the tunnel says:" >&2
tail -20 "$HOME/Library/Logs/off-guard-tunnel.log" >&2 2>/dev/null || true
exit 1
