# Alfred Agent

Deploy your own personal AI assistant on [Railway](https://railway.com) — accessible from any device via [Tailscale](https://tailscale.com) SSH. Built on top of the [Pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) with a custom system prompt tailored for a personal executive assistant workflow.

## Architecture

```
┌─────────────────────────────────────────┐
│           Railway Container             │
│                                         │
│  ┌─────────┐  ┌──────────┐  ┌────────┐ │
│  │ Pi Agent │  │Tailscale │  │  SSH   │ │
│  │ (Alfred) │  │  (VPN)   │  │ Server │ │
│  └────┬─────┘  └────┬─────┘  └───┬────┘ │
│       │              │            │      │
│  ┌────┴──────────────┴────────────┴────┐ │
│  │     /alfred (persistent volume)     │ │
│  │     markdown files, memory, state   │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
        │ Tailscale private network
        ▼
  ┌───────────┐
  │  Any      │   ssh alfred
  │  Device   │   cd /alfred && pi
  └───────────┘
```

Optional: With `DISCORD_BOT_TOKEN` set, a Discord bridge runs in the same container. DM the bot to talk to Alfred from Discord — same workspace, same session, no SSH needed.

- **Pi agent** runs on-demand — state lives in markdown files on a persistent volume
- **LLM inference** is handled by your chosen provider's API (no GPU needed on the server)
- **Tailscale** provides secure private networking — no ports exposed to the internet
- **Railway volume** persists your workspace across container restarts

---

## Required API Keys

You need two things to deploy Alfred. Both are set as **environment variables** in your Railway service.

### 1. Tailscale Auth Key (`TS_AUTHKEY`)

Used to connect the Railway container to your private Tailscale network so you can SSH in from any device.

1. Create a free account at [tailscale.com](https://tailscale.com)
2. Go to the [Tailscale admin console → Keys](https://login.tailscale.com/admin/settings/keys)
3. Click **Generate auth key**
4. Settings:
   - **Reusable**: Yes
   - **Ephemeral**: No (the node should persist across container restarts)
   - **Expiration**: Set to your preference (you'll need to regenerate when it expires)
5. Copy the key — this becomes your `TS_AUTHKEY` env var

### 2. CalDAV (optional — Apple Calendar)

To enable Alfred to read your Apple Calendar, set:

| Variable | Description |
|----------|-------------|
| `CALDAV_USERNAME` | Your Apple ID (e.g. `you@icloud.com`) |
| `CALDAV_APP_PASSWORD` | [App-specific password](https://support.apple.com/en-us/HT204397) (required for iCloud) |

Optional:

| Variable | Description |
|----------|-------------|
| `CALDAV_SERVER_URL` | Default: `https://caldav.icloud.com` |
| `CALDAV_TIMEZONE` | Default: `America/Los_Angeles` |

When configured, Alfred can use `get_today_events`, `get_calendar_events`, and `get_upcoming` to read your schedule.

### 3. Discord (optional)

To talk to Alfred via Discord DMs, set `DISCORD_BOT_TOKEN`:

1. Create an application at [Discord Developer Portal](https://discord.com/developers/applications)
2. Go to **Bot** → **Add Bot** → copy the token
3. Enable **Message Content Intent** (Privileged Gateway Intents)
4. Add the bot to a server (or use the DM link from the OAuth2 URL generator)
5. Set `DISCORD_BOT_TOKEN` in Railway

The bridge creates the Pi session on your first DM (agent on-demand). Conversation persists across messages and container restarts.

### 4. LLM Provider API Key

Alfred uses the [Pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) under the hood, which supports multiple LLM providers. You need an API key for at least one.

The `start.sh` script automatically detects whichever API keys you set and configures Pi accordingly. You can set one or multiple — just add the env var(s) for your preferred provider(s):

| Provider | Env Variable | Get a Key |
|----------|-------------|-----------|
| Groq | `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) |
| Anthropic | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| OpenAI | `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) |
| Google Gemini | `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) |

> **Tip:** You can set multiple provider keys at once. The startup script builds `auth.json` with all detected providers, so you can switch between models at runtime using Pi's `/model` command.

---

## Environment Variables Summary

Set these in your Railway service settings:

| Variable | Required | Description |
|----------|----------|-------------|
| `TS_AUTHKEY` | **Yes** | Tailscale auth key for private network access |
| `CALDAV_USERNAME` | Optional | Apple ID for iCloud CalDAV |
| `CALDAV_APP_PASSWORD` | Optional | App-specific password for iCloud |
| `GROQ_API_KEY` | At least one | Groq API key |
| `ANTHROPIC_API_KEY` | At least one | Anthropic API key |
| `OPENAI_API_KEY` | At least one | OpenAI API key |
| `GEMINI_API_KEY` | At least one | Google Gemini API key |
| `DISCORD_BOT_TOKEN` | Optional | Discord bot token — enables DM bridge |
| `DISCORD_PROMPT_TIMEOUT_MS` | No | Max time per request in ms (default: 300000 = 5 min) |
| `TASK_WEBHOOK_SECRET` | Optional | Secret for signing task completion webhooks (enables \"your task is done\" notifications in Discord) |
| `TASK_WEBHOOK_PORT` | No | Port for the internal webhook HTTP server (default: 8080) |
| `SSH_PASSWORD` | No | Root SSH password fallback (default: `changeme`) |
| `RAILWAY_RUN_UID` | **Yes** | Set to `0` — required for volumes to mount correctly |

> You need **at least one** LLM API key. You can set multiple to switch between providers at runtime.

---

## Deployment

### 1. Clone this repo

```bash
git clone https://github.com/travisday/alfred-agent.git
cd alfred-agent
```

### 2. Deploy to Railway

1. Push to your own GitHub repo (or use Railway CLI)
2. In [Railway](https://railway.com), create a **New Project** → **Deploy from GitHub repo**
3. Railway auto-detects the Dockerfile and builds it

### 3. Add a volume

Create a volume and attach it to your service:

| Volume | Mount Path | Purpose |
|--------|-----------|---------|
| `alfred-data` | `/alfred` | Workspace files, memory, Tailscale state |

> Tailscale state is stored inside `/alfred/.tailscale/` so only one volume is needed.

### 4. Set environment variables

Add the variables from the table above in your Railway service settings.

### 5. Deploy

Hit deploy. Once running, check your [Tailscale admin console](https://login.tailscale.com/admin/machines) — a node called **alfred** should appear.

---

## Seeding Your Workspace

On first boot, the `/alfred` volume is empty. You'll want to set up a directory structure and an `AGENTS.md` file for Alfred to use as context.

### Connect to Alfred

```bash
ssh alfred
```

Tailscale SSH handles authentication automatically — no SSH keys needed.

### Create the directory structure

```bash
cd /alfred
mkdir -p projects memory
```

### Create an `AGENTS.md`

This is the file Pi reads from your workspace directory for project-level context. Create it with whatever instructions make sense for your workflow:

```bash
cat > /alfred/AGENTS.md << 'EOF'
# Alfred - Personal Assistant

You are Alfred, a personal assistant. You manage projects and memory
using markdown files and folders in this directory.

## Directory Structure
- `/alfred/projects/` - Active project folders, each with their own notes
- `/alfred/memory/` - Persistent memory and preferences

## Behavior
- When given a task, check memory/ for relevant context first
- Save important decisions and preferences to memory/
- Keep project notes organized in projects/<project-name>/
- Be concise and direct
EOF
```

You can edit `AGENTS.md` at any time — it's read by Pi on each prompt.

---

## Custom System Prompt

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

> **How it works:** Pi looks for `.pi/SYSTEM.md` in the working directory and uses it as the system prompt instead of its built-in default. The Dockerfile stages `.pi/` into the image, and `start.sh` copies it into `/alfred/.pi/` on every boot — so it's always available in the volume where you land via SSH. The CalDAV extension is auto-discovered from `.pi/extensions/` and registers `get_today_events`, `get_calendar_events`, and `get_upcoming` when `CALDAV_USERNAME` and `CALDAV_APP_PASSWORD` are set.

---

## Connecting to Alfred

**Via SSH (terminal):** `ssh alfred` then `cd /alfred && pi`

**Via Discord (if `DISCORD_BOT_TOKEN` is set):** DM the bot — no SSH needed. Same workspace and session as SSH.

### From Your Phone

1. Install [Tailscale](https://tailscale.com) on your phone and sign into the same account
2. Install a terminal app:
   - **[Moshi](https://apps.apple.com/app/moshi-ai-terminal/id6504464458)** — built for AI agents, push notifications, voice input, mosh support
   - **[Blink Shell](https://blink.sh)** — open source, mature, excellent mosh support
   - **Termius** — cross-platform, SSH/mosh/SFTP
3. Connect: `ssh alfred` (or `mosh alfred` for more stable mobile connections)
4. Run Pi: `cd /alfred && pi`

---

## Daily Usage

1. Open your terminal app
2. `ssh alfred`
3. `cd /alfred && pi`
4. Talk to Alfred — he reads your markdown files for context
5. When done, quit Pi (`Ctrl+C`). State is saved in the markdown files.
6. Next time you connect, Alfred picks up where you left off

---

## Cost Estimate

| Service | Cost |
|---------|------|
| Railway (container + volume) | ~$5–10/mo depending on uptime |
| LLM API (Groq, Anthropic, etc.) | Pay-per-token, varies by provider |
| Tailscale | Free for personal use |
| **Total** | **~$5–10/mo** |

> **Tip:** Alfred doesn't need to run 24/7. Stop the Railway service when not in use to save on compute — the volume persists regardless.

---

## Troubleshooting

**Alfred doesn't appear in Tailscale admin console**
- Check Railway deploy logs for Tailscale authentication errors
- Verify `TS_AUTHKEY` is set correctly in Railway env vars
- Auth keys expire — generate a new one if needed

**SSH connection drops on mobile**
- Use `mosh alfred` instead of `ssh alfred` for more stable mobile connections
- Make sure your terminal app supports mosh

**Pi can't find LLM models**
- Verify your API key env var is set in Railway
- Check that `start.sh` is writing `auth.json` for the correct provider
- SSH in and run `env | grep API` to confirm the var is available

**Volume data gone after redeploy**
- Railway volumes persist across restarts but **not** across project deletions
- Consider setting up git backup: `cd /alfred && git add -A && git commit -m "backup" && git push`

**Discord bot doesn't respond**
- Verify `DISCORD_BOT_TOKEN` is set in Railway
- Enable **Message Content Intent** in the Discord Developer Portal
- Check deploy logs for "Discord bridge started"

---

## License

MIT
