#!/usr/bin/env bash
# Run the weekly review check-in.
# Intended to be run manually or via cron (e.g. Sunday 6pm).
# Uses the same verified delivery as daily check-ins.
#
# Usage: run-weekly-review.sh [--verify]

set -euo pipefail

PROACTIVE_ROOT="${PROACTIVE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

if [ -f /etc/profile.d/railway-env.sh ]; then
  # shellcheck source=/dev/null
  . /etc/profile.d/railway-env.sh
fi

VERIFY=false
for arg in "$@"; do
  case "$arg" in
    --verify) VERIFY=true ;;
    -h|--help) echo "Usage: $0 [--verify]"; exit 0 ;;
  esac
done

PROMPT="${PROACTIVE_ROOT}/prompts/weekly-review.md"
if [ ! -f "$PROMPT" ]; then
  echo "Missing prompt: $PROMPT" >&2
  exit 1
fi

APPEND="${PROACTIVE_ROOT}/append-discord-mandatory.md"
THINKING="${PROACTIVE_THINKING:-off}"

cd /alfred

if [ "$VERIFY" = true ]; then
  TMP=$(mktemp)
  trap 'rm -f "$TMP"' EXIT
  set +e
  pi -p --no-session --mode json \
    --thinking "$THINKING" \
    --model "${PROACTIVE_MODEL:-${ALFRED_MODEL:-groq/llama-3.3-70b-versatile}}" \
    --append-system-prompt "$APPEND" \
    "@${PROMPT}" 2>&1 | tee "$TMP"
  ST="${PIPESTATUS[0]}"
  set -e
  if [ "$ST" -ne 0 ]; then
    echo "verify: pi exited with $ST" >&2
    exit "$ST"
  fi
  if grep -q 'Sent Discord DM' "$TMP"; then
    echo "verify: OK — send_discord_message success text found." >&2
    exit 0
  fi
  echo "verify: FAILED — no successful send_discord_message in output." >&2
  exit 1
fi

exec pi -p --no-session \
  --thinking "$THINKING" \
  --model "${PROACTIVE_MODEL:-${ALFRED_MODEL:-groq/llama-3.3-70b-versatile}}" \
  --append-system-prompt "$APPEND" \
  "@${PROMPT}"
