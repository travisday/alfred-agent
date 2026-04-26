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

**Runtime paths:** Container mounts `/alfred` volume for **personal data only** (`blocks/`, `state/`, `logs/`, `tasks.md`). Agent behavior lives in `.pi/SYSTEM.md` (repo-owned, synced from image on every boot). Sessions are ephemeral — cleaned up on boot (`.jsonl` files >2 days, task sessions >7 days).

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
├── logs/                # APPEND-ONLY JSONL
│   ├── events.jsonl       # Operational events
│   └── journal.jsonl      # Session history
├── tasks.md              # Discrete tasks
└── tasks-archive.md       # Completed tasks (>3 days old)
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

- **Volume is personal data only:** `/alfred` contains blocks/, state/, logs/, tasks.md — user's data. Agent behavior (voice, operating loop, memory rules) lives in `.pi/SYSTEM.md` in the repo, synced to the container on every boot. Git tracks only personal data — `.pi/`, `proactive/`, `.tailscale/`, and session state are all gitignored (`.gitignore` is written by `start.sh` on every boot).
- **Sessions are ephemeral:** Discord sessions and task sessions are disposable. `start.sh` cleans up `.jsonl` files >2 days old and task sessions >7 days old on boot. The `SessionManager.continueRecent()` creates a fresh session when no files exist.
- **Proactive check-ins are standalone:** Check-ins use `--no-session` — they read memory files per their prompt instructions without sharing the Discord DM session. No stale context bleed.
- **Prompt versioning:** Proactive prompts are version-gated via `/alfred/proactive/prompts/.version`. Bump `PROMPT_VERSION` in `start.sh` to re-seed all prompts on next boot.
- **Env var hierarchy:** Railway env vars override `config.env` (on volume). Secrets stay in Railway; preferences go in `config.env`.
- **Extension auto-loading:** Pi discovers `.pi/extensions/` automatically. Each extension conditionally activates based on env vars (e.g., CalDAV needs `CALDAV_USERNAME` + `CALDAV_APP_PASSWORD`).
- **Discord commands:** Use `!` prefix (`!new`, `!status`, `!task`) — Discord intercepts `/` as slash commands.
- **Message streaming:** Chunks to 1900 chars (Discord limit), 400-char buffer with 2.5s debounce. Long operations show "thinking..." reassurance every 60s.
- **Proactive flow:** scheduler.sh → `pi -p --no-session @prompt.md` → must call `send_discord_message` tool → logs to `/alfred/logs/events.jsonl`.
- **TypeScript:** ES2022 target, ES modules, strict mode. Tool parameter schemas use `@sinclair/typebox`.
- **Timezone:** IANA zones throughout. `TIMEZONE` unifies proactive + CalDAV with per-subsystem fallbacks.
- **Memory loading:** `memory-loader.sh` script outputs `blocks/*.yaml` as formatted markdown, prepended to every Pi invocation.

## Required Environment Variables

- `TS_AUTHKEY` (Tailscale), `RAILWAY_RUN_UID=0`
- At least one LLM key: `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`
- Optional: `DISCORD_BOT_TOKEN`, `CALDAV_APP_PASSWORD`, `TAVILY_API_KEY`, `PROACTIVE_ENABLED=1`
