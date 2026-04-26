#!/bin/bash
set -e

# --- Validate required env ---
if [ -z "$TS_AUTHKEY" ]; then
  echo "ERROR: TS_AUTHKEY is not set. Cannot join Tailscale network."
  exit 1
fi

# --- Clean macOS resource fork files (accumulate from SSHFS/Finder) ---
find /alfred -maxdepth 2 -name '._*' -delete 2>/dev/null || true

# --- Remove stale AGENTS.md from volume (agent behavior now lives in .pi/SYSTEM.md) ---
rm -f /alfred/AGENTS.md 2>/dev/null || true

# --- Sync Pi agent config (SYSTEM, extensions) to global agentDir (not the memory volume) ---
if [ -d /opt/alfred-pi-config ]; then
  mkdir -p /root/.pi/agent
  cp -a /opt/alfred-pi-config/. /root/.pi/agent/
  echo "Synced Pi config to /root/.pi/agent"
fi

# --- Remove legacy project-local .pi on the memory volume (harness lives in agentDir now) ---
rm -rf /alfred/.pi 2>/dev/null || true

# --- Load /alfred/config.env (user preferences on the volume) ---
# Simple KEY=VALUE parser — Railway env vars always override for secrets.
# Preference vars (TIMEZONE, ALFRED_MODEL, etc.) allow config.env to override empty values.
apply_config() {
  local file="$1"
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    # Skip blank lines and comments
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    # Strip inline comments, trim whitespace
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -z "$line" ] && continue
    local key="${line%%=*}"
    local val="${line#*=}"
    # For preference vars, allow config.env to override empty values
    # For secrets/keys, Railway env always wins
    local is_pref=0
    case "$key" in
      TIMEZONE|CALDAV_TIMEZONE|ALFRED_MODEL)
        is_pref=1 ;;
    esac
    if [ "$is_pref" = "1" ] && [ -z "${!key:-}" ]; then
      # Preference var is empty or unset → apply from config.env
      declare -gx "$key=$val"
    elif [ -z "${!key+x}" ]; then
      # Secret var is completely unset → apply from config.env
      declare -gx "$key=$val"
    fi
  done < "$file"
}
apply_config /alfred/config.env

# --- Generate default config.env on first boot ---
if [ ! -f /alfred/config.env ]; then
  cp /opt/config.env.template /alfred/config.env
  echo "Generated default /alfred/config.env (all commented out)"
fi

# --- Pi APPEND_SYSTEM from blocks/ (global agentDir; cwd stays /alfred for memory only) ---
mkdir -p /root/.pi/agent
if [ -x /opt/memory-loader.sh ]; then
  if ALFRED_MEMORY_ROOT=/alfred /opt/memory-loader.sh > /root/.pi/agent/APPEND_SYSTEM.md 2>/dev/null; then
    echo "Refreshed /root/.pi/agent/APPEND_SYSTEM.md from blocks/ (memory-loader)"
  else
    rm -f /root/.pi/agent/APPEND_SYSTEM.md 2>/dev/null || true
    echo "WARNING: memory-loader failed; omitted APPEND_SYSTEM.md"
  fi
fi

# --- Git-based memory versioning ---
cd /alfred
git config user.name "Alfred" 2>/dev/null || true
git config user.email "alfred@automated" 2>/dev/null || true

# Ensure .gitignore exists — only personal data should be tracked.
# Agent infrastructure is synced from the Docker image on every boot.
cat > /alfred/.gitignore << 'GITIGNORE_EOF'
# Legacy operational paths (harness under /root/.pi/agent — not on volume)
state/proactive-slots.state
state/proactive-*.log
state/proactive.log
state/proactive.lock
state/task-sessions/
state/pi-session/
state/discord-tasks.json

# Tailscale networking state
.tailscale/

# OS artifacts
.DS_Store
._*
GITIGNORE_EOF

# If GITHUB_TOKEN is set and a remote exists, ensure the URL includes auth
if [ -n "${GITHUB_TOKEN:-}" ] && [ -d /alfred/.git ]; then
  current_url="$(cd /alfred && git remote get-url origin 2>/dev/null || true)"
  if [ -n "$current_url" ] && echo "$current_url" | grep -q 'github.com'; then
    # Rewrite https://github.com/... → https://x-access-token:TOKEN@github.com/...
    authed_url="$(echo "$current_url" | sed -E 's|https://(x-access-token:[^@]+@)?github\.com|https://x-access-token:'"$GITHUB_TOKEN"'@github.com|')"
    (cd /alfred && git remote set-url origin "$authed_url") 2>/dev/null || true
  fi
fi

if [ ! -d /alfred/.git ]; then
  cd /alfred && git init && git add -A && git commit -m "init: first boot snapshot" 2>/dev/null || true
  echo "Initialized git repo in /alfred for memory versioning"
else
  # Existing deployment: untrack paths now covered by .gitignore
  (cd /alfred && git rm -r --cached .tailscale/ state/proactive-slots.state state/task-sessions/ state/pi-session/ state/discord-tasks.json .pi/ proactive/ 2>/dev/null || true)
  (cd /alfred && git rm --cached state/proactive-*.log 2>/dev/null || true)
fi

# --- Unify timezone ---
EFFECTIVE_TZ="${TIMEZONE:-${TZ:-America/Los_Angeles}}"
: "${CALDAV_TIMEZONE:=$EFFECTIVE_TZ}"
TZ="$EFFECTIVE_TZ"
export CALDAV_TIMEZONE TZ
# Operational files off the memory volume (Pi agentDir); override in Railway if needed
export ALFRED_EVENT_FILE="${ALFRED_EVENT_FILE:-/root/.pi/agent/events.jsonl}"
export ALFRED_MEMORY_ROOT="${ALFRED_MEMORY_ROOT:-/alfred}"

# --- Default model ---
# ALFRED_MODEL is the single knob for model selection across all channels.
# Discord bridge and subagent sessions use Pi's built-in resolution (auth.json / env / models.json).
# Export it so it's available to all child processes.
if [ -n "${ALFRED_MODEL:-}" ]; then
  export ALFRED_MODEL
  echo "Default model: $ALFRED_MODEL"
else
  echo "Default model: (not set, will use provider default)"
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

if node -e '
  const providers = {
    groq: process.env.GROQ_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GEMINI_API_KEY,
  };
  const auth = {};
  for (const [name, key] of Object.entries(providers)) {
    if (key) auth[name] = { type: "api_key", key };
  }
  if (Object.keys(auth).length > 0) {
    process.stdout.write(JSON.stringify(auth));
  } else {
    process.exit(1);
  }
' > /root/.pi/agent/auth.json 2>/dev/null; then
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

# Ensure interactive SSH shells load Railway env (Discord token, recipient IDs, etc.) for manual `pi` runs.
ALFRED_ENV_MARKER="# alfred: source railway-env"
for f in /root/.bashrc /root/.profile; do
  touch "$f"
  if ! grep -qF "$ALFRED_ENV_MARKER" "$f" 2>/dev/null; then
    printf '\n%s\n[ -f /etc/profile.d/railway-env.sh ] && . /etc/profile.d/railway-env.sh\n' "$ALFRED_ENV_MARKER" >>"$f"
  fi
done

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
