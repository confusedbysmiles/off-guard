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

cat <<EOF

Now run it in the foreground and watch:

  cloudflared tunnel run $TUNNEL

Then open https://$HOSTNAME_ARG/healthz in a browser. When that returns
{"ok":true}, stop it with Ctrl-C and make it permanent:

  sudo cloudflared service install

EOF
