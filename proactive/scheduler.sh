#!/usr/bin/env bash
# Proactive check-ins: poll every 5 minutes in PROACTIVE_TZ (default America/Los_Angeles),
# run pi -p at each scheduled local time once per calendar day per slot.

set -u

STATE_DIR="${PROACTIVE_STATE_DIR:-/alfred/state}"
STATE_FILE="${STATE_DIR}/proactive-slots.state"
LOCK_FILE="${STATE_DIR}/proactive.lock"
TZ="${PROACTIVE_TZ:-America/Los_Angeles}"
export TZ
SCHEDULE="${PROACTIVE_SCHEDULE:-8:00,12:00,18:00}"
SLOT_NAMES=(morning midday evening)
POLL_SECS="${PROACTIVE_POLL_SECS:-300}"
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

# Parse "H:MM" or "HH:MM" to minutes from midnight
time_to_minutes() {
  local t="$1"
  local h m
  h="${t%%:*}"
  m="${t#*:}"
  h="${h#0}"
  m="${m#0}"
  echo $((10#$h * 60 + 10#$m))
}

run_checkin() {
  local name="$1"
  local prompt="/opt/proactive/prompts/${name}.md"
  if [ ! -f "$prompt" ]; then
    log "ERROR: missing prompt file: $prompt"
    return 1
  fi
  local logfile="${STATE_DIR}/proactive-${name}.log"
  log "Starting check-in: $name"
  (
    cd /alfred || exit 1
    pi -p --no-session \
      --model "${PROACTIVE_MODEL:-groq:qwen-qwq-32b}" \
      "@${prompt}" 2>&1
  ) | tee -a "$logfile"
  # PIPESTATUS[0] is the pi subshell exit; tee is [1]
  local st="${PIPESTATUS[0]}"
  if [ "$st" -ne 0 ]; then
    log "Check-in failed (exit $st): $name"
    return 1
  fi
  log "Finished check-in: $name"
  return 0
}

IFS=',' read -ra TIMES <<<"$SCHEDULE"
if [ "${#TIMES[@]}" -ne 3 ]; then
  log "ERROR: PROACTIVE_SCHEDULE must have exactly three comma-separated times (morning,midday,evening); got: $SCHEDULE"
  exit 1
fi

log "Scheduler started TZ=$TZ schedule=$SCHEDULE poll=${POLL_SECS}s"

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
      upper=$((slot_min + 5))

      if [ "$(get_slot_date "$slot")" = "$date_part" ]; then
        continue
      fi

      if [ "$now_min" -ge "$slot_min" ] && [ "$now_min" -lt "$upper" ]; then
        log "Trigger window matched for $slot ($t)"
        if run_checkin "$slot"; then
          set_slot_date "$slot" "$date_part"
        fi
      fi
    done
  ) 200>>"$LOCK_FILE" || true

  sleep "$POLL_SECS"
done
