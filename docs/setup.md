# Setup

## 1. Tailscale Auth Key (`TS_AUTHKEY`)

Used to connect the Railway container to your private Tailscale network so you can SSH in from any device.

1. Create a free account at [tailscale.com](https://tailscale.com)
2. Go to the [Tailscale admin console → Keys](https://login.tailscale.com/admin/settings/keys)
3. Click **Generate auth key**
4. Settings:
   - **Reusable**: Yes
   - **Ephemeral**: No (the node should persist across container restarts)
   - **Expiration**: Set to your preference (you'll need to regenerate when it expires)
5. Copy the key — this becomes your `TS_AUTHKEY` env var

## 2. LLM Provider API Key

Alfred uses the [Pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) under the hood, which supports multiple LLM providers. You need an API key for at least one.

The `start.sh` script automatically detects whichever API keys you set and configures Pi accordingly. You can set one or multiple — just add the env var(s) for your preferred provider(s):

| Provider | Env Variable | Get a Key |
|----------|-------------|-----------|
| Groq | `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) |
| Anthropic | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| OpenAI | `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) |
| Google Gemini | `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) |

> **Tip:** You can set multiple provider keys at once. The startup script builds `auth.json` with all detected providers, so you can switch between models at runtime using Pi's `/model` command.

## 3. CalDAV (optional — Apple Calendar)

Set `CALDAV_APP_PASSWORD` in Railway. Put the non-secret settings in `/alfred/config.env`:

```env
CALDAV_USERNAME=you@icloud.com
CALDAV_SERVER_URL=https://caldav.icloud.com
```

The calendar extension uses `TIMEZONE` for display times and date interpretation (see [Configuration](configuration.md)). You can override with `CALDAV_TIMEZONE` if the calendar needs a different zone.

When configured, Alfred can use `get_today_events`, `get_calendar_events`, and `get_upcoming` to read your schedule. Only calendars synced to this Apple ID over iCloud are available (not local-only "On My Mac" calendars).

## 4. Discord (optional)

To talk to Alfred via Discord DMs, set `DISCORD_BOT_TOKEN` in Railway:

1. Create an application at [Discord Developer Portal](https://discord.com/developers/applications)
2. Go to **Bot** → **Add Bot** → copy the token
3. Enable **Message Content Intent** (Privileged Gateway Intents)
4. Add the bot to a server (or use the DM link from the OAuth2 URL generator)
5. Set `DISCORD_BOT_TOKEN` in Railway

The bridge creates the Pi session on your first DM (agent on-demand). Conversation persists across messages and container restarts.

Discord commands:

- `/new` - reset interactive session context.
- `/task <request>` - run work in background and get a completion DM when done.
- `/status` - list your most recent task IDs and states.
- `/status <taskId>` - inspect one task.

Background tasks are explicit-first (`/task`), with optional automatic fallback for obviously long-running requests.

Discord preferences (DM policy, user IDs, timeouts) go in `/alfred/config.env` — see [Configuration](configuration.md).

### Proactive check-ins (optional)

Set `PROACTIVE_ENABLED=1` in Railway to run three daily check-ins (default **8:00, 12:00, 18:00** in your `TIMEZONE`). A background script invokes `pi -p` with **thin** prompts from **`/alfred/proactive/prompts/`** (morning, midday, evening)—each slot only adds an agenda; main behavior and context still come from `.pi/SYSTEM.md`, `/alfred/AGENTS.md`, and `/alfred/memory/`. Prompts are seeded on first boot and live on the volume so you can edit them without redeploying. Alfred uses the **`send_discord_message`** tool (discord-notify extension) to DM you a summary via the **same** `DISCORD_BOT_TOKEN` as the bridge (HTTP REST only — no second Gateway connection).

**With `PROACTIVE_ENABLED=1` you need:** `DISCORD_BOT_TOKEN`, a recipient user ID (`DISCORD_PROACTIVE_USER_ID` or `DISCORD_OWNER_USER_ID` in config.env), and at least one LLM API key. The user must have **DMed the bot at least once** so Discord allows outbound DMs to that user.

Proactive preferences (`PROACTIVE_SCHEDULE`, `PROACTIVE_MODEL`, `PROACTIVE_THINKING`, `PROACTIVE_POLL_SECS`) all go in `/alfred/config.env`. `PROACTIVE_ENABLED` stays in Railway as an easy on/off toggle.

| Variable | Where | Description |
|----------|-------|-------------|
| `PROACTIVE_ENABLED` | Railway | Set to `1` to start the proactive scheduler |
| `PROACTIVE_VERIFY` | Railway / env | Manual testing: `1` with `run-checkin.sh` = exit 1 unless `send_discord_message` succeeded |
| All other `PROACTIVE_*` | config.env | Schedule, model, thinking, poll interval, root directory |
| `DISCORD_PROACTIVE_USER_ID` | config.env | DM recipient; defaults to `DISCORD_OWNER_USER_ID` |

Scheduler state and logs live under `/alfred/state/` (e.g. `proactive-slots.state`, `proactive-morning.log`).

#### Testing proactive (Discord + Pi)

Always load Railway env in SSH (`source /etc/profile.d/railway-env.sh`) or use a **new** login shell so `/root/.bashrc` runs — otherwise `DISCORD_BOT_TOKEN` may be unset.

1. **Discord-only smoke test (no LLM)** — proves token + recipient + "you DM'd the bot":

   ```bash
   "${PROACTIVE_ROOT:-/opt/proactive}/test-discord-dm.sh"
   ```

   You should receive a short test DM. If this fails, fix env or Discord before debugging Pi.

2. **Full check-in (Pi + tools)** — same as the scheduler uses:

   ```bash
   "${PROACTIVE_ROOT:-/opt/proactive}/run-checkin.sh" morning
   ```

   `pi -p` in **text** mode only prints the model's **final assistant text**, not tool traces — you can see a long reply in the terminal and still get **no DM** if the model skipped `send_discord_message`.

3. **Verify the model actually called `send_discord_message`** — runs Pi with `--mode json` and **exits 1** unless the stream contains the extension's success text (`Sent Discord DM`):

   ```bash
   "${PROACTIVE_ROOT:-/opt/proactive}/run-checkin.sh" morning --verify
   # or: PROACTIVE_VERIFY=1 "${PROACTIVE_ROOT:-/opt/proactive}/run-checkin.sh" morning
   ```

4. **Scheduled runs** — tail `/alfred/state/proactive-morning.log` (etc.) after a trigger; shorten the wait with `PROACTIVE_SCHEDULE` + `PROACTIVE_POLL_SECS` while testing.

**No DM but the run "succeeded":** (1) Env missing — `run-checkin.sh` sources env; don't run raw `pi` without it. (2) Never DM'd the bot — DM it once. (3) Wrong user ID. (4) stderr lines `[discord-notify]` / `Discord send failed`. (5) Model skipped the tool — use **`--verify`**; ensure `--append-system-prompt` points at `${PROACTIVE_ROOT}/append-discord-mandatory.md` (default in `run-checkin.sh` / scheduler).

**`Tool call validation failed` / `read<|channel|>commentary`:** Groq **`openai/gpt-oss-*`** models can corrupt tool names when Pi's thinking mode is on. Proactive runs default to **`PROACTIVE_THINKING=off`** (`--thinking off`). If you overrode thinking, unset it or set `PROACTIVE_THINKING=off`. Alternatively set `PROACTIVE_MODEL` to a non–reasoning Groq model (e.g. `groq/llama-3.3-70b-versatile`).

## 5. Web Search (optional — Tavily)

Set `TAVILY_API_KEY` in Railway to give Alfred live web search. Get a key at [tavily.com](https://www.tavily.com/).

Default behavior is cost-conscious: basic search depth, small result set, optional deep page extraction only when needed.
