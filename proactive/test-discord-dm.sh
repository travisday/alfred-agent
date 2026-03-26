#!/usr/bin/env bash
# Smoke test: send a short DM via Discord REST only (no Pi / no LLM).
# Verifies DISCORD_BOT_TOKEN, recipient ID, and that the user has DM'd the bot at least once.
# Usage: test-discord-dm.sh [optional message]

set -euo pipefail

if [ -f /etc/profile.d/railway-env.sh ]; then
  # shellcheck source=/dev/null
  . /etc/profile.d/railway-env.sh
fi

TOKEN="${DISCORD_BOT_TOKEN:-}"
RECIPIENT="${DISCORD_PROACTIVE_USER_ID:-${DISCORD_OWNER_USER_ID:-}}"
MSG="${1:-Alfred: Discord REST smoke test OK — bot can DM you.}"

if [ -z "$TOKEN" ]; then
  echo "ERROR: DISCORD_BOT_TOKEN is not set (source /etc/profile.d/railway-env.sh after boot)." >&2
  exit 1
fi
if [ -z "$RECIPIENT" ]; then
  echo "ERROR: Set DISCORD_PROACTIVE_USER_ID or DISCORD_OWNER_USER_ID." >&2
  exit 1
fi

API="https://discord.com/api/v10"

BODY_CREATE=$(node -e "console.log(JSON.stringify({ recipient_id: process.argv[1] }))" "$RECIPIENT")
RESP=$(curl -fsS -H "Authorization: Bot ${TOKEN}" -H "Content-Type: application/json" \
  -X POST "$API/users/@me/channels" -d "$BODY_CREATE") || {
  echo "ERROR: create DM failed. Check token, recipient ID, and that you have DM'd the bot at least once." >&2
  exit 1
}

CHANNEL_ID=$(printf '%s' "$RESP" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).id)")
if [ -z "${CHANNEL_ID:-}" ]; then
  echo "ERROR: could not parse channel id: ${RESP:0:300}" >&2
  exit 1
fi

BODY_MSG=$(node -e "console.log(JSON.stringify({ content: process.argv[1] }))" "$MSG")
curl -fsS -H "Authorization: Bot ${TOKEN}" -H "Content-Type: application/json" \
  -X POST "$API/channels/${CHANNEL_ID}/messages" -d "$BODY_MSG" >/dev/null || {
  echo "ERROR: send message failed." >&2
  exit 1
}

echo "OK: test DM sent to recipient ${RECIPIENT}."
