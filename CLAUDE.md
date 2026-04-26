# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alfred Agent is a self-hosted AI assistant. It wraps [Pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) with custom extensions and a Discord DM bridge. Access is via SSH over Tailscale or Discord DMs.

## Architecture

```
alfred-agent/
├── .pi/                      # Pi agent config (synced to /root/.pi/agent on boot, not /alfred)
│   ├── SYSTEM.md             # Complete agent behavior spec (voice, memory, operating loop)
│   └── extensions/           # Auto-loaded Pi extension modules
│       ├── caldav/           # Apple Calendar via iCloud CalDAV
│       ├── discord-notify/   # Discord DM sender (REST API)
│       ├── web-search/       # Tavily web search
│       └── subagent/         # Long-running task delegation
├── discord-bridge/           # Discord bot (Gateway + Pi session mgmt)
│   └── src/
│       ├── index.ts          # Main bridge: session lifecycle, message streaming, DM policy, !new
│       └── resourceLoader.ts # Prepends blocks/ via memory-loader
├── Dockerfile                # Node 22, Tailscale, Pi, extensions, bridge
├── start.sh                  # Container entrypoint (Tailscale, SSH, bridge)
├── memory-loader.sh          # Loads blocks/ as always-on context for Pi
├── .env.example              # Complete deployer reference (all env vars)
└── config.env.template       # User preferences template (lives on /alfred volume)
```

**Runtime paths:** Container mounts `/alfred` volume for **personal data only** (`blocks/`, `state/`, `logs/`, optional `skills/`, `config.yaml`). Agent behavior lives in **repo** `.pi/` → synced to **`/root/.pi/agent/`** (Pi **agentDir**). **`cwd`** for Pi is `/alfred`.

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
cd discord-bridge && npm test                        # runs build (no unit tests)
```

**Extensions:** Each has its own `npm install` (caldav, discord-notify). Web-search and subagent have no build step.

**Docker:**
```bash
docker build -t alfred-agent .
```

## Key Patterns

- **Volume is personal data only:** `/alfred` contains blocks/, state/, logs/, optional skills/, `config.yaml` — user's data. Discrete work lives in `blocks/goals.yaml` (and related YAML), not a separate `tasks.md`. Agent behavior (voice, operating loop, memory rules) lives in `.pi/SYSTEM.md` in the repo, synced to the container on every boot. Git tracks only personal data — `.tailscale/` and legacy operational paths are gitignored (`.gitignore` is written by `start.sh` on every boot).
- **Sessions:** Pi stores Discord DM transcripts under **`~/.pi/agent/sessions/--alfred--/`** by default (same as stock Pi for `cwd=/alfred`). Optional **`ALFRED_PI_SESSION_DIR`** overrides that path. `!new` clears the interactive session directory.
- **Env var hierarchy:** Railway env vars override `config.env` (on volume). Secrets stay in Railway; preferences go in `config.env`.
- **Extension auto-loading:** Pi discovers `.pi/extensions/` automatically. Each extension conditionally activates based on env vars (e.g., CalDAV needs `CALDAV_USERNAME` + `CALDAV_APP_PASSWORD`).
- **Discord:** Use `!new` to reset the DM session — Discord intercepts `/` as slash commands. Each DM refreshes **`blocks/`** via `memory-loader.sh` in the system prompt.
- **Message streaming:** Chunks to 1900 chars (Discord limit). Long operations show typing reassurance every 60s.
- **TypeScript:** ES2022 target, ES modules, strict mode. Tool parameter schemas use `@sinclair/typebox`.
- **Timezone:** IANA zones throughout. `TIMEZONE` unifies CalDAV with shell `TZ`.
- **Memory loading:** `/opt/memory-loader.sh` outputs `blocks/*.yaml` as markdown. The bridge prepends it per invocation; `start.sh` writes **`/root/.pi/agent/APPEND_SYSTEM.md`** on boot so SSH `pi` picks up `blocks/` at session start (Pi loads it from **agentDir**). Image **SYSTEM/extensions** sync to **`/root/.pi/agent/`**, not `/alfred/.pi`.
- **Events:** Optional **`ALFRED_EVENT_FILE`** (default `/root/.pi/agent/events.jsonl`) for discord-notify introspection logging.

## Required Environment Variables

- `TS_AUTHKEY` (Tailscale), `RAILWAY_RUN_UID=0`
- At least one LLM key: `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`
- Optional: `DISCORD_BOT_TOKEN`, `CALDAV_APP_PASSWORD`, `TAVILY_API_KEY`
