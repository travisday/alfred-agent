## Proactive check-in — how delivery works

The user reads scheduled check-ins **only** through **Discord DMs**, not from this terminal.

1. **You MUST call the tool `send_discord_message`** once with the **full** check-in (bullets/sections are fine). That is the real deliverable.
2. **Do not** put the main check-in only in your plain-text assistant reply. Terminal output is not the inbox.
3. After the tool succeeds, your final assistant message must be **one short line** only (e.g. `Sent on Discord.` or `Posted to Discord.`) — **not** a copy of the check-in body.
4. If `send_discord_message` returns an error, say so in one line, then **paste the full message** in your reply so the user can read it here.

Skipping the tool or duplicating the long summary only in chat counts as a failed check-in.
