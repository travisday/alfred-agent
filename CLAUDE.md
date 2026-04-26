# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alfred Agent is a self-hosted AI assistant. It wraps [Pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) with custom extensions, a Discord DM bridge, and a proactive scheduled check-in system. Access is via SSH over Tailscale or Discord DMs.

## Architecture

```
alfred-agent/
├── .pi/                      # Pi agent config (synced to volume on every boot)
│   ├── SYSTEM.md             # Complete agent behavior spec (voice, memory, tasks, operating loop)
│   └── extensions/           # Auto-loaded Pi extension modules
│       ├── caldav/           # Apple Calendar via iCloud CalDAV
│       ├── discord-notify/   # Discord DM sender (REST API)
│       ├── web-search/       # Tavily web search
│       └── subagent/         # Long-running task delegation
├── discord-bridge/           # Discord bot (Gateway + Pi session mgmt)
│   └── src/
│       ├── index.ts          # Main bridge: session lifecycle, message streaming, DM policy
│       ├── tasks.ts          # Background task storage + webhook signing
│       └── workerClient.ts   # Task completion webhook client
├── proactive/                # Scheduled check-in system (morning/midday/evening)
│   ├── scheduler.sh          # Polls every 5min, runs check-ins at configured times
│   └── prompts/
│       ├── morning.md
│       ├── midday.md
│       ├── evening.md
│       ├── maintenance.md
│       └── weekly-review.md
├── Dockerfile                # Multi-stage: Node 22, Tailscale, Pi, extensions, bridge
├── start.sh                  # Container entrypoint (Tailscale, SSH, bridge, scheduler)
├── memory-loader.sh          # Loads blocks/ as always-on context for Pi
├── .env.example              # Complete deployer reference (all env vars)
└── config.env.template       # User preferences template (lives on /alfred volume)
```

**Runtime paths:** Container mounts `/alfred` volume for **personal data only** (`blocks/`, `state/`, `logs/`, optional `skills/`, `config.yaml`). Agent behavior lives in `.pi/SYSTEM.md` (repo-owned, synced from image on every boot). Sessions are ephemeral — cleaned up on boot (`.jsonl` files >2 days, task sessions >7 days).

## Memory System (separate repo: alfred-memory)

The memory system uses a structural separation inspired by open-strix:

```
alfred-memory/
├── blocks/              # ALWAYS-IN-PROMPT YAML
│   ├── identity.yaml      # Who the user is, current focus
│   ├── preferences.yaml    # Communication style, workflow
│   ├── goals.yaml         # Current goals and status
│   └── patterns.yaml      # Recurring commitments, habits
├── state/               # ON-DEMAND MARKDOWN
│   ├── projects/         # Project-specific content
│   ├── active-context.md   # Initiatives, session notes
│   └── today.md          # Daily priorities (auto-resets)
├── skills/              # Optional markdown skills (auto-discovered when present)
├── logs/                # APPEND-ONLY JSONL
│   ├── events.jsonl       # Operational events
│   ├── journal.jsonl      # Agent session log
│   └── chat-history.jsonl # Conversation transcript (optional)
└── config.yaml           # Local preferences template (secrets still in Railway)
```

**Key principle:** Always-on vs on-demand is structural — different directories, explicit. `blocks/*.yaml` are loaded at every turn via `memory-loader.sh`. Everything else is read on demand.

## Build & Development Commands

**Discord bridge (TypeScript):**
```bash
cd discord-bridge && npm install && npm run build   # compile src/ → dist/
cd discord-bridge && npm start                       # run compiled bridge
cd discord-bridge && npm test                        # Node test runner
```

**Extensions:** Each has its own `npm install` (caldav, discord-notify). Web-search and subagent have no build step.

**Docker:**
```bash
docker build -t alfred-agent .
```

## Key Patterns

- **Volume is personal data only:** `/alfred` contains blocks/, state/, logs/, optional skills/, `config.yaml` — user's data. Discrete work lives in `blocks/goals.yaml` (and related YAML), not a separate `tasks.md`. Agent behavior (voice, operating loop, memory rules) lives in `.pi/SYSTEM.md` in the repo, synced to the container on every boot. Git tracks only personal data — `.pi/`, `proactive/`, `.tailscale/`, and session state are all gitignored (`.gitignore` is written by `start.sh` on every boot).
- **Sessions are ephemeral:** Discord DMs use **`ALFRED_PI_SESSION_DIR`** (default `/alfred/state/pi-session`, gitignored) for Pi transcripts; `!new` clears that directory. `start.sh` still cleans `.jsonl` under `/alfred/.pi/sessions` >2 days old (legacy) and `state/task-sessions/` >7 days. Background `!task` sessions stay under `state/task-sessions/<id>`.
- **Proactive check-ins are standalone:** Check-ins use `--no-session` — they read memory files per their prompt instructions without sharing the Discord DM session. No stale context bleed.
- **Prompt versioning:** Proactive prompts are version-gated via `/alfred/proactive/prompts/.version`. Bump `PROMPT_VERSION` in `start.sh` to re-seed all prompts on next boot.
- **Env var hierarchy:** Railway env vars override `config.env` (on volume). Secrets stay in Railway; preferences go in `config.env`.
- **Extension auto-loading:** Pi discovers `.pi/extensions/` automatically. Each extension conditionally activates based on env vars (e.g., CalDAV needs `CALDAV_USERNAME` + `CALDAV_APP_PASSWORD`).
- **Discord commands:** Use `!` prefix (`!new`, `!status`, `!task`) — Discord intercepts `/` as slash commands. Each foreground DM refreshes **`blocks/`** via `memory-loader.sh` in the system prompt (same idea as proactive).
- **Message streaming:** Chunks to 1900 chars (Discord limit), 400-char buffer with 2.5s debounce. Long operations show "thinking..." reassurance every 60s.
- **Proactive flow:** scheduler.sh → `pi -p --no-session @prompt.md` → must call `send_discord_message` tool → scheduler appends operational events to `/alfred/state/events.jsonl` by default (`PROACTIVE_EVENT_FILE`).
- **TypeScript:** ES2022 target, ES modules, strict mode. Tool parameter schemas use `@sinclair/typebox`.
- **Timezone:** IANA zones throughout. `TIMEZONE` unifies proactive + CalDAV with per-subsystem fallbacks.
- **Memory loading:** `memory-loader.sh` outputs `blocks/*.yaml` as markdown. The bridge and proactive runs prepend it per invocation; `start.sh` also writes `/alfred/.pi/APPEND_SYSTEM.md` on boot so SSH `pi` picks up `blocks/` at session start (DefaultResourceLoader).

## Required Environment Variables

- `TS_AUTHKEY` (Tailscale), `RAILWAY_RUN_UID=0`
- At least one LLM key: `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`
- Optional: `DISCORD_BOT_TOKEN`, `CALDAV_APP_PASSWORD`, `TAVILY_API_KEY`, `PROACTIVE_ENABLED=1`
