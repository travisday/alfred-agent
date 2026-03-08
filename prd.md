# Alfred: Deploy Pi Agent on Railway with Tailscale

A guide to hosting your personal AI assistant (Pi agent + Groq) on Railway so you can access it from any device — including your phone.

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
│  │     markdown files, memory, projects│ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
        │ Tailscale private network
        ▼
  ┌───────────┐
  │  iPhone   │   ssh alfred
  │  (Moshi)  │   cd /alfred && pi
  └───────────┘
```

- **Pi agent** runs on-demand (not 24/7) — state lives in markdown files
- **Groq API** handles inference (no GPU needed on the server)
- **Tailscale** provides secure private access — no ports exposed to the internet
- **Railway volume** persists your markdown files across container restarts

---

## Prerequisites

- [Railway](https://railway.com) account (Pro plan for volumes)
- [Tailscale](https://tailscale.com) account (free for personal use)
- [Groq](https://console.groq.com) API key
- iPhone with a terminal app (Moshi or Blink Shell)

---

## Step 1: Generate a Tailscale Auth Key

1. Go to the [Tailscale admin console](https://login.tailscale.com/admin/settings/keys)
2. Click **Generate auth key**
3. Settings:
   - **Reusable**: Yes
   - **Ephemeral**: No (you want this node to persist)
   - **Tags**: optional, e.g. `tag:server`
4. Copy and save the key — you'll need it for Railway

---

## Step 2: Install Tailscale on Your Phone

1. Download the **Tailscale** app from the App Store
2. Sign in with the same account you used to generate the key
3. Your phone is now on your tailnet

---

## Step 3: Create Project Files

Create a new directory for your Railway project with three files:

### `Dockerfile`

```dockerfile
FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    openssh-server \
    mosh \
    vim \
    && rm -rf /var/lib/apt/lists/*

# Install Tailscale
RUN curl -fsSL https://tailscale.com/install.sh | sh

# Install pi coding agent globally
RUN npm install -g @mariozechner/pi-coding-agent

# Setup SSH server
RUN mkdir /var/run/sshd
RUN echo 'root:changethispassword' | chpasswd
RUN sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config

# Create workspace directory (will be mounted as a volume)
RUN mkdir -p /alfred

WORKDIR /alfred

# Copy and set up start script
COPY start.sh /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]
```

> **Note:** Change `changethispassword` to a real password. This is a fallback — Tailscale SSH handles auth automatically so you won't typically need it.

### `start.sh`

```bash
#!/bin/bash
set -e

# Start Tailscale daemon
tailscaled --state=/var/lib/tailscale/tailscaled.state &
sleep 2

# Authenticate and join tailnet
tailscale up --authkey=${TS_AUTHKEY} --hostname=alfred --ssh

# Start SSH server (needed for mosh connections)
/usr/sbin/sshd

echo "==============================="
echo " Alfred is online."
echo " Connect via: ssh alfred"
echo "==============================="

# Keep container alive
tail -f /dev/null
```

### `.gitignore`

```
node_modules/
.env
```

---

## Step 4: Deploy on Railway

### Create the project

1. Push your Dockerfile + start.sh to a GitHub repo, or use Railway CLI
2. In Railway, create a **New Project** → **Deploy from GitHub repo**
3. Railway will auto-detect the Dockerfile and build it

### Add volumes

Create **two volumes** and attach them to your service:

| Volume | Mount Path | Purpose |
|--------|-----------|---------|
| `alfred-data` | `/alfred` | Your markdown files, memory, projects |
| `tailscale-state` | `/var/lib/tailscale` | Persists Tailscale auth across restarts |

> **Important:** Volumes are only mounted at runtime, not build time. Don't write persistent data during the Docker build step.

### Set environment variables

In your Railway service settings, add:

| Variable | Value |
|----------|-------|
| `TS_AUTHKEY` | Your Tailscale auth key from Step 1 |
| `GROQ_API_KEY` | Your Groq API key |
| `RAILWAY_RUN_UID` | `0` (required — volumes mount as root) |

### Deploy

Hit deploy. Once it's running, check your Tailscale admin console — you should see a node called **alfred** appear in your device list.

---

## Step 5: Install a Terminal App on Your Phone

### Recommended: Moshi

- Purpose-built for interacting with AI agents from mobile
- Push notifications when the agent needs input (works on Apple Watch too)
- Built-in voice input via on-device Whisper (great for natural language prompts)
- Native mosh support for stable mobile connections

### Alternative: Blink Shell

- Open source, mature, excellent mosh support
- No push notifications or voice input
- Better if you prefer a traditional terminal experience

### Alternative: Termius

- Cross-platform sync, supports SSH/mosh/SFTP
- Free tier available
- More general-purpose

---

## Step 6: Connect and Set Up Alfred

### First connection

From your phone (or laptop), connect via Tailscale SSH:

```bash
ssh alfred
```

Tailscale handles authentication automatically — no SSH keys to manage.

### Set up your workspace

```bash
cd /alfred

# Create your directory structure
mkdir -p projects memory

# Create an initial AGENTS.md for Alfred's personality/instructions
cat > AGENTS.md << 'EOF'
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

### Configure Pi agent for Groq

```bash
mkdir -p ~/.pi/agent

# Set up custom model config for Groq
cat > ~/.pi/agent/models.json << 'EOF'
{
  "providers": {
    "groq": {
      "apiKey": "env:GROQ_API_KEY"
    }
  }
}
EOF
```

### Run Alfred

```bash
cd /alfred
pi
```

Once Pi starts, use `/model` to select your Groq model (e.g. `qwen/qwen3-32b` or `llama-3.3-70b-versatile`).

That's it. You're talking to Alfred from your phone.

---

## Step 7: Optional — Git Backup for Alfred's Memory

Your markdown files persist on the Railway volume, but volumes aren't backed up. Set up a simple git backup:

```bash
cd /alfred
git init
git add -A
git commit -m "initial alfred state"

# Add a private remote
git remote add origin git@github.com:youruser/alfred-brain.git
git push -u origin main
```

You can set up a cron job for daily auto-commits, or just commit manually when you've made changes you want to preserve:

```bash
cd /alfred && git add -A && git commit -m "backup $(date +%Y-%m-%d)" && git push
```

---

## Daily Usage

The workflow is simple:

1. Open Moshi (or your terminal app) on your phone
2. `ssh alfred`
3. `cd /alfred && pi`
4. Talk to Alfred — he reads your markdown files for context
5. When done, just quit Pi. State is saved in the files.
6. Next time you connect, Alfred picks up right where you left off

---

## Cost Estimate

| Service | Cost |
|---------|------|
| Railway (container + 2 volumes) | ~$5-10/mo depending on uptime |
| Groq API | Pay-per-token, very cheap for chat |
| Tailscale | Free for personal use |
| Moshi app | One-time purchase (~$10) |
| **Total** | **~$5-15/mo** |

> **Tip:** Since Alfred doesn't need to run 24/7, you could stop the Railway service when not in use to save on compute costs. The volumes persist regardless. You'd just need to restart the service before connecting.

---

## Troubleshooting

**Can't see `alfred` in Tailscale admin console**
- Check Railway logs for Tailscale auth errors
- Make sure `TS_AUTHKEY` is set correctly
- The key may have expired — generate a new one

**SSH connection drops on phone**
- Use mosh instead of SSH for more stable mobile connections: `mosh alfred`
- Make sure your terminal app supports mosh (Moshi and Blink both do)

**Pi agent can't find Groq models**
- Verify `GROQ_API_KEY` is set in Railway env vars
- Check `~/.pi/agent/models.json` is configured correctly
- Try running `pi` with `--debug` for more info

**Volume data disappeared**
- Railway volumes persist across restarts but not across project deletions
- Set up git backup (Step 7) as insurance

**Railway container keeps restarting**
- Check that `start.sh` has the `tail -f /dev/null` at the end
- Verify the Dockerfile `CMD` points to the right script