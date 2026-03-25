#!/bin/bash
set -e

# --- Validate required env ---
if [ -z "$TS_AUTHKEY" ]; then
  echo "ERROR: TS_AUTHKEY is not set. Cannot join Tailscale network."
  exit 1
fi

# --- Sync .pi/ config from Docker image into the volume ---
if [ -d /opt/alfred-pi-config ]; then
  mkdir -p /alfred/.pi
  cp -a /opt/alfred-pi-config/. /alfred/.pi/
  echo "Synced .pi/ config into workspace"
fi

# --- Tailscale ---
# Kernel TUN when /dev/net/tun exists (self-hosted Docker with --device /dev/net/tun + NET_ADMIN,
# many VPS). Otherwise userspace — typical for Railway (no TUN device in the container).
mkdir -p /alfred/.tailscale
TAILSCALE_ARGS=(--state=/alfred/.tailscale/tailscaled.state)
if [ -e /dev/net/tun ]; then
  echo "Tailscale: kernel TUN (/dev/net/tun present)"
else
  TAILSCALE_ARGS+=(--tun=userspace-networking)
  echo "Tailscale: userspace (no /dev/net/tun — use: tailscale ssh root@alfred)"
fi
tailscaled "${TAILSCALE_ARGS[@]}" &

# Wait for tailscaled to be ready (up to 10s)
for i in $(seq 1 20); do
  tailscale status >/dev/null 2>&1 && break
  sleep 0.5
done

tailscale up --authkey="${TS_AUTHKEY}" --hostname=alfred --ssh

# --- Configure Pi agent auth.json ---
# Pi resolution order: CLI flag → auth.json → env var → models.json
# Dynamically builds auth.json from whichever LLM API keys are present.
mkdir -p /root/.pi/agent

AUTH_JSON="{"
FIRST=true

add_provider() {
  local name="$1" key="$2"
  if [ -n "$key" ]; then
    $FIRST || AUTH_JSON="${AUTH_JSON},"
    AUTH_JSON="${AUTH_JSON}\"${name}\":{\"type\":\"api_key\",\"key\":\"${key}\"}"
    FIRST=false
  fi
}

add_provider "groq"      "$GROQ_API_KEY"
add_provider "anthropic"  "$ANTHROPIC_API_KEY"
add_provider "openai"     "$OPENAI_API_KEY"
add_provider "google"     "$GEMINI_API_KEY"

AUTH_JSON="${AUTH_JSON}}"

if [ "$FIRST" = false ]; then
  echo "$AUTH_JSON" > /root/.pi/agent/auth.json
  chmod 600 /root/.pi/agent/auth.json
  echo "Configured LLM providers in auth.json"
else
  echo "WARNING: No LLM API keys found. Set at least one of: GROQ_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY"
fi

# --- Expose env vars to SSH sessions ---
# Railway injects env vars into PID 1 only — SSH sessions don't inherit them.
# Use null-delimited env and %q so values with commas/spaces/special chars do not break export.
{
  while IFS= read -r -d '' line; do
    [ -z "$line" ] && continue
    name="${line%%=*}"
    value="${line#*=}"
    case "$name" in
      TS_AUTHKEY|SSH_PASSWORD|HOSTNAME|HOME|PATH|PWD|SHLVL|_|'') continue ;;
    esac
    [[ "$name" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || continue
    printf 'export %s=%q\n' "$name" "$value"
  done < <(env -0)
  echo 'cd /alfred 2>/dev/null'
} > /etc/profile.d/railway-env.sh 2>/dev/null || true
chmod 644 /etc/profile.d/railway-env.sh

# --- SSH ---
echo "root:${SSH_PASSWORD:-changeme}" | chpasswd
/usr/sbin/sshd

# --- Discord bridge (optional) ---
if [ -n "$DISCORD_BOT_TOKEN" ] && [ -d /opt/discord-bridge ]; then
  node /opt/discord-bridge/dist/index.js &
  echo "Discord bridge started"
fi

if [ -n "$TAVILY_API_KEY" ]; then
  echo "Tavily web search enabled"
fi

echo "==============================="
echo " Alfred is online."
echo " Connect via: ssh alfred"
if [ -n "$DISCORD_BOT_TOKEN" ]; then
  echo " Discord: DM the bot to talk to Alfred"
fi
echo "==============================="

# Keep container alive
tail -f /dev/null