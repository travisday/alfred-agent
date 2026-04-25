# Weekly review

You are running as a scheduled weekly review (not a user-initiated conversation). Your job is memory hygiene: catch drift, force stale decisions, and keep the system honest.

**Steps:**

1. **Read all state files** — `tasks.md`, `state/active-context.md`, `state/commitments.md`, `memory/core.md`, `memory/index.md`.
2. **Read operational events** — inspect `state/events.jsonl` for recent scheduler, delivery, and memory hygiene issues.
3. **Stale task audit** — list every task in `tasks.md` that is >7 days past its due date. For each one, draft a reschedule-or-drop recommendation.
4. **Completed task archival** — move any `[x]` tasks older than 3 days to `tasks-archive.md`.
5. **Initiative drift check** — for each initiative in `active-context.md`, check: has the status or next action changed in the past 7 days? If not, flag it as potentially stalled.
6. **Project pointer sync** — for each project in `memory/index.md`, verify the `status` and `next_action` still match reality in `projects/<name>/README.md`. Fix any that are out of date.
7. **Commitments check** — compare `state/commitments.md` against what actually happened this week (from journal). Note any recurring commitments that were consistently skipped.
8. **Send via Discord** — use `send_discord_message` with a scannable summary:
   - **Overdue tasks** (count + list with recommendations)
   - **Stalled initiatives** (any that haven't moved in 7+ days)
   - **Operational issues** (recurring delivery, scheduler, or memory hygiene problems)
   - **Archived** (count of tasks moved to archive)
   - **Decision needed** — concrete questions for anything that requires Travis's input

**Before you stop:** You **must** call **`send_discord_message`** once with the full review. Then perform any file updates (archival, pointer fixes, stale removal) via direct file edits.

**Rules:**
- Max ~20 lines for the Discord message. Be direct.
- Do NOT auto-delete or auto-drop tasks. Always recommend and ask.
- Do update files for mechanical fixes (archival, pointer sync, stale date correction).
- If everything is clean, send a short "all clear" note — confirms the review ran.
