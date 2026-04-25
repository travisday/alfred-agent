# Configuration

Reference for all Alfred environment variables and runtime settings. For initial setup, see [Setup](setup.md).

## Secrets vs. preferences

Alfred separates **secrets** (Railway env vars) from **preferences** (`/alfred/config.env` on the volume).

On boot, `start.sh` reads `/alfred/config.env` — a simple `KEY=VALUE` file. Railway env vars **always override** config.env values, so you can still set anything in Railway when needed. On first boot, a default config.env is generated with all lines commented out.

## Railway environment variables

Only secrets and infrastructure toggles belong in Railway. Set these in your Railway service settings:

| Variable | Required | Description |
|----------|----------|-------------|
| `TS_AUTHKEY` | **Yes** | Tailscale auth key for private network access |
| `RAILWAY_RUN_UID` | **Yes** | Set to `0` — required for volumes to mount correctly |
| `SSH_PASSWORD` | No | Root SSH password (default: `changeme`) |
| `GROQ_API_KEY` | At least one | Groq API key |
| `ANTHROPIC_API_KEY` | At least one | Anthropic API key |
| `OPENAI_API_KEY` | At least one | OpenAI API key |
| `GEMINI_API_KEY` | At least one | Google Gemini API key |
| `DISCORD_BOT_TOKEN` | Optional | Discord bot token — enables DM bridge |
| `CALDAV_APP_PASSWORD` | Optional | App-specific password for iCloud CalDAV |
| `TAVILY_API_KEY` | Optional | Enables Tavily-backed `web_search` tool |
| `GITHUB_TOKEN` | Optional | GitHub PAT — enables automatic push of memory repo |
| `TASK_WEBHOOK_SECRET` | Optional | Secret for signing task completion webhooks |
| `PROACTIVE_ENABLED` | No | Set to `1` to enable scheduled check-ins (easy on/off toggle) |

> You need **at least one** LLM API key. You can set multiple to switch between providers at runtime.
>
> All other preferences (timezone, schedule, Discord user IDs, timeouts, CalDAV server URL, etc.) go in `/alfred/config.env` on the volume. See the reference below.
>
> For the complete list of every environment variable (secrets + preferences + advanced), see [`.env.example`](../.env.example) in the repo root.

## `/alfred/config.env` reference

```env
# /alfred/config.env — Runtime preferences
# Edit this file to customize Alfred without redeploying.
# Platform env vars (Railway, Docker) always override these values.
# See .env.example in the repo for the complete variable reference.

# --- General ---
# TIMEZONE=America/Los_Angeles
# ALFRED_MODEL=                    # provider/model-id (e.g. anthropic/claude-sonnet-4-5-20250929)

# --- Proactive check-ins ---
# PROACTIVE_SCHEDULE=8:00,12:00,18:00
# PROACTIVE_MODEL=                 # Override model for check-ins (falls back to ALFRED_MODEL)
# PROACTIVE_THINKING=off
# PROACTIVE_POLL_SECS=300
# PROACTIVE_MAX_RETRIES=0

# --- Discord ---
# DISCORD_DM_POLICY=open           # open | owner_only | allowlist
# DISCORD_OWNER_USER_ID=
# DISCORD_PROACTIVE_USER_ID=
# DISCORD_ALLOWED_USER_IDS=
# DISCORD_PROMPT_TIMEOUT_MS=300000
# DISCORD_TASK_TIMEOUT_MS=1800000

# --- Sub-agent ---
# DELEGATE_TASK_TIMEOUT_MS=300000

# --- CalDAV (Apple Calendar) ---
# CALDAV_SERVER_URL=https://caldav.icloud.com
# CALDAV_USERNAME=
```

## Editing config.env

SSH in and edit the file directly:

```bash
tailscale ssh root@alfred
vi /alfred/config.env
```

Or via SSHFS (mount with `noappledouble` to prevent macOS `._*` resource fork files):

```bash
sshfs root@alfred:/alfred ~/alfred -o noappledouble,reconnect,follow_symlinks
```

Changes take effect on the next container restart.

## Timezone

Set `TIMEZONE` once and Alfred exports it as process-wide `TZ`; the proactive scheduler, Discord/Pi child processes, shell dates, and CalDAV calendar all use the same local day:

```env
TIMEZONE=America/New_York
```

The old per-subsystem vars (`PROACTIVE_TZ`, `CALDAV_TIMEZONE`) still work and override `TIMEZONE` for their subsystem if set. If `TIMEZONE` is absent but `PROACTIVE_TZ` is set, boot also exports `TZ=$PROACTIVE_TZ`.

## GitHub memory syncing

Alfred can automatically commit and push changes in the `/alfred` memory volume to a private GitHub repo. This gives you off-site backup and a full history of how your workspace evolves.

### What it does

The proactive scheduler runs `git add -A && git commit && git push` after each event:

- Check-ins (morning, midday, evening)
- Daily maintenance
- 2-hour maintenance ticks
- Weekly reviews

Each commit gets a descriptive message like `auto: check-in morning 2025-04-24T08:05` or `auto: daily maintenance 2025-04-24T07:58`.

### What gets tracked vs. gitignored

`start.sh` writes a `.gitignore` on every boot. Only your personal data is committed:

| Tracked | Gitignored |
|---------|------------|
| `memory/` | `.pi/` (synced from image on boot) |
| `projects/` | `proactive/` (synced from image on boot) |
| `tasks.md`, `tasks-archive.md` | `.tailscale/` |
| `state/today.md`, `state/active-context.md` | `state/proactive-*.log`, `state/proactive.lock` |
| `config.env` | `state/proactive-slots.state` |
| `reference/` | `state/task-sessions/`, `state/discord-tasks.json` |
| journal entries | `.DS_Store`, `._*` |

### Setting up GitHub push

1. **Create a private repo** on GitHub (e.g. `alfred-memory`)

2. **SSH into Alfred** and initialize the remote:

   ```bash
   tailscale ssh root@alfred
   cd /alfred
   git remote add origin https://github.com/youruser/alfred-memory.git
   git push -u origin main
   ```

   (The first push will fail without auth — that's expected. Continue to step 3.)

3. **Generate a GitHub Personal Access Token (PAT)**:
   - Go to [github.com/settings/tokens](https://github.com/settings/tokens) → **Generate new token (classic)**
   - Scope: `repo` (full control of private repos)
   - Copy the token

4. **Set `GITHUB_TOKEN` in Railway** as an environment variable

On the next boot, `start.sh` rewrites the remote URL to include the token:

```
https://github.com/user/repo.git
→ https://x-access-token:TOKEN@github.com/user/repo.git
```

The scheduler will then auto-push after every commit.

### Manual operations

You can commit and push manually at any time from an SSH session:

```bash
cd /alfred
git add -A && git commit -m "manual: snapshot"
git push origin main
```

### If push fails

The scheduler logs a warning (`WARNING: git push failed (will retry next cycle)`) and continues. The commit is still saved locally. Common causes:

- **Token expired or revoked** — regenerate the PAT and update `GITHUB_TOKEN` in Railway
- **Remote not configured** — run `git remote add origin <url>` in `/alfred`
- **Network issue** — transient; the next scheduler cycle retries automatically
- **Force-push needed** — if you reset the remote repo, SSH in and run `git push --force-with-lease origin main` once

## Rollback

Delete `/alfred/config.env` → system reverts to pure env-var behavior. No code changes needed.

## Complete variable reference

For every environment variable with defaults and descriptions, see [`.env.example`](../.env.example) in the repo root.
