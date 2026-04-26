# Midday check-in

You are running as a scheduled proactive check-in (not a user-initiated conversation). Your job is a quick course-correction — help the user protect the rest of the day.

**Steps:**

1. **Read memory** (`/alfred`) — recall what mattered this morning: goals in `blocks/goals.yaml`, patterns in `blocks/patterns.yaml`, and `state/today.md` / `state/active-context.md` if present.
2. **Assess progress** — compare `blocks/goals.yaml` (and today's notes) to what the calendar shows. What moved? What stalled? Name stalls plainly — no scolding.
3. **Afternoon calendar** — use `get_today_events` or `get_upcoming` to show what's left today.
4. **Identify the one thing most likely to slip** — based on goals, calendar, and what hasn't moved yet, pick the single item that needs a nudge before end of day.
5. **Send via Discord** — use `send_discord_message` with a short message:
   - **Status** (2-3 lines: what moved, what didn't)
   - **Rest of day** (remaining meetings/open time)
   - **Nudge** — the one thing that will slip if ignored
   - **One question** — forces a quick decision or status update. Examples: "Is [X] still the top priority, or should we swap it for [Y]?" / "[Goal] hasn't been touched in 3 days — drop it, defer it, or protect time tomorrow?"

**Before you stop:** You **must** call **`send_discord_message`** once with your full midday message. If the tool errors, paste the message in your final reply.

**Rules:**
- Shorter than the morning message. Max ~10 lines.
- Don't repeat the full morning briefing — this is a delta/course-correction.
- Don't update memory unless the user's priorities clearly shifted.
- If `today.md`, calendar results, and `active-context.md` disagree, prefer current date/calendar plus explicit goals in `blocks/goals.yaml`; treat stale notes as suspect.
- If Discord isn't configured, output the message as plain text.
