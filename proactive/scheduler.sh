#!/usr/bin/env bash
# Proactive scheduler: polls every POLL_SECS in PROACTIVE_TZ,
# running check-ins, daily maintenance, 2h maintenance ticks,
# and weekly reviews.
#
# Slot types:
#   check-in (morning/midday/evening) — narrow window only, no catch-up
#   _daily   — once/day mechanical maintenance (no LLM), before first check-in
#   _maint   — every 2h self-monitoring tick (LLM), git commit after
#   _weekly  — Sunday after 18:00 weekly review (LLM)
#
# No catch-up on restart: if the container was down during a slot's window,
# it does NOT fire retroactively.

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

# --- Git helper: commit if dirty ---
git_commit_if_dirty() {
  local msg="${1:-auto: memory snapshot}"
  (
    cd /alfred
    git add -A 2>/dev/null
    git diff --cached --quiet 2>/dev/null || {
      git commit -m "$msg" --no-gpg-sign 2>/dev/null
      if git remote get-url origin &>/dev/null; then
        git push origin HEAD 2>&1 || log "WARNING: git push failed (will retry next cycle)"
      fi
    }
  ) || true
}

# --- Run a single check-in with verified Discord delivery ---
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

# --- Daily maintenance (mechanical, no LLM) ---
run_daily_maintenance() {
  log "Running daily maintenance"

  # Reset today.md with today's date
  echo "# Today: $(date +%Y-%m-%d)" > /alfred/state/today.md
  echo "" >> /alfred/state/today.md
  log "Reset today.md"

  # Stamp active-context.md with today's date so check-ins see fresh state
  if [ -f /alfred/state/active-context.md ]; then
    if grep -q '^Last updated:' /alfred/state/active-context.md; then
      sed -i "s/^Last updated:.*/Last updated: $(date +%Y-%m-%d)/" /alfred/state/active-context.md
    else
      sed -i "1s/^/Last updated: $(date +%Y-%m-%d)\n/" /alfred/state/active-context.md
    fi
    log "Stamped active-context.md"
  fi

  # Reset check-in failure counters from previous day
  if [ -f "$STATE_FILE" ]; then
    local tmp_state
    tmp_state="$(mktemp)"
    awk '!/^_fail_/' "$STATE_FILE" > "$tmp_state"
    mv "$tmp_state" "$STATE_FILE"
  fi

  # Archive completed tasks from tasks.md → tasks-archive.md
  if [ -f /alfred/tasks.md ]; then
    local archived=0
    local tmp_keep tmp_archive
    tmp_keep="$(mktemp)"
    tmp_archive="$(mktemp)"
    while IFS= read -r line || [ -n "$line" ]; do
      if echo "$line" | grep -qE '^\s*-\s*\[x\]'; then
        echo "$line" >> "$tmp_archive"
        archived=$((archived + 1))
      else
        echo "$line" >> "$tmp_keep"
      fi
    done < /alfred/tasks.md
    if [ "$archived" -gt 0 ]; then
      # Append archived tasks with date header
      {
        echo ""
        echo "## Archived $(date +%Y-%m-%d)"
        cat "$tmp_archive"
      } >> /alfred/tasks-archive.md
      mv "$tmp_keep" /alfred/tasks.md
      log "Archived $archived completed tasks"
    fi
    rm -f "$tmp_keep" "$tmp_archive"
  fi

  # Truncate proactive logs to last 500 lines
  for logfile in "${STATE_DIR}"/proactive-*.log; do
    [ -f "$logfile" ] || continue
    local lines
    lines="$(wc -l < "$logfile")"
    if [ "$lines" -gt 500 ]; then
      local tmp_log
      tmp_log="$(mktemp)"
      tail -n 500 "$logfile" > "$tmp_log"
      mv "$tmp_log" "$logfile"
      log "Truncated $(basename "$logfile") from $lines to 500 lines"
    fi
  done

  log "Daily maintenance complete"
}

