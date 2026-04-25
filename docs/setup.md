# Setup

A complete guide to deploying Alfred on Railway and connecting from any device.

## 1. Prerequisites

You need accounts on three services (all have free tiers):

- **GitHub** — [github.com](https://github.com) — hosts the repo and connects to Railway
- **Railway** — [railway.com](https://railway.com) — runs the container
- **Tailscale** — [tailscale.com](https://tailscale.com) — private network for SSH access

## 2. Clone the repo

```bash
git clone https://github.com/travisday/alfred-agent.git
cd alfred-agent
```

Push to your own GitHub repo (Railway deploys from your repo).

## 3. Deploy to Railway

1. In [Railway](https://railway.com), create a **New Project** → **Deploy from GitHub repo**
2. Select your `alfred-agent` repository
3. Railway auto-detects the Dockerfile and builds it

Don't deploy yet — you need a volume and env vars first.

## 4. Add a volume

In your Railway service, create a volume:

| Volume | Mount Path | Purpose |
|--------|-----------|---------|
| `alfred-data` | `/alfred` | Workspace files, memory, Tailscale state |

> Tailscale state is stored inside `/alfred/.tailscale/` so only one volume is needed.

## 5. Set required environment variables

Add these in your Railway service **Variables** tab.

### Tailscale (`TS_AUTHKEY`)

1. Go to the [Tailscale admin console → Keys](https://login.tailscale.com/admin/settings/keys)
2. Click **Generate auth key**
3. Settings:
   - **Reusable**: Yes
   - **Ephemeral**: No (the node should persist across container restarts)
   - **Expiration**: Set to your preference (you'll need to regenerate when it expires)
4. Copy the key → set as `TS_AUTHKEY` in Railway

### `RAILWAY_RUN_UID=0`

Required for volumes to mount correctly. Set this exactly as shown.

### LLM provider key

You need at least one. Set the env var for your preferred provider:

| Provider | Env Variable | Get a Key |
|----------|-------------|-----------|
| Anthropic | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| Groq | `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) |
| OpenAI | `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) |
| Google Gemini | `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) |

> **Tip:** You can set multiple provider keys. The startup script builds `auth.json` with all detected providers, so you can switch between models at runtime using Pi's `/model` command.

### `SSH_PASSWORD` (optional)

Root SSH password — defaults to `changeme` if not set. Only needed for direct IP SSH (Tailscale SSH doesn't use passwords).

## 6. Deploy and verify Tailscale

Hit **Deploy** in Railway. Once the container is running, check your [Tailscale admin console](https://login.tailscale.com/admin/machines) — a node called **alfred** should appear.

## 7. Connect and seed workspace

### Connect to Alfred

```bash
tailscale ssh root@alfred
```

Tailscale SSH handles authentication automatically — no SSH keys needed.

> On Railway, plain `ssh` to the Tailnet IP often times out; see [SSH, SFTP, and file access](ssh-and-access.md).

### Create the directory structure

On first boot, the `/alfred` volume is empty. Create the workspace:

```bash
cd /alfred
mkdir -p memory projects reference state
touch tasks.md
```

This volume is Alfred's personal context: memory files, state files, project notes, tasks, and journal entries. Agent behavior is supplied by `alfred-agent` and synced into `/alfred/.pi/` on boot.

> Do not use `/alfred/AGENTS.md` for Alfred behavior. `start.sh` removes stale workspace `AGENTS.md` files on boot so behavior stays owned by `.pi/SYSTEM.md` in the `alfred-agent` repo.

---

**Steps 1–7 are the critical path.** Alfred is now deployed and accessible. Everything below is optional.

---

## 8. Optional integrations

### CalDAV (Apple Calendar)

Set `CALDAV_APP_PASSWORD` in Railway. Put the non-secret settings in `/alfred/config.env`:

```env
CALDAV_USERNAME=you@icloud.com
CALDAV_SERVER_URL=https://caldav.icloud.com
```

Generate an app-specific password at [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords.

The calendar extension uses `TIMEZONE` for display times and date interpretation (see [Configuration](configuration.md)). You can override with `CALDAV_TIMEZONE` if the calendar needs a different zone.

When configured, Alfred can use `get_today_events`, `get_calendar_events`, and `get_upcoming` to read your schedule. Only calendars synced to this Apple ID over iCloud are available (not local-only "On My Mac" calendars).

### Discord DM bridge

To talk to Alfred via Discord DMs, set `DISCORD_BOT_TOKEN` in Railway:

1. Create an application at [Discord Developer Portal](https://discord.com/developers/applications)
2. Go to **Bot** → **Add Bot** → copy the token
3. Enable **Message Content Intent** (Privileged Gateway Intents)
4. Add the bot to a server (or use the DM link from the OAuth2 URL generator)
5. Set `DISCORD_BOT_TOKEN` in Railway

The bridge creates the Pi session on your first DM (agent on-demand). Conversation persists across messages and container restarts.

Discord commands:

- `!new` - reset interactive session context.
- `!task <request>` - run work in background and get a completion DM when done.
- `!status` - list your most recent task IDs and states.
- `!status <taskId>` - inspect one task.

Background tasks are explicit-first (`!task`), with optional automatic fallback for obviously long-running requests.

Discord preferences (DM policy, user IDs, timeouts) go in `/alfred/config.env` — see [Configuration](configuration.md).

### Proactive check-ins

Set `PROACTIVE_ENABLED=1` in Railway to run three daily check-ins (default **8:00, 12:00, 18:00** in your `TIMEZONE`). A background script invokes `pi -p` with prompts from **`/alfred/proactive/prompts/`** (morning, midday, evening); main behavior comes from `.pi/SYSTEM.md`, and personal context comes from `/alfred/memory/`, `/alfred/state/`, `tasks.md`, and recent journal entries. Prompts are seeded from the `alfred-agent` image when `PROMPT_VERSION` increases. Alfred uses the **`send_discord_message`** tool (discord-notify extension) to DM you a summary via the **same** `DISCORD_BOT_TOKEN` as the bridge (HTTP REST only — no second Gateway connection).

**With `PROACTIVE_ENABLED=1` you need:** `DISCORD_BOT_TOKEN`, a recipient user ID (`DISCORD_PROACTIVE_USER_ID` or `DISCORD_OWNER_USER_ID` in config.env), and at least one LLM API key. The user must have **DMed the bot at least once** so Discord allows outbound DMs to that user.

Proactive preferences (`PROACTIVE_SCHEDULE`, `PROACTIVE_MODEL`, `PROACTIVE_THINKING`, `PROACTIVE_POLL_SECS`) all go in `/alfred/config.env`. `PROACTIVE_ENABLED` stays in Railway as an easy on/off toggle.

| Variable | Where | Description |
|----------|-------|-------------|
| `PROACTIVE_ENABLED` | Railway | Set to `1` to start the proactive scheduler |
| `PROACTIVE_VERIFY` | Railway / env | Manual testing: `1` with `run-checkin.sh` = exit 1 unless `send_discord_message` succeeded |
| All other `PROACTIVE_*` | config.env | Schedule, model, thinking, poll interval, root directory |
| `DISCORD_PROACTIVE_USER_ID` | config.env | DM recipient; defaults to `DISCORD_OWNER_USER_ID` |

Scheduler state and logs live under `/alfred/state/` (e.g. `proactive-slots.state`, `proactive-morning.log`, `events.jsonl`).

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

### Web search (Tavily)

Set `TAVILY_API_KEY` in Railway to give Alfred live web search. Get a key at [tavily.com](https://www.tavily.com/).

Default behavior is cost-conscious: basic search depth, small result set, optional deep page extraction only when needed.

## 9. Custom system prompt

Alfred uses a **custom system prompt** that replaces the default Pi agent one. It lives at `.pi/SYSTEM.md` in this repo and is baked into the Docker image at build time.

The default Pi system prompt is designed for a general-purpose coding agent. Alfred's system prompt (`SYSTEM.md`) reframes Pi as a personal executive assistant focused on organization, task management, and working with markdown files.

If you want to customize it, edit `.pi/SYSTEM.md` in this repo and redeploy:

```
.pi/
├── SYSTEM.md              ← Alfred's system prompt (replaces Pi's default)
└── extensions/
    └── caldav/            ← CalDAV extension (Apple Calendar)
        ├── index.ts
        └── package.json
```

> **How it works:** Pi looks for `.pi/SYSTEM.md` in the working directory and uses it as the system prompt instead of its built-in default. The Dockerfile stages `.pi/` into the image, and `start.sh` copies it into `/alfred/.pi/` on every boot — so it's always available in the volume where you land via SSH. Extensions under `.pi/extensions/` are auto-discovered (for example CalDAV calendar tools when CalDAV credentials are set; `web_search` when `TAVILY_API_KEY` is set; **`send_discord_message`** from `discord-notify` when `DISCORD_BOT_TOKEN` and a recipient user ID are available for proactive check-ins).

## 10. Daily usage

1. Open your terminal app (Tailscale running on your device)
2. `tailscale ssh root@alfred` (or native `ssh root@<tailscale-ip>` if you use kernel TUN — see [SSH, SFTP, and file access](ssh-and-access.md))
3. `cd /alfred && pi`
4. Talk to Alfred — he reads your markdown files for context
5. When done, quit Pi (`Ctrl+C`). State is saved in the markdown files.
6. Next time you connect, Alfred picks up where you left off

## 11. What's next

- [Configuration](configuration.md) — env var reference, `config.env` template, GitHub memory syncing
- [SSH, SFTP, and file access](ssh-and-access.md) — kernel TUN, SSHFS mounts, phone access
- [Troubleshooting](troubleshooting.md) — common issues and fixes
