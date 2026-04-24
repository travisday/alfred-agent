# Deployment

## 1. Clone this repo

```bash
git clone https://github.com/travisday/alfred-agent.git
cd alfred-agent
```

## 2. Deploy to Railway

1. Push to your own GitHub repo (or use Railway CLI)
2. In [Railway](https://railway.com), create a **New Project** → **Deploy from GitHub repo**
3. Railway auto-detects the Dockerfile and builds it

## 3. Add a volume

Create a volume and attach it to your service:

| Volume | Mount Path | Purpose |
|--------|-----------|---------|
| `alfred-data` | `/alfred` | Workspace files, memory, Tailscale state |

> Tailscale state is stored inside `/alfred/.tailscale/` so only one volume is needed.

## 4. Set environment variables

Add the variables from the [Railway Environment Variables](configuration.md#railway-environment-variables-secrets--infra) table in your Railway service settings.

## 5. Deploy

Hit deploy. Once running, check your [Tailscale admin console](https://login.tailscale.com/admin/machines) — a node called **alfred** should appear.

## Seeding Your Workspace

On first boot, the `/alfred` volume is empty. You'll want to set up a directory structure and an `AGENTS.md` file for Alfred to use as context.

### Connect to Alfred

```bash
tailscale ssh root@alfred
```

(On Railway, plain `ssh` to the Tailnet IP often times out; see [SSH, SFTP, and file access](ssh-and-access.md).)

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

> **How it works:** Pi looks for `.pi/SYSTEM.md` in the working directory and uses it as the system prompt instead of its built-in default. The Dockerfile stages `.pi/` into the image, and `start.sh` copies it into `/alfred/.pi/` on every boot — so it's always available in the volume where you land via SSH. Extensions under `.pi/extensions/` are auto-discovered (for example CalDAV calendar tools when CalDAV credentials are set; `web_search` when `TAVILY_API_KEY` is set; **`send_discord_message`** from `discord-notify` when `DISCORD_BOT_TOKEN` and a recipient user ID are available for proactive check-ins).

## Daily Usage

1. Open your terminal app (Tailscale running on your device)
2. `tailscale ssh root@alfred` (or native `ssh root@<tailscale-ip>` if you use kernel TUN — see [SSH, SFTP, and file access](ssh-and-access.md))
3. `cd /alfred && pi`
4. Talk to Alfred — he reads your markdown files for context
5. When done, quit Pi (`Ctrl+C`). State is saved in the markdown files.
6. Next time you connect, Alfred picks up where you left off
