# Alfred

A personal AI assistant that lives on a server — accessible from any device via SSH, Discord, or your phone. Built on the [Pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent), deployed on [Railway](https://railway.com), and connected through [Tailscale](https://tailscale.com).

## What it does

Alfred is a self-hosted executive assistant that runs 24/7 in a Docker container. You SSH in (or DM a Discord bot) and interact with an LLM agent that has persistent memory, calendar access, web search, and scheduled check-ins — all stored on a single volume as plain markdown files. `alfred-agent` is the harness; the separate `alfred-memory` repo is the context checkout mounted at `/alfred`.

## Features

- **Persistent memory** — context lives in markdown files on a volume, survives restarts, and grows over time
- **Multi-provider LLM** — swap between Groq, Anthropic, OpenAI, and Gemini at runtime
- **Discord bridge** — DM the bot for the same experience as SSH, with `/task` for background work
- **Proactive check-ins** — scheduled morning, midday, and evening summaries delivered via Discord DM
- **Apple Calendar** — read your iCloud calendar with CalDAV (today's events, upcoming, date ranges)
- **Web search** — live Tavily-powered search with cost-conscious defaults
- **Sub-agent delegation** — offload long-running tasks to keep the main session responsive
- **Phone access** — connect from iOS/Android via Tailscale + any terminal app
- **Custom system prompt** — fully editable persona and behavior via `.pi/SYSTEM.md`

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Railway Container                        │
│                                                              │
│  ┌──────────────┐  ┌───────────────┐  ┌───────────────────┐ │
│  │   Pi Agent   │  │    Discord    │  │    Proactive      │ │
│  │   (Alfred)   │  │    Bridge     │  │    Scheduler      │ │
│  │              │  │  DMs ↔ Agent  │  │  morning/mid/eve  │ │
│  └──────┬───────┘  └───────┬───────┘  └────────┬──────────┘ │
│         │                  │                   │            │
│  ┌──────┴──────────────────┴───────────────────┴──────────┐ │
│  │              .pi/extensions/                           │ │
│  │  caldav · discord-notify · web-search · subagent       │ │
│  └────────────────────────┬───────────────────────────────┘ │
│                           │                                 │
│  ┌────────────────────────┴───────────────────────────────┐ │
│  │           /alfred (persistent memory repo)             │ │
│  │     memory/ · projects/ · state/ · tasks.md            │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌──────────┐  ┌────────┐                                   │
│  │Tailscale │  │  SSH   │                                   │
│  │  (VPN)   │  │ Server │                                   │
│  └────┬─────┘  └───┬────┘                                   │
└───────┼─────────────┼────────────────────────────────────────┘
        │ Tailscale private network
        ▼
  ┌───────────┐    ┌─────────┐
  │ SSH from  │    │ Discord │
  │ any device│    │   DMs   │
  └───────────┘    └─────────┘
```

## How it works

Alfred runs the Pi agent on-demand inside the container. State is plain markdown files in `/alfred` — no database. LLM inference is handled by your provider's API (no GPU needed). Tailscale provides a private encrypted network so nothing is exposed to the public internet. Extensions are auto-discovered from `.pi/extensions/` and activate based on which env vars are set.

## Extensions

| Extension | Tools | Description |
|-----------|-------|-------------|
| **caldav** | `get_today_events`, `get_calendar_events`, `get_upcoming` | Read Apple Calendar via iCloud CalDAV |
| **discord-notify** | `send_discord_message` | Send Discord DMs (used by proactive check-ins) |
| **web-search** | `web_search` | Live web search via Tavily API |
| **subagent** | `delegate_task` | Offload long tasks to a background agent |

## Proactive check-ins

With `PROACTIVE_ENABLED=1`, Alfred runs three daily check-ins at configurable times (default 8:00, 12:00, 18:00). Each check-in reads your memory, calendar, and project state, then DMs you a summary via Discord. Default prompts are owned by `alfred-agent` and seeded into `/alfred/proactive/prompts/` when `PROMPT_VERSION` increases.

## Quick start

1. **Clone** — `git clone https://github.com/travisday/alfred-agent.git`
2. **Deploy to Railway** — new project → deploy from GitHub → auto-detects Dockerfile
3. **Add a volume** — mount `alfred-data` at `/alfred`
4. **Set env vars** — see [`.env.example`](.env.example) for the full list; at minimum set `TS_AUTHKEY`, `RAILWAY_RUN_UID=0`, and one LLM API key
5. **Connect** — `tailscale ssh root@alfred` then `cd /alfred && pi`

See the [deployment guide](docs/deployment.md) for full instructions.

## Documentation

| Guide | Contents |
|-------|----------|
| [`.env.example`](.env.example) | Complete env var reference — secrets, preferences, defaults |
| [Setup](docs/setup.md) | Tailscale, LLM keys, CalDAV, Discord, Tavily, proactive check-ins |
| [Configuration](docs/configuration.md) | `config.env` reference, env var table, timezone, rollback |
| [Deployment](docs/deployment.md) | Clone, Railway deploy, volume, workspace seeding, system prompt |
| [SSH & Access](docs/ssh-and-access.md) | SSH/SFTP/Tailscale, kernel TUN vs userspace, phone access |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |

## Cost

| Service | Cost |
|---------|------|
| Railway (container + volume) | ~$5–10/mo depending on uptime |
| LLM API (Groq, Anthropic, etc.) | Pay-per-token, varies by provider |
| Tailscale | Free for personal use |
| **Total** | **~$5–10/mo** |

> Alfred doesn't need to run 24/7. Stop the Railway service when not in use — the volume persists regardless.

## License

MIT
