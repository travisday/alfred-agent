# Setup

A complete guide to deploying Alfred on Railway and connecting from any device.

## 1. Prerequisites

You need accounts on three services (all have free tiers):

- **GitHub** — [github.com](https://github.com) — hosts repo and connects to Railway
- **Railway** — [railway.com](https://railway.com) — runs the container
- **Tailscale** — [tailscale.com](https://tailscale.com) — private network for SSH access

## 2. Clone repos

Clone both the agent and memory repositories:

```bash
git clone https://github.com/travisday/alfred-agent.git
cd alfred-agent
git clone https://github.com/travisday/alfred-memory.git
```

Push the memory repo to your own GitHub account if you want private storage.

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

Add these in your Railway service **Variables** tab:

### Tailscale (`TS_AUTHKEY`)

1. Go to [Tailscale admin console → Keys](https://login.tailscale.com/admin/settings/keys)
2. Click **Generate auth key**
3. Settings:
   - **Reusable**: Yes
   - **Ephemeral**: No (the node should persist across container restarts)
   - **Expiration**: Set to your preference (you'll need to regenerate when it expires)
4. Copy the key
5. Add as `TS_AUTHKEY` in Railway

### Root user (`RAILWAY_RUN_UID`)

Set to `0` — required for volumes to mount correctly.

### LLM provider key

You need at least one. Set as env var for your preferred provider:

| Provider | Env Variable | Get a Key |
|----------|-------------|-----------|
| Anthropic | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| Groq | `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) |
| OpenAI | `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) |
| Google Gemini | `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) |

> You can set multiple provider keys. The startup script builds `auth.json` with all detected providers, so you can switch between models at runtime using Pi's `/model` command.

## 6. Deploy and verify

1. In Railway, click **Deploy Now** on your project
2. Wait for the container to start
3. Check the **Logs** tab in Railway — you should see "Alfred is online."

## 7. Connect and verify Tailscale

Go to [Tailscale admin console → Machines](https://login.tailscale.com/admin/machines) — a node called **alfred** should appear.

If you don't see it, verify `TS_AUTHKEY` is correct and wait a moment for Tailscale to connect.

## 8. Connect and seed workspace

### Connect to Alfred

```bash
tailscale ssh root@alfred
```

Tailscale SSH handles authentication automatically — no SSH keys needed.

### Create memory structure

On first boot, the `/alfred` volume will be empty. Create the workspace:

```bash
cd /alfred
mkdir -p blocks state projects logs
touch tasks.md tasks-archive.md
```

The memory system uses a structural separation:

```
alfred-memory/
├── blocks/              # ALWAYS-IN-PROMPT YAML
│   ├── identity.yaml      # Who the user is, current focus
│   ├── preferences.yaml    # Communication style, workflow
│   ├── goals.yaml         # Current goals and status
│   └── patterns.yaml      # Recurring commitments, habits
├── state/               # ON-DEMAND MARKDOWN
│   ├── projects/         # Project-specific content, read when needed
│   ├── active-context.md   # Initiatives, session notes
│   └── today.md          # Daily priorities (auto-sets)
├── logs/                # APPEND-ONLY JSONL
│   ├── events.jsonl       # Operational events
│   └── journal.jsonl      # Session history
├── tasks.md              # Discrete tasks with due dates
└── tasks-archive.md       # Completed tasks (>3 days old)
```

Key principle: Always-on vs on-demand is structural — different directories, explicit. `blocks/*.yaml` are loaded at every turn via `memory-loader.sh`. Everything else is read on demand.

### Create initial memory files

Create the blocks/ with initial content:

```bash
cat > blocks/identity.yaml << 'EOF'
name: User
role: (your role)
focus:
  - (current projects/goals)
preferences:
  - (your preferences)
timezone: America/Los_Angeles
EOF

cat > blocks/preferences.yaml << 'EOF'
communication:
  - (your communication preferences)
workflow:
  - (your workflow preferences)
timezone: America/Los_Angeles
EOF

cat > blocks/goals.yaml << 'EOF'
current_goals:
  - name: (goal name)
    status: (current status)
    next: (next action)
EOF

cat > blocks/patterns.yaml << 'EOF'
commitments:
  - name: (recurring commitment)
    schedule: (schedule)
    type: (type)
EOF
```

> Do not use `.pi/SYSTEM.md` for Alfred behavior — that's supplied by the `alfred-agent` repo and synced into `/alfred/.pi/` on every boot.
>
> The volume `/alfred` is Alfred's personal context: memory files, state files, project notes, tasks, and journal entries. Agent behavior is supplied by `alfred-agent` repo.

## 9. Optional integrations

### CalDAV (Apple Calendar)

Set `CALDAV_APP_PASSWORD` in Railway:

1. Go to [appleid.apple.com](https://appleid.apple.com) → **Sign-In and Security** → **App-Specific Passwords**
2. Generate a password for Alfred
3. Add as `CALDAV_APP_PASSWORD` in Railway
4. Add CalDAV settings to `/alfred/config.env`:

   ```env
   CALDAV_USERNAME=you@icloud.com
   CALDAV_SERVER_URL=https://caldav.icloud.com
   ```

The calendar extension uses `TIMEZONE` for display times and date interpretation. You can override with `CALDAV_TIMEZONE` if calendar needs a different zone.

When configured, Alfred can use `get_today_events`, `get_calendar_events`, and `get_upcoming` to read your schedule.

### Discord DM bridge

To talk to Alfred via Discord DMs:

1. Create an application at [Discord Developer Portal](https://discord.com/developers/applications)
2. Go to **Bot** → **Add Bot** → copy the token
3. Enable **Message Content Intent** (Privileged Gateway Intents)
4. Add the bot to a server (or use OAuth2 URL generator)
5. Set `DISCORD_BOT_TOKEN` in Railway
6. Set recipient user ID in `/alfred/config.env`:

   ```env
   DISCORD_PROACTIVE_USER_ID=your_discord_id
   ```

The bridge creates a Pi session on your first DM. Conversation persists across messages and container restarts.

Discord commands:
- `!new` - Reset interactive session context
- `!task <request>` - Run work in background and get a completion DM
- `!status` - List your recent task IDs and states
- `!status <taskId>` - Inspect one task

Discord preferences (DM policy, user IDs, timeouts) go in `/alfred/config.env`.

### Proactive check-ins

Set `PROACTIVE_ENABLED=1` in Railway to run three daily check-ins:

| Variable | Default | Description |
|----------|--------|-------------|
| `PROACTIVE_ENABLED` | `1` | Enable scheduled check-ins |
| `PROACTIVE_SCHEDULE` | `8:00,12:00,18:00` | When check-ins run (your `TIMEZONE`) |
| `PROACTIVE_MODEL` | `ALFRED_MODEL` | Override model for check-ins |
| `PROACTIVE_THINKING` | `off` | Enable model thinking |
| `PROACTIVE_POLL_SECS` | `300` | How often scheduler checks for triggers |
| `PROACTIVE_MAX_RETRIES` | `0` | How many times scheduler retries failures |

You also need `DISCORD_BOT_TOKEN` and a recipient user ID (`DISCORD_PROACTIVE_USER_ID` or `DISCORD_OWNER_USER_ID`) — the user must have **DMed the bot at least once** so Discord allows outbound DMs.

Default prompts are owned by `alfred-agent` and seeded into `/alfred/proactive/prompts/` when `PROMPT_VERSION` increases. To customize prompts, edit files directly in `/alfred/proactive/prompts/` — changes persist across restarts.

### Web search (Tavily)

Set `TAVILY_API_KEY` in Railway to give Alfred live web search.

Get a key at [tavily.com](https://www.tavily.com).

Default behavior is cost-conscious: basic search depth, small result set, optional deep page extraction only when needed.

## 10. Test Alfred

### Discord-only smoke test (no LLM)

Proves token + recipient + "you DM'd the bot":

```bash
"${PROACTIVE_ROOT:-/opt/proactive}/test-discord-dm.sh"
```

You should receive a short test DM. If this fails, fix env or Discord before debugging Pi.

### Full check-in (Discord + Pi + tools)

Same as scheduler runs:

```bash
cd /alfred
pi -p --no-session --model groq/llama-3.3-70b-versatile @proactive/prompts/morning.md
```

`-p --no-session` runs Pi without persistent session state (each check-in starts fresh but has access to `/alfred` files and tools).

### SSH session

```bash
tailscale ssh root@alfred
cd /alfred
pi
```

Talk to Alfred. When done, quit Pi with `Ctrl+C`.

### Memory loader test

Verify the memory loader works:

```bash
/alfred/memory-loader.sh
```

Should output formatted blocks as markdown:

```
=== BLOCKS (always-on context) ===

## Identity
```yaml
...
```
...
=== END BLOCKS ===
```

### Check file structure

```bash
cd /alfred
find . -maxdepth 2 -type d | sort
```

Should show:
- blocks/
- state/
- logs/
- proactive/
- tasks.md
- tasks-archive.md
- config.env

## 11. What's next

- [Configuration](configuration.md) — env var reference, timezone, GitHub memory syncing
- [SSH & Access](ssh-and-access.md) — SSH/SFTP/Tailscale details, kernel TUN vs userspace
- [Troubleshooting](troubleshooting.md) — Common issues and fixes
