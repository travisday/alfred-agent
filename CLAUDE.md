# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alfred Agent is a personal AI assistant deployed on Railway in Docker. It wraps the [Pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) with custom extensions, a Discord DM bridge, and a proactive scheduled check-in system. Access is via SSH over Tailscale or Discord DMs.

## Architecture

```
alfred-agent/
├── .pi/                      # Pi agent config
│   ├── SYSTEM.md             # Custom system prompt (replaces Pi default)
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
│   ├── run-checkin.sh        # Executes `pi -p` with prompt + model config
│   └── append-discord-mandatory.md
├── Dockerfile                # Multi-stage: Node 22, Tailscale, Pi, extensions, bridge
├── start.sh                  # Container entrypoint (Tailscale, SSH, bridge, scheduler)
└── config.env.template       # User preferences template (lives on /alfred volume)
```

**Runtime paths:** Container mounts `/alfred` volume for persistent state (`memory/`, `projects/`, `state/`, `.pi/sessions/`).

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

- **Env var hierarchy:** Railway env vars override `config.env` (on volume). Secrets stay in Railway; preferences go in `config.env`.
- **Extension auto-loading:** Pi discovers `.pi/extensions/` automatically. Each extension conditionally activates based on env vars (e.g., CalDAV needs `CALDAV_USERNAME` + `CALDAV_APP_PASSWORD`).
- **Discord sessions:** One persistent Pi session per Discord user, stored at `/alfred/.pi/sessions/discord/<user-id>`. Sessions recover on bridge restart.
- **Message streaming:** Chunks to 1900 chars (Discord limit), 400-char buffer with 2.5s debounce. Long operations show "thinking..." reassurance every 60s.
- **Proactive flow:** scheduler.sh → run-checkin.sh → `pi -p @prompt.md` → must call `send_discord_message` tool → logs to `/alfred/state/`.
- **TypeScript:** ES2022 target, ES modules, strict mode. Tool parameter schemas use `@sinclair/typebox`.
- **Timezone:** IANA zones throughout. `TIMEZONE` unifies proactive + CalDAV with per-subsystem fallbacks.

## Required Environment Variables

- `TS_AUTHKEY` (Tailscale), `RAILWAY_RUN_UID=0`
- At least one LLM key: `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`
- Optional: `DISCORD_BOT_TOKEN`, `CALDAV_APP_PASSWORD`, `TAVILY_API_KEY`, `PROACTIVE_ENABLED=1`
