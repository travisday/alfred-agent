# Configuration

Alfred separates **secrets** (Railway env vars) from **preferences** (`/alfred/config.env` on the volume).

## How it works

On boot, `start.sh` reads `/alfred/config.env` — a simple `KEY=VALUE` file. Railway env vars **always override** config.env values, so you can still set anything in Railway when needed. On first boot, a default config.env is generated with all lines commented out (identical behavior to today).

## Unified timezone

Set `TIMEZONE` once and both the proactive scheduler and CalDAV calendar use it:

```env
TIMEZONE=America/New_York
```

The old per-subsystem vars (`PROACTIVE_TZ`, `CALDAV_TIMEZONE`) still work and override `TIMEZONE` for their subsystem if set.

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

## `/alfred/config.env` reference

```env
# /alfred/config.env — Alfred preferences
# Railway env vars always override these values.
# Uncomment and edit any line to customize.

# --- Timezone (IANA) ---
# TIMEZONE=America/Los_Angeles

# --- Proactive check-ins ---
# PROACTIVE_SCHEDULE=8:00,12:00,18:00
# PROACTIVE_MODEL=groq/openai/gpt-oss-20b
# PROACTIVE_THINKING=off
# PROACTIVE_POLL_SECS=300

# --- Discord ---
# DISCORD_DM_POLICY=open
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

# --- Proactive root (set when you move prompts to the volume) ---
# PROACTIVE_ROOT=/opt/proactive
```

## Rollback

Delete `/alfred/config.env` → system reverts to pure env-var behavior. No code changes needed.

## Railway Environment Variables (Secrets & Infra)

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
| `TASK_WEBHOOK_SECRET` | Optional | Secret for signing task completion webhooks |
| `PROACTIVE_ENABLED` | No | Set to `1` to enable scheduled check-ins (easy on/off toggle) |

> You need **at least one** LLM API key. You can set multiple to switch between providers at runtime.
>
> All other preferences (timezone, schedule, Discord user IDs, timeouts, CalDAV server URL, etc.) go in `/alfred/config.env` on the volume. See the reference above.
