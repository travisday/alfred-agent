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
| `GITHUB_TOKEN` | Optional | GitHub PAT — `start.sh` can rewrite `git remote` for authenticated push |

> You need **at least one** LLM API key. You can set multiple to switch between providers at runtime.
>
> All other preferences (timezone, schedule, Discord user IDs, timeouts, CalDAV server URL, etc.) go in `/alfred/config.env` on the volume. See reference below.
>
> For the complete list of every environment variable (secrets + preferences + advanced), see [`.env.example`](../.env.example) in the repo root.

## `/alfred/config.env` reference

See [`config.env.template`](../config.env.template) in the repo (copied to `/alfred/config.env` on first boot).

## Editing config.env

SSH in and edit the file directly:

```bash
tailscale ssh root@alfred
vi /alfred/config.env
```

Or via SSHFS (mount with `noappledouble` to prevent macOS `._*` resource fork files):

```bash
sshfs root@alfred:/alfred ~/alfred -onoappledouble,reconnect,follow_symlinks
```

Changes take effect on the next container restart.

## Timezone

Set `TIMEZONE` once and Alfred exports it as process-wide `TZ`; Discord/Pi child processes, shell dates, and CalDAV calendar use the same local day:

```env
TIMEZONE=America/New_York
```

You can override calendar display with `CALDAV_TIMEZONE` if needed.

## Memory system (separate repo: alfred-memory)

Alfred uses a structural memory system:

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
├── skills/              # Optional markdown skills
├── logs/                # APPEND-ONLY JSONL
│   ├── events.jsonl       # Operational events
│   ├── journal.jsonl      # Session history
│   └── chat-history.jsonl # Conversation transcript (optional)
└── config.yaml           # Local preferences template
```

Key principle: Always-on vs on-demand is structural — different directories, explicit. `blocks/*.yaml` are loaded at every turn via `memory-loader.sh`. Everything else is read on demand. Next actions and priorities live in **`blocks/goals.yaml`** (and related YAML), not `tasks.md`.

## GitHub memory syncing

Commit and push `/alfred` from SSH when you want off-site backup and history. With `GITHUB_TOKEN` set in Railway, `start.sh` rewrites `origin` to use the token so `git push` works non-interactively.

### What gets tracked vs. gitignored

`start.sh` writes a `.gitignore` on every boot. Only your personal data is committed:

| Tracked (personal data in git) | Gitignored by `start.sh` on `/alfred` |
|----------|------------|
| `blocks/`, `logs/`, `skills/`, `config.yaml`, and most files under `state/` | `.tailscale/` |
| Work items use **`blocks/goals.yaml`** (Open-STRiX), not root `tasks.md` | Legacy / empty paths: `state/proactive-slots.state`, `state/proactive-*.log`, `state/proactive.log`, `state/proactive.lock`, `state/task-sessions/`, `state/pi-session/`, `state/discord-tasks.json` (harness lives under **`/root/.pi/agent`**, not these) |
| | `.DS_Store`, `._*` |

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

### Manual operations

Commit and push from an SSH session:

```bash
cd /alfred
git add -A && git commit -m "manual: snapshot"
git push origin main
```

### If push fails

Common causes:

- **Token expired or revoked** — Regenerate PAT and update `GITHUB_TOKEN` in Railway
- **Remote not configured** — Run `git remote add origin <url>` in `/alfred`
- **Network issue** — Retry when connectivity returns
- **Force-push needed** — If you reset the remote repo, SSH in and run `git push --force-with-lease origin main` once

### Rollback

Delete `/alfred/config.env` → system reverts to pure env-var behavior. No code changes needed.

## Complete variable reference

For every environment variable with defaults and descriptions, see [`.env.example`](../.env.example) in the repo root.
