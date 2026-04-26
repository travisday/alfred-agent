# Weekly review

You are running as a scheduled weekly review (not a user-initiated conversation). Your job is memory hygiene: catch drift, force stale decisions, and keep the system honest.

**Steps:**

1. **Read state** — `state/active-context.md`, `state/today.md` (if present), `blocks/identity.yaml`, `blocks/goals.yaml`, `blocks/patterns.yaml`.
2. **Read operational events** — Inspect `state/events.jsonl` for recent scheduler, delivery, and memory hygiene issues (default path; override via `PROACTIVE_EVENT_FILE` / tooling if set).
3. **Stale goal audit** — For each goal in `blocks/goals.yaml`, check `status` and `next`. If `next` is vague or unchanged for 7+ days while the goal claims to be active, draft a reschedule-or-drop recommendation. Do not delete goals automatically.
4. **Initiative drift check** — For each initiative in `state/active-context.md`, check: Has status or next action changed in the past 7 days? If not, flag it as potentially stalled.
5. **Goal sync check** — For each goal in `blocks/goals.yaml`, verify `status` and `next` still match reality in `state/projects/<name>/README.md` or `state/active-context.md` when those files exist. Fix any that are out of date.
6. **Pattern check** — Compare `blocks/patterns.yaml` against what actually happened this week (from `logs/journal.jsonl`). Note any recurring commitments that were consistently skipped.
7. **Send via Discord** — Use `send_discord_message` with a scannable summary:
   - **Stale or drifting goals** (count + list with recommendations)
   - **Stalled initiatives** (any that haven't moved in 7+ days)
   - **Operational issues** (recurring delivery, scheduler, or memory hygiene problems)
   - **Decision needed** — concrete questions for anything that requires user's input

**Before you stop:** You **must** call `send_discord_message` once with the full review. Then perform any file updates (pointer fixes, stale date correction) via direct file edits.

**Rules:**
- Max ~20 lines for the Discord message. Be direct.
- Do NOT auto-delete goals or patterns. Always recommend and ask.
- Do update files for mechanical fixes (pointer sync, stale date correction).
- If everything is clean, send a short "all clear" note — confirms the review ran.
