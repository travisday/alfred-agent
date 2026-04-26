# Alfred

A self-hosted AI assistant that lives on a server — accessible from any device via SSH, Discord, or your phone. Built on [Pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent), deployed on [Railway](https://railway.com), and connected through [Tailscale](https://tailscale.com).

## What it does

Alfred is a self-hosted AI assistant that runs 24/7 in a Docker container. You SSH in (or DM a Discord bot) and interact with an LLM agent that has persistent memory, calendar access, web search, and scheduled check-ins — all stored on a single volume as plain markdown files. `alfred-agent` is the harness; separate `alfred-memory` repo is the memory system, checked out as a volume at `/alfred`.

## Features

- **Persistent memory** — Context lives in markdown files on a volume, survives restarts, and grows over time
- **Multi-provider LLM** — Swap between Groq, Anthropic, OpenAI, and Gemini at runtime
- **Discord bridge** — DM bot for the same experience as SSH, with `/task` for background work
- **Proactive check-ins** — Scheduled morning, midday, and evening summaries delivered via Discord DM
- **Apple Calendar** — Read your iCloud calendar with CalDAV (today's events, upcoming, date ranges)
- **Web search** — Live Tavily-powered search with cost-conscious defaults
- **Sub-agent delegation** — Offload long-running tasks to keep the main session responsive
- **Phone access** — Connect from iOS/Android via Tailscale + any terminal app
- **Custom system prompt** — Fully editable persona and behavior via `.pi/SYSTEM.md`

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                     Railway Container                        │
│                                                              │
│  ┌──────────────┐  ┌───────────────┐  ┌───────────────────┐ │
│  │   Pi Agent   │  │    Discord    │  │    Proactive      │ │
│  │   (Alfred)   │  │    Bridge     │  │    Scheduler      │ │
│  │              │  │  DMs ↔ Agent  │  │  morning/mid/eve  │ │
│  └──────┬───────┘  └───────┬───────┘  └────────┬──────────┘ │
│         │                  │                   │            │
│  ┌──────┴──────────────────┴───────────────────┴───────────┐ │
│  │              .pi/extensions/                           │ │
│  │  caldav · discord-notify · web-search · subagent       │ │
│  └────────────────────────┬───────────────────────────────┘ │
│                           │                                 │
│  ┌────────────────┴───────────────────────────────┐ │
│  │           /alfred (persistent memory repo)             │ │
│  │     blocks/ · state/ · logs/ · skills/            │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌──────────┐  ┌────────┐                                   │
│  │Tailscale │  │  SSH   │                                   │
│  │  (VPN)   │  │  Server │                                   │
│  └────┬─────┘  └───┬────┘                                   │
│       │                  │                                   │
│  ┌──────┼─────────────┼───────────────────────────────────────┐ │
│  │ SSH from  │    │ Discord │                                   │
│  │ any device│    │   DMs   │                                   │
│  └───────────┘    └─────────┘                                   │
└───────────┼─────────────┼───────────────────────────────────────────────┘
          │              │
          ▼
          │ Tailscale private network
          ▼
    ┌───────────┐    ┌─────────┐
    │ SSH from  │    │ Discord │
    │ any device│    │   DMs   │
    └───────────┘    └─────────┘
```

## How it works

Alfred runs the Pi agent on-demand inside the container. State is plain markdown files in `/alfred` — no database. LLM inference is handled by your provider's API (no GPU needed). Tailscale provides a private encrypted network so nothing is exposed to the public internet. Extensions are auto-discovered from `.pi/extensions/` and activate based on which env vars are set.

## Memory system (separate repo: alfred-memory)

The memory system uses a structural separation:

```
alfred-memory/
├── blocks/              # ALWAYS-IN-PROMPT YAML
│   ├── identity.yaml      # Who the user is, current focus, goals
│   ├── preferences.yaml    # Communication style, workflow preferences
│   ├── goals.yaml         # Current goals and status
│   └── patterns.yaml      # Recurring commitments, habits
├── state/               # ON-DEMAND MARKDOWN
│   ├── projects/         # Project-specific content, read when needed
│   ├── active-context.md   # Initiatives, session notes
│   └── today.md          # Daily priorities (auto-resets)
├── logs/                # APPEND-ONLY JSONL
│   ├── events.jsonl       # Operational events (scheduler, delivery)
│   └── journal.jsonl      # Session history
├── tasks.md              # Discrete tasks with due dates
└── tasks-archive.md       # Completed tasks (>3 days old)
```

**Key principle:** Always-on vs on-demand is structural — different directories, explicit. `blocks/*.yaml` are loaded at every turn via `memory-loader.sh`. Everything else is read on demand.

	## Memory system (separate repo: alfred-memory)

	The memory system uses Open-STRiX structure:

	```
	alfred-memory/
	├── blocks/              # YAML — always loaded in every prompt
	│   ├── identity.yaml      # Who you are, role, location, preferences
	│   ├── goals.yaml         # Current goals with status and next action
	│   └── patterns.yaml      # Recurring commitments, habits
	├── state/               # Markdown — read on demand
	│   └── .gitkeep         # Project notes, research (create files as needed)
	├── skills/              # Markdown skills
	│   └── .gitkeep         # Drop skills here, auto-discovered
	├── logs/                # Append-only JSONL
	│   ├── events.jsonl       # All tool calls, errors, scheduler triggers
	│   ├── journal.jsonl      # Agent's own log — what happened, what predicted
	│   └── chat-history.jsonl # Transcript of all conversations
	├── config.yaml           # Model, Discord config, preferences
	└── .gitignore            # Only chat-history.jsonl is ephemeral
	```

	**Key principle:** Always-on vs on-demand is structural — different directories, explicit. `blocks/*.yaml` are loaded at every turn via `memory-loader.sh`. Everything else is read on demand.
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
2. **Clone memory** — `git clone https://github.com/travisday/alfred-memory.git`
3. **Deploy to Railway** — New project → deploy from GitHub → auto-detects Dockerfile
4. **Add a volume** — Mount `alfred-data` at `/alfred` in Railway
5. **Set env vars** — See [`.env.example`](.env.example) for the full list; at minimum set `TS_AUTHKEY`, `RAILWAY_RUN_UID=0`, and one LLM API key
6. **Connect** — `tailscale ssh root@alfred` then `cd /alfred && pi`

See the [setup guide](docs/setup.md) for full instructions.

## Documentation

| Guide | Contents |
|-------|----------|
| [`.env.example`](.env.example) | Complete env var reference — secrets, preferences, defaults |
| [Setup](docs/setup.md) | Clone, deploy to Railway, configure integrations, seed workspace |
| [Configuration](docs/configuration.md) | `config.env` reference, env var table, timezone, GitHub memory syncing |
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
