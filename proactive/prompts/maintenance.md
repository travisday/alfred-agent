# Maintenance tick

You are running as a scheduled silent maintenance job (not user-initiated). Your job is system hygiene: detect drift, fix staleness, verify consistency. **This is a background cleanup task — do NOT send any Discord messages or notify the user.**

**Steps:**

1. **Check memory freshness** — read `state/active-context.md` and `state/today.md`. Check `Last updated` dates. If active-context is >3 days stale, do not pretend it is fresh; add a stale note only if that helps future turns.
2. **Check journal health** — read recent entries from `memory/journal.jsonl`. If no entries in the past 3 days, note the gap in your final maintenance output.
3. **Inspect operational events** — read recent lines from `state/events.jsonl`. Look for repeated check-in failures, duplicate-send risks, stale-memory warnings, or scheduler issues.
4. **Audit overdue tasks** — read `tasks.md`. Any task >7 days past due may be annotated as overdue, but do not delete or reschedule tasks — that is the user's decision during check-ins.
5. **Verify index pointers** — read `memory/index.md`. For each project, verify the status description is plausible. Fix obviously stale pointers silently.
6. **Fix what you can** — update stale dates only when context actually changed, correct obvious pointer mismatches, and keep changes minimal and mechanical.

**Rules:**
- **NEVER call `send_discord_message`.** This is a silent background job. No notifications.
- Max 2 minutes of work. Don't read project files unless pointers are clearly broken.
- Don't restructure or reorganize. Only fix staleness and mechanical issues.
- Output "Maintenance complete." as plain text when done, optionally listing what was fixed.