# --- Maintenance tick (LLM self-monitoring) ---
run_maintenance_tick() {
  local prompt="${PROACTIVE_ROOT}/prompts/maintenance.md"
  if [ ! -f "$prompt" ]; then
    log "ERROR: missing maintenance prompt: $prompt"
    return 1
  fi
  local logfile="${STATE_DIR}/proactive-maintenance.log"

  log "Starting maintenance tick"
  set +e
  (
    cd /alfred || exit 1
    pi -p --no-session --mode json \
      --thinking "$THINKING" \
      --model "${PROACTIVE_MODEL:-${ALFRED_MODEL:-groq/llama-3.3-70b-versatile}}" \
      "@${prompt}" 2>&1
  ) | tee -a "$logfile" > /dev/null
  set -e
  log "Maintenance tick complete"
}

# --- Weekly review (LLM) ---
run_weekly_review() {
  local prompt="${PROACTIVE_ROOT}/prompts/weekly-review.md"
  if [ ! -f "$prompt" ]; then
    log "ERROR: missing weekly review prompt: $prompt"
    return 1
  fi
  local logfile="${STATE_DIR}/proactive-weekly.log"

  log "Starting weekly review"
  set +e
  (
    cd /alfred || exit 1
    pi -p --no-session --mode json \
      --thinking "$THINKING" \
      --model "${PROACTIVE_MODEL:-${ALFRED_MODEL:-groq/llama-3.3-70b-versatile}}" \
      --append-system-prompt "${PROACTIVE_ROOT}/append-discord-mandatory.md" \
      "@${prompt}" 2>&1
  ) | tee -a "$logfile" > /dev/null
  set -e
  log "Weekly review complete"
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
    now_dow="$(date +%u)"  # 1=Monday, 7=Sunday

    # --- Daily maintenance (once/day, before first check-in) ---
    if [ "$(get_slot_date _daily)" != "$date_part" ]; then
      run_daily_maintenance
      git_commit_if_dirty "auto: daily maintenance $(date +%Y-%m-%dT%H:%M)"
      set_slot_date _daily "$date_part"
    fi

    # --- Check-in slots (narrow window only, no catch-up) ---
    window=$((POLL_SECS / 60 + 2))  # ~7 min with 300s poll
    for i in 0 1 2; do
      slot="${SLOT_NAMES[$i]}"
      t="${TIMES[$i]// /}"
      slot_min="$(time_to_minutes "$t")"

      if [ "$(get_slot_date "$slot")" = "$date_part" ]; then
        continue
      fi

      # Narrow window: only fire if within window minutes of slot time
      if [ "$now_min" -ge "$slot_min" ] && [ "$now_min" -le $((slot_min + window)) ]; then
        log "Slot pending: $slot ($t) — current time $(date +%H:%M)"
        if run_checkin_with_retry "$slot"; then
          log "Slot complete (verified): $slot"
          set_slot_date "$slot" "$date_part"
          git_commit_if_dirty "auto: check-in $slot $(date +%Y-%m-%dT%H:%M)"
        else
          local fail_key="_fail_${slot}"
          local prev_fails
          prev_fails="$(get_slot_date "$fail_key")"
          prev_fails="${prev_fails:-0}"
          local new_fails=$((prev_fails + 1))
          if [ "$new_fails" -ge 3 ]; then
            log "ERROR: $slot failed $new_fails times today, giving up"
            set_slot_date "$slot" "$date_part"
          else
            set_slot_date "$fail_key" "$new_fails"
            log "WARNING: $slot delivery failed (attempt $new_fails/3), will retry next poll"
          fi
        fi
      fi
    done

    # --- Maintenance tick (every 2h, self-monitoring with LLM) ---
    maint_block="${date_part}-$(printf '%02d' $((10#$now_h / 2 * 2)))"
    if [ "$(get_slot_date _maint)" != "$maint_block" ]; then
      run_maintenance_tick
      git_commit_if_dirty "auto: maintenance $(date +%Y-%m-%dT%H:%M)"
      set_slot_date _maint "$maint_block"
    fi

    # --- Weekly review (Sunday after 18:00) ---
    week_key="$(date +%G)-W$(date +%V)"
    if [ "$now_dow" = "7" ] && [ "$now_min" -ge 1080 ]; then
      if [ "$(get_slot_date _weekly)" != "$week_key" ]; then
        run_weekly_review
        git_commit_if_dirty "auto: weekly review $(date +%Y-%m-%dT%H:%M)"
        set_slot_date _weekly "$week_key"
      fi
    fi

  ) 200>>"$LOCK_FILE" || true

  sleep "$POLL_SECS"
done
