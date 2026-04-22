#!/usr/bin/env bash
# Proactive check-ins: poll every POLL_SECS in PROACTIVE_TZ,
# run pi -p at each scheduled local time once per calendar day per slot.
#
# Catch-up: if the container was down during a slot's window, the slot fires
# on the next poll as long as `now >= slot_time` and the slot hasn't run today.
#
# Verified delivery: runs pi in JSON mode and checks for "Sent Discord DM"
# in the output. If missing, retries once before leaving the slot incomplete.

set -u

PROACTIVE_ROOT="${PROACTIVE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

STATE_DIR="${PROACTIVE_STATE_DIR:-/alfred/state}"
STATE_FILE="${STATE_DIR}/proactive-slots.state"
LOCK_FILE="${STATE_DIR}/proactive.lock"
TZ="${PROACTIVE_TZ:-${TIMEZONE:-America/Los_Angeles}}"
export TZ
SCHEDULE="${PROACTIVE_SCHEDULE:-8:00,12:00,18:00}"
SLOT_NAMES=(morning midday evening)
POLL_SECS="${PROACTIVE_POLL_SECS:-300}"
THINKING="${PROACTIVE_THINKING:-off}"
MAX_RETRIES="${PROACTIVE_MAX_RETRIES:-1}"
LOG_PREFIX="[proactive]"

log() {
  echo "${LOG_PREFIX} $*"
}

mkdir -p "$STATE_DIR"

get_slot_date() {
  local slot="$1"
  if [ ! -f "$STATE_FILE" ]; then
    echo ""
    return
  fi
  awk -v s="$slot" '$1==s { print $2; exit }' "$STATE_FILE"
}

set_slot_date() {
  local slot="$1"
  local date="$2"
  touch "$STATE_FILE"
  local tmp
  tmp="$(mktemp)"
  if [ -f "$STATE_FILE" ]; then
    awk -v s="$slot" '$1!=s { print }' "$STATE_FILE" >"$tmp" || true
  fi
  echo "$slot $date" >>"$tmp"
  mv "$tmp" "$STATE_FILE"
}

time_to_minutes() {
  local t="$1"
  local h m
  h="${t%%:*}"
  m="${t#*:}"
  h="${h#0}"
  m="${m#0}"
  echo $((10#$h * 60 + 10#$m))
}

# Run a single check-in with verified Discord delivery.
# Returns 0 only if pi succeeds AND "Sent Discord DM" appears in output.
run_checkin_verified() {
  local name="$1"
  local prompt="${PROACTIVE_ROOT}/prompts/${name}.md"
  if [ ! -f "$prompt" ]; then
    log "ERROR: missing prompt file: $prompt"
    return 1
  fi
  local logfile="${STATE_DIR}/proactive-${name}.log"
  local tmp
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' RETURN

  log "Starting verified check-in: $name"
  set +e
  (
    cd /alfred || exit 1
    pi -p --no-session --mode json \
      --thinking "$THINKING" \
      --model "${PROACTIVE_MODEL:-${ALFRED_MODEL:-groq/llama-3.3-70b-versatile}}" \
      --append-system-prompt "${PROACTIVE_ROOT}/append-discord-mandatory.md" \
      "@${prompt}" 2>&1
  ) | tee -a "$logfile" > "$tmp"
  local st="${PIPESTATUS[0]}"
  set -e

  if [ "$st" -ne 0 ]; then
    log "Check-in failed (exit $st): $name"
    return 1
  fi

  if grep -q 'Sent Discord DM' "$tmp"; then
    log "Verified check-in: $name — Discord DM confirmed"
    return 0
  fi

  log "Check-in ran but Discord DM not confirmed: $name"
  return 1
}

# Run check-in with retry on failure.
run_checkin_with_retry() {
  local name="$1"
  local attempt=0
  while [ "$attempt" -le "$MAX_RETRIES" ]; do
    if run_checkin_verified "$name"; then
      return 0
    fi
    attempt=$((attempt + 1))
    if [ "$attempt" -le "$MAX_RETRIES" ]; then
      log "Retrying check-in ($attempt/$MAX_RETRIES): $name"
      sleep 10
    fi
  done
  log "All attempts exhausted for: $name"
  return 1
}

IFS=',' read -ra TIMES <<<"$SCHEDULE"
if [ "${#TIMES[@]}" -ne 3 ]; then
  log "ERROR: PROACTIVE_SCHEDULE must have exactly three comma-separated times (morning,midday,evening); got: $SCHEDULE"
  exit 1
fi

log "Scheduler started TZ=$TZ schedule=$SCHEDULE poll=${POLL_SECS}s verified=true"

while true; do
  (
    flock -n 200 || exit 0

    date_part="$(date +%Y-%m-%d)"
    now_h="$(date +%H)"
    now_m="$(date +%M)"
    now_min=$((10#$now_h * 60 + 10#$now_m))

    for i in 0 1 2; do
      slot="${SLOT_NAMES[$i]}"
      t="${TIMES[$i]// /}"
      slot_min="$(time_to_minutes "$t")"

      if [ "$(get_slot_date "$slot")" = "$date_part" ]; then
        continue
      fi

      # Catch-up: fire if current time is at or past the slot time (not a narrow window).
      # Once-per-day idempotency is ensured by proactive-slots.state.
      if [ "$now_min" -ge "$slot_min" ]; then
        log "Slot pending: $slot ($t) — current time $(date +%H:%M)"
        if run_checkin_with_retry "$slot"; then
          set_slot_date "$slot" "$date_part"
        fi
      fi
    done
  ) 200>>"$LOCK_FILE" || true

  sleep "$POLL_SECS"
done
