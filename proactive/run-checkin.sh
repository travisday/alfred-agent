#!/usr/bin/env bash
# Run one proactive check-in with the same env as the container (Discord token, recipient, etc.).
# Usage: run-checkin.sh [morning|midday|evening] [--verify]
#   --verify / PROACTIVE_VERIFY=1 — run Pi in JSON mode and exit 1 unless output contains a successful send_discord_message (\"Sent Discord DM\").
# Railway env is written to /etc/profile.d/railway-env.sh at boot — source it so SSH/manual runs match the scheduler.

set -euo pipefail

if [ -f /etc/profile.d/railway-env.sh ]; then
  # shellcheck source=/dev/null
  . /etc/profile.d/railway-env.sh
fi

VERIFY=false
if [ "${PROACTIVE_VERIFY:-}" = "1" ] || [ "${PROACTIVE_VERIFY:-}" = "true" ]; then
  VERIFY=true
fi

NAME="morning"
for arg in "$@"; do
  case "$arg" in
    --verify) VERIFY=true ;;
    morning | midday | evening) NAME="$arg" ;;
    -h | --help)
      echo "Usage: $0 [morning|midday|evening] [--verify]"
      echo "  PROACTIVE_VERIFY=1 is equivalent to --verify"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [morning|midday|evening] [--verify]" >&2
      exit 1
      ;;
  esac
done

PROMPT="/opt/proactive/prompts/${NAME}.md"
if [ ! -f "$PROMPT" ]; then
  echo "Missing prompt: $PROMPT" >&2
  exit 1
fi

if [ -z "${DISCORD_BOT_TOKEN:-}" ] || { [ -z "${DISCORD_PROACTIVE_USER_ID:-}" ] && [ -z "${DISCORD_OWNER_USER_ID:-}" ]; }; then
  echo "WARNING: DISCORD_BOT_TOKEN and DISCORD_PROACTIVE_USER_ID or DISCORD_OWNER_USER_ID should be set or send_discord_message cannot work." >&2
  echo "If you are in SSH, run: source /etc/profile.d/railway-env.sh" >&2
fi

APPEND="/opt/proactive/append-discord-mandatory.md"

cd /alfred

if [ "$VERIFY" = true ]; then
  TMP=$(mktemp)
  trap 'rm -f "$TMP"' EXIT
  set +e
  pi -p --no-session --mode json \
    --model "${PROACTIVE_MODEL:-groq/openai/gpt-oss-20b}" \
    --append-system-prompt "$APPEND" \
    "@${PROMPT}" 2>&1 | tee "$TMP"
  ST="${PIPESTATUS[0]}"
  set -e
  if [ "$ST" -ne 0 ]; then
    echo "verify: pi exited with $ST" >&2
    exit "$ST"
  fi
  if grep -q 'Sent Discord DM' "$TMP"; then
    echo "verify: OK — send_discord_message success text found in JSON stream." >&2
    exit 0
  fi
  echo "verify: FAILED — no successful send_discord_message in output (look for 'Sent Discord DM'). Model may have skipped the tool." >&2
  exit 1
fi

exec pi -p --no-session \
  --model "${PROACTIVE_MODEL:-groq/openai/gpt-oss-20b}" \
  --append-system-prompt "$APPEND" \
  "@${PROMPT}"
