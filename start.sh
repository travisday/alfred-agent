#!/bin/bash
set -e

# --- Validate required env ---
if [ -z "$TS_AUTHKEY" ]; then
  echo "ERROR: TS_AUTHKEY is not set. Cannot join Tailscale network."
  exit 1
fi

# --- Clean macOS resource fork files (accumulate from SSHFS/Finder) ---
find /alfred -maxdepth 2 -name '._*' -delete 2>/dev/null || true

# --- Sync .pi/ config from Docker image into the volume ---
if [ -d /opt/alfred-pi-config ]; then
  mkdir -p /alfred/.pi
  cp -a /opt/alfred-pi-config/. /alfred/.pi/
  echo "Synced .pi/ config into workspace"
fi

# --- Sync proactive scripts from image, seed prompts on first boot ---
if [ -d /opt/proactive ]; then
  mkdir -p /alfred/proactive
  # Scripts are repo-owned code — overwrite on every boot
  for f in /opt/proactive/*.sh /opt/proactive/*.md; do
    [ -f "$f" ] && cp -a "$f" /alfred/proactive/
  done
  # Prompts are user content — seed once, never overwrite
  if [ ! -d /alfred/proactive/prompts ]; then
    mkdir -p /alfred/proactive/prompts
    cat > /alfred/proactive/prompts/morning.md << 'PROMPT_EOF'
# Morning check-in

You are running as a scheduled proactive check-in (not a user-initiated conversation). Your job is to help the user start their day with clarity on what matters.

**Steps:**

1. **Read memory** (`/alfred/memory/`) — load active goals, commitments, habits, deadlines, and any carry-forward items from yesterday. This is your source of truth for what matters.
1.5. **Enforce freshness** — Check `Last updated` dates on state files. If `active-context.md` is >3 days old, treat session notes as stale and say so. If any task in `tasks.md` is >7 days past its due date, include a direct "reschedule or drop?" nudge for each one. Don't silently carry stale items forward.
2. **Pull today's calendar** — use `get_today_events`. Also use `get_upcoming` to see what's ahead this week.
3. **Analyze the day's shape** — How much open time exists vs meetings? Does today's schedule support their stated goals, or is it all reactive? Flag conflicts, back-to-backs, or impossible stacks.
4. **Cross-reference goals vs reality** — Which goals have open time allocated today? Which are at risk of slipping? Has anything from memory been dormant for days?
5. **Send via Discord** — use `send_discord_message` with a scannable message:
   - **Today's shape** (2-3 lines: meeting load, open blocks, key deadlines)
   - **Goal alignment** (which goals get attention today, which don't)
   - **Risks** (what could derail the day)
   - **One question** — specific and decision-forcing. Not "how are you?" but something like: "You have 2 hours open this afternoon — should that go to [Goal A] or [Goal B]?" or "You committed to [X] on Monday but it hasn't moved — still a priority?"

**Before you stop:** You **must** call the **`send_discord_message`** tool once with the full message you drafted (not just text in your reply). Check-ins are delivered **only** through that tool. If the tool returns an error, paste the same message in your final reply so the user still sees it.

**Rules:**
- Keep the Discord message short. Max ~15 lines. Bullets and bold for scannability.
- Don't lecture or motivate. Be direct and useful.
- Only update memory files if something clearly needs correcting (e.g., a deadline passed).
- If memory is empty/thin, note it once and work with what the calendar gives you.
- If Discord isn't configured, output the message as plain text.
PROMPT_EOF
    cat > /alfred/proactive/prompts/midday.md << 'PROMPT_EOF'
# Midday check-in

You are running as a scheduled proactive check-in (not a user-initiated conversation). Your job is a quick course-correction — help the user protect the rest of the day.

**Steps:**

1. **Read memory** (`/alfred/memory/`) — recall what mattered this morning: goals, priorities, any commitments or intentions.
2. **Assess progress** — check `tasks.md` or any artifacts that show movement. What moved? What stalled? Name stalls plainly — no scolding.
3. **Afternoon calendar** — use `get_today_events` or `get_upcoming` to show what's left today.
4. **Identify the one thing most likely to slip** — based on goals, calendar, and what hasn't moved yet, pick the single item that needs a nudge before end of day.
5. **Send via Discord** — use `send_discord_message` with a short message:
   - **Status** (2-3 lines: what moved, what didn't)
   - **Rest of day** (remaining meetings/open time)
   - **Nudge** — the one thing that will slip if ignored
   - **One question** — forces a quick decision or status update. Examples: "Is [X] still the top priority, or should we swap it for [Y]?" / "[Goal] hasn't been touched in 3 days — drop it, defer it, or protect time tomorrow?"

**Before you stop:** You **must** call **`send_discord_message`** once with your full midday message. If the tool errors, paste the message in your final reply.

**Rules:**
- Shorter than the morning message. Max ~10 lines.
- Don't repeat the full morning briefing — this is a delta/course-correction.
- Don't update memory unless the user's priorities clearly shifted.
- If Discord isn't configured, output the message as plain text.
PROMPT_EOF
    cat > /alfred/proactive/prompts/evening.md << 'PROMPT_EOF'
# Evening check-in

You are running as a scheduled proactive check-in (not a user-initiated conversation). Your job is to close out the day honestly and set up tomorrow.

**Steps:**

1. **Read memory** (`/alfred/memory/`) — load goals, commitments, habits, and anything that was flagged today.
2. **Honest recap** — what got done vs what slipped, in plain language. Tie wins back to goals when you can. Don't sugarcoat or scold.
3. **Goal trajectory** — zoom out. Are they making progress on their stated goals this week, or just staying busy? One line on alignment.
4. **Carry-forward** — what should roll to tomorrow? If tasks or commitments exist, note what needs to move. Update `tasks.md` only when it clearly helps.
5. **Tomorrow's shape** — use `get_calendar_events` for tomorrow. Give the shape in 2-3 lines (meeting load, open time, key events).
6. **Send via Discord** — use `send_discord_message` with a scannable message:
   - **Today** (what moved, what didn't — 2-3 lines)
   - **Goal check** (one line on weekly trajectory)
   - **Tomorrow** (shape of the day, carry-forward items)
   - **One question** — reflective but concrete. Examples: "What would make tomorrow feel successful before it starts?" / "You've been heads-down on [X] all week — is that still where you want your energy?" / "[Goal] has been stalled since Tuesday — want me to block time for it tomorrow?"

**Before you stop:** You **must** call **`send_discord_message`** once with your full evening wrap-up. If the tool errors, paste the message in your final reply.

**Rules:**
- Keep it honest and brief. Max ~12 lines.
- Update memory if something clearly changed (a goal completed, a deadline passed, a new commitment emerged).
- If the day was empty/quiet, still send a brief note — it confirms the check-in ran and keeps the rhythm.
- If Discord isn't configured, output the message as plain text.
PROMPT_EOF
    cat > /alfred/proactive/prompts/weekly-review.md << 'PROMPT_EOF'
# Weekly review

You are running as a scheduled weekly review (not a user-initiated conversation). Your job is memory hygiene: catch drift, force stale decisions, and keep the system honest.

**Steps:**

1. **Read all state files** — `tasks.md`, `state/active-context.md`, `state/commitments.md`, `memory/core.md`, `memory/index.md`.
2. **Stale task audit** — list every task in `tasks.md` that is >7 days past its due date. For each one, draft a reschedule-or-drop recommendation.
3. **Completed task archival** — move any `[x]` tasks older than 3 days to `tasks-archive.md`.
4. **Initiative drift check** — for each initiative in `active-context.md`, check: has the status or next action changed in the past 7 days? If not, flag it as potentially stalled.
5. **Project pointer sync** — for each project in `memory/index.md`, verify the `status` and `next_action` still match reality in `projects/<name>/README.md`. Fix any that are out of date.
6. **Commitments check** — compare `state/commitments.md` against what actually happened this week (from journal). Note any recurring commitments that were consistently skipped.
7. **Send via Discord** — use `send_discord_message` with a scannable summary:
   - **Overdue tasks** (count + list with recommendations)
   - **Stalled initiatives** (any that haven't moved in 7+ days)
   - **Archived** (count of tasks moved to archive)
   - **Pointer fixes** (any project index entries corrected)
   - **Decision needed** — concrete questions for anything that requires Travis's input

**Before you stop:** You **must** call **`send_discord_message`** once with the full review. Then perform any file updates (archival, pointer fixes, stale removal) via direct file edits.

**Rules:**
- Max ~20 lines for the Discord message. Be direct.
- Do NOT auto-delete or auto-drop tasks. Always recommend and ask.
- Do update files for mechanical fixes (archival, pointer sync, stale date correction).
- If everything is clean, send a short "all clear" note — confirms the review ran.
PROMPT_EOF
    echo "Seeded default proactive prompts in /alfred/proactive/prompts/"
  fi
  echo "Synced proactive scripts into workspace"
fi

# --- Maintenance prompt (repo-owned, always overwrite) ---
mkdir -p /alfred/proactive/prompts
cat > /alfred/proactive/prompts/maintenance.md << 'PROMPT_EOF'
# Maintenance tick

You are running as a scheduled silent maintenance job (not user-initiated). Your job is system hygiene: detect drift, fix staleness, verify consistency. **This is a background cleanup task — do NOT send any Discord messages or notify the user.**

**Steps:**

1. **Check memory freshness** — Read `state/active-context.md` and `state/today.md`. Check `Last updated` dates. If active-context is >3 days stale, update `Last updated` and add a note: "Stale — no recent session updates."
2. **Check journal health** — Read last 5 entries of `memory/journal.jsonl`. If no entries in the past 3 days, note the gap in a log line.
3. **Audit overdue tasks** — Read `tasks.md`. Any task >7 days past due: update its status annotation (e.g., add "⚠ overdue" if not already present). Do NOT delete or reschedule tasks — that's the user's decision during check-ins.
4. **Verify index pointers** — Read `memory/index.md`. For each project, verify the status description is plausible. Fix obviously stale pointers silently.
5. **Read recent proactive logs** — `bash` to read last 50 lines of `/alfred/state/proactive-morning.log`, `proactive-midday.log`, `proactive-evening.log`. Note any recurring errors.
6. **Fix what you can** — Update stale dates, correct obvious pointer mismatches. Keep changes minimal and mechanical.

**Rules:**
- **NEVER call `send_discord_message`.** This is a silent background job. No notifications.
- Max 2 minutes of work. Don't read project files unless pointers are clearly broken.
- Don't restructure or reorganize. Only fix staleness and mechanical issues.
- Output "Maintenance complete." as plain text when done, optionally listing what was fixed.
PROMPT_EOF
echo "Updated maintenance prompt in /alfred/proactive/prompts/maintenance.md"

# --- Load /alfred/config.env (user preferences on the volume) ---
# Simple KEY=VALUE parser — Railway env vars always override.
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
    # Only apply if not already set in the environment (Railway wins)
    if [ -z "${!key+x}" ]; then
      export "$key=$val"
    fi
  done < "$file"
}
apply_config /alfred/config.env

# --- Generate default config.env on first boot ---
if [ ! -f /alfred/config.env ]; then
  cp /opt/config.env.template /alfred/config.env
  echo "Generated default /alfred/config.env (all commented out)"
fi

# --- Git-based memory versioning ---
cd /alfred
git config user.name "Alfred" 2>/dev/null || true
git config user.email "alfred@automated" 2>/dev/null || true

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
fi

# --- Unify timezone ---
if [ -n "${TIMEZONE:-}" ]; then
  : "${PROACTIVE_TZ:=$TIMEZONE}"
  : "${CALDAV_TIMEZONE:=$TIMEZONE}"
  export PROACTIVE_TZ CALDAV_TIMEZONE
fi

# --- Default model ---
# ALFRED_MODEL is the single knob for model selection across all channels.
# Proactive scripts use it via fallback chain (PROACTIVE_MODEL > ALFRED_MODEL > hardcoded default).
# Discord bridge and subagent sessions use Pi's built-in resolution (auth.json / env / models.json).
# Export it so it's available to all child processes.
if [ -n "${ALFRED_MODEL:-}" ]; then
  export ALFRED_MODEL
  echo "Default model: $ALFRED_MODEL"
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

# --- Proactive check-ins (optional) ---
PROACTIVE_RECIPIENT="${DISCORD_PROACTIVE_USER_ID:-${DISCORD_OWNER_USER_ID:-}}"
HAS_LLM_KEY=false
if [ -n "${GROQ_API_KEY:-}" ] || [ -n "${ANTHROPIC_API_KEY:-}" ] || [ -n "${OPENAI_API_KEY:-}" ] || [ -n "${GEMINI_API_KEY:-}" ]; then
  HAS_LLM_KEY=true
fi
if [ "${PROACTIVE_ENABLED:-}" = "1" ] && [ -n "${DISCORD_BOT_TOKEN:-}" ] && [ -n "$PROACTIVE_RECIPIENT" ] && [ "$HAS_LLM_KEY" = true ]; then
  PROACTIVE_ROOT="${PROACTIVE_ROOT:-/alfred/proactive}"
  export PROACTIVE_ROOT
  if [ -x "${PROACTIVE_ROOT}/scheduler.sh" ]; then
    "${PROACTIVE_ROOT}/scheduler.sh" &
    echo "Proactive check-ins scheduler started (TZ=${PROACTIVE_TZ:-${TIMEZONE:-America/Los_Angeles}}, PROACTIVE_ROOT=${PROACTIVE_ROOT})"
  else
    echo "WARNING: PROACTIVE_ENABLED but ${PROACTIVE_ROOT}/scheduler.sh missing or not executable"
  fi
elif [ "${PROACTIVE_ENABLED:-}" = "1" ]; then
  echo "WARNING: PROACTIVE_ENABLED but proactive scheduler not started (need DISCORD_BOT_TOKEN, DISCORD_PROACTIVE_USER_ID or DISCORD_OWNER_USER_ID, and at least one LLM API key)"
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
if [ "${PROACTIVE_ENABLED:-}" = "1" ] && [ -n "${DISCORD_BOT_TOKEN:-}" ] && [ -n "$PROACTIVE_RECIPIENT" ] && [ "$HAS_LLM_KEY" = true ]; then
  echo " Proactive: scheduled check-ins enabled"
fi
echo "==============================="

# Keep container alive
tail -f /dev/null