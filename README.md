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

Discord commands:

- `/new` - reset interactive session context.
- `/task <request>` - run work in background and get a completion DM when done.
- `/status` - list your most recent task IDs and states.
- `/status <taskId>` - inspect one task.

Background tasks are explicit-first (`/task`), with optional automatic fallback for obviously long-running requests.

### 4. Web Search (optional — Tavily)

To give Alfred live web search with source-backed results, set:

| Variable | Description |
|----------|-------------|
| `TAVILY_API_KEY` | Tavily API key for Alfred's `web_search` tool |

Get a key at [tavily.com](https://www.tavily.com/), then set `TAVILY_API_KEY` in Railway.

Default behavior is cost-conscious:
- basic search depth
- small result set
- optional deep page extraction only when needed

### 5. LLM Provider API Key

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
| `TAVILY_API_KEY` | Optional | Enables Tavily-backed `web_search` tool |
| `DISCORD_BOT_TOKEN` | Optional | Discord bot token — enables DM bridge |
| `DISCORD_PROMPT_TIMEOUT_MS` | No | Max time per request in ms (default: 300000 = 5 min) |
| `DISCORD_TASK_TIMEOUT_MS` | No | Max runtime for background `/task` jobs in ms (default: 1800000 = 30 min) |
| `DISCORD_DM_POLICY` | No | DM access policy: `open`, `owner_only`, or `allowlist` (default: `open`) |
| `DISCORD_OWNER_USER_ID` | No | Required when `DISCORD_DM_POLICY=owner_only` |
| `DISCORD_ALLOWED_USER_IDS` | No | Comma-separated Discord user IDs for `allowlist` mode |
| `TASK_WEBHOOK_SECRET` | Optional | Secret for signing task completion webhooks (enables \"your task is done\" notifications in Discord) |
| `TASK_WEBHOOK_PORT` | No | Port for the internal webhook HTTP server (default: 8080) |
| `TASK_WEBHOOK_BASE_URL` | No | Internal callback base URL for background workers (default: `http://127.0.0.1:$TASK_WEBHOOK_PORT`) |
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
tailscale ssh root@alfred
```

(On Railway, plain `ssh` to the Tailnet IP often times out; see [SSH, SFTP, and file access](#ssh-sftp-and-file-access).)

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

**Railway (default):** Plain `ssh` / `sftp` to Alfred’s Tailscale IP on port 22 often **times out** because Tailscale runs in **userspace** mode (Railway does not provide `/dev/net/tun` or `NET_ADMIN`). Use the **Tailscale CLI** after the [Tailscale app](https://tailscale.com/download) is running on your device:

```bash
tailscale ssh root@alfred
```

Then `cd /alfred && pi`. See [SSH, SFTP, and file access](#ssh-sftp-and-file-access) for SFTP and optional native SSH.

**Via Discord (if `DISCORD_BOT_TOKEN` is set):** DM the bot — no SSH needed. Same workspace and session as SSH.

For long work from Discord, prefer `/task ...` so Alfred can continue responding to other DMs while your task runs.

### From Your Phone

1. Install [Tailscale](https://tailscale.com) on your phone and sign into the same account
2. Install a terminal app:
   - **[Moshi](https://apps.apple.com/app/moshi-ai-terminal/id6504464458)** — built for AI agents, push notifications, voice input, mosh support
   - **[Blink Shell](https://blink.sh)** — open source, mature, excellent mosh support
   - **Termius** — cross-platform, SSH/mosh/SFTP
3. Connect with **`tailscale ssh root@alfred`** when plain `ssh` to the Tailnet IP does not work (typical on Railway); or `mosh` if your client supports it with the same transport your setup uses
4. Run Pi: `cd /alfred && pi`

## SSH, SFTP, and file access

### Why `ssh root@100.x` or SFTP can time out (Railway)

Startup picks **kernel TUN** only if **`/dev/net/tun`** exists in the container (unusual on Railway). Otherwise it uses **userspace** Tailscale. In userspace mode, **inbound TCP to the Tailscale address on port 22** usually does **not** reach OpenSSH, so generic clients that open `sftp://` or `ssh` to `100.x.x.x:22` may hang or time out. **Railway does not provide `/dev/net/tun` or `NET_ADMIN`**, so Alfred almost always runs userspace there. Community discussion: [Railway Help Station](https://station.railway.com) (search for TUN / privileged).

**On Railway, use:**

- **Shell:** `tailscale ssh root@alfred` (Tailscale app running on your Mac/PC/phone).
- **Files:** Prefer editing through that shell, sync tools, or SFTP with a client that can use **`tailscale ssh` as the SSH program** (or `ProxyCommand`; see [Tailscale SSH](https://tailscale.com/kb/1193/tailscale-ssh)).

### Native SSH and SFTP to `/alfred` (self-hosted / VPS with TUN)

If you run this image on a host that provides **`/dev/net/tun`** and **`CAP_NET_ADMIN`** (typical Docker flags: `--device /dev/net/tun --cap-add=NET_ADMIN`, or privileged on a VPS), startup **automatically** uses kernel TUN — check deploy logs for `Tailscale: kernel TUN`.

Then from a device on your tailnet, **verify** (replace the IP with Alfred’s Tailscale IP from `tailscale status` or the admin console):

```bash
ssh root@100.x.x.x
# password: value of SSH_PASSWORD in your env

sftp root@100.x.x.x
sftp> cd /alfred
sftp> ls
```

Mount the folder with **Cyberduck**, **Transmit**, **sshfs**, or your editor using **SFTP/SSH**, user **`root`**, password **`SSH_PASSWORD`**, remote path **`/alfred`**.

Use a **strong `SSH_PASSWORD`**; your tailnet ACLs still matter.

### Manual checklist (kernel TUN mode only)

When deploy logs show **`Tailscale: kernel TUN`** and Tailscale is up:

| Step | Command / action |
|------|------------------|
| 1 | `tailscale status` on your laptop — `alfred` online |
| 2 | `ssh root@<alfred-tailscale-ip>` — login with `SSH_PASSWORD` |
| 3 | `sftp root@<ip>` — `cd /alfred`, list files |
| 4 | Optional: Cyberduck / sshfs to same host, path `/alfred` |

---

## Daily Usage

1. Open your terminal app (Tailscale running on your device)
2. `tailscale ssh root@alfred` (or native `ssh root@<tailscale-ip>` if you use kernel TUN — see [SSH, SFTP, and file access](#ssh-sftp-and-file-access))
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
- Use `mosh` if your setup supports it for more stable mobile connections
- Make sure your terminal app supports mosh

**`ssh` / `sftp` to Alfred’s Tailscale IP times out**
- On **Railway**, there is usually **no `/dev/net/tun`**, so Tailscale runs in **userspace**; plain TCP to `100.x.x.x:22` does not reach `sshd`. Use **`tailscale ssh root@alfred`**. For native SFTP, run Alfred on a host that exposes **`/dev/net/tun`** + **`NET_ADMIN`** so logs show **`Tailscale: kernel TUN`** (see [SSH, SFTP, and file access](#ssh-sftp-and-file-access)).

**`-bash: export: ... not a valid identifier` when logging in**
- Usually fixed in current `start.sh` (safe quoting for Railway env). Redeploy; if it persists, check for unusual env var names in Railway.

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

**Discord task finished but no completion DM**
- Set `TASK_WEBHOOK_SECRET` so signed task callbacks and completion notifications are enabled
- Check logs for `Task completion webhook listening` and `Invalid callback token/signature` messages
- If DM access is restricted, verify `DISCORD_DM_POLICY` and user IDs are configured correctly

---

## License

MIT
