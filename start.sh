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
mkdir -p /alfred/.tailscale
tailscaled --state=/alfred/.tailscale/tailscaled.state --tun=userspace-networking &

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
# Pass through everything except infra secrets and common noise.
{
  env | grep -vE '^(TS_AUTHKEY|SSH_PASSWORD|HOSTNAME|HOME|PATH|PWD|SHLVL|_)=' | sed 's/^/export /'
  echo 'cd /alfred 2>/dev/null'
} > /etc/profile.d/railway-env.sh 2>/dev/null || true
chmod 644 /etc/profile.d/railway-env.sh

# --- SSH ---
echo "root:${SSH_PASSWORD:-changeme}" | chpasswd
/usr/sbin/sshd

echo "==============================="
echo " Alfred is online."
echo " Connect via: ssh alfred"
echo "==============================="

# Keep container alive
tail -f /dev/null
