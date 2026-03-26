#!/usr/bin/env bash
# Run one proactive check-in with the same env as the container (Discord token, recipient, etc.).
# Usage: run-checkin.sh [morning|midday|evening]
# Railway env is written to /etc/profile.d/railway-env.sh at boot — source it so SSH/manual runs match the scheduler.

set -euo pipefail

if [ -f /etc/profile.d/railway-env.sh ]; then
  # shellcheck source=/dev/null
  . /etc/profile.d/railway-env.sh
fi

NAME="${1:-morning}"
case "$NAME" in
  morning | midday | evening) ;;
  *)
    echo "Usage: $0 [morning|midday|evening]" >&2
    exit 1
    ;;
esac

PROMPT="/opt/proactive/prompts/${NAME}.md"
if [ ! -f "$PROMPT" ]; then
  echo "Missing prompt: $PROMPT" >&2
  exit 1
fi

if [ -z "${DISCORD_BOT_TOKEN:-}" ] || { [ -z "${DISCORD_PROACTIVE_USER_ID:-}" ] && [ -z "${DISCORD_OWNER_USER_ID:-}" ]; }; then
  echo "WARNING: DISCORD_BOT_TOKEN and DISCORD_PROACTIVE_USER_ID or DISCORD_OWNER_USER_ID should be set or send_discord_message cannot work." >&2
  echo "If you are in SSH, run: source /etc/profile.d/railway-env.sh" >&2
fi

cd /alfred
exec pi -p --no-session \
  --model "${PROACTIVE_MODEL:-groq/openai/gpt-oss-20b}" \
  "@${PROMPT}"
