# Alfred

A self-hosted AI assistant that lives on a server — accessible from any device via SSH, Discord, or your phone. Built on [Pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent), deployed on [Railway](https://railway.com), and connected through [Tailscale](https://tailscale.com).

## What it does

Alfred is a self-hosted AI assistant that runs 24/7 in a Docker container. You SSH in (or DM a Discord bot) and interact with an LLM agent that has persistent memory, calendar access, and web search — all stored on a single volume as plain files. `alfred-agent` is the harness; separate `alfred-memory` repo is the memory system, checked out as a volume at `/alfred`.

## Features

- **Persistent memory** — Context lives in files on a volume, survives restarts, and grows over time
- **Multi-provider LLM** — Swap between Groq, Anthropic, OpenAI, and Gemini at runtime
- **Discord bridge** — DM bot wired to the same Pi session + memory as SSH
- **Apple Calendar** — Read your iCloud calendar with CalDAV (today's events, upcoming, date ranges)
- **Web search** — Live Tavily-powered search with cost-conscious defaults
- **Sub-agent delegation** — Offload long-running tasks to keep the main session responsive
- **Phone access** — Connect from iOS/Android via Tailscale + any terminal app
- **Custom system prompt** — Fully editable persona and behavior via `.pi/SYSTEM.md`

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                     Railway Container                      │
│                                                            │
│  ┌──────────────┐  ┌───────────────┐                      │
│  │   Pi Agent   │  │    Discord    │                      │
│  │   (Alfred)   │  │    Bridge     │                      │
│  │              │  │  DMs ↔ Agent  │                      │
│  └──────┬───────┘  └───────┬───────┘                      │
│         │                  │                              │
│  ┌──────┴──────────────────┴──────────────────────────────┐ │
│  │              .pi/extensions/                         │ │
│  │  caldav · discord-notify · web-search · subagent     │ │
│  └────────────────────────┬────────────────────────────┘ │
│                           │                                │
│  ┌────────────────────────┴───────────────────────────────┐│
│  │           /alfred (persistent memory repo)             ││
│  │     blocks/ · state/ · logs/ · skills/                 ││
│  └────────────────────────────────────────────────────────┘│
│                                                            │
│  ┌──────────┐  ┌────────┐                                  │
│  │Tailscale │  │  SSH   │                                  │
│  │  (VPN)   │  │ Server │                                  │
│  └────┬─────┘  └───┬────┘                                  │
│       │            │                                       │
│       └──────┬─────┘                                       │
│              ▼                                             │
│       Tailscale private network                            │
│              ▼                                             │
│    ┌───────────────┐    ┌─────────┐                        │
│    │ SSH / SFTP    │    │ Discord│                        │
│    │  any device   │    │   DMs  │                        │
│    └───────────────┘    └─────────┘                        │
└────────────────────────────────────────────────────────────┘
```

## How it works

Alfred runs the Pi agent on-demand inside the container. **Memory** is plain files in `/alfred` (git); **Pi harness** (SYSTEM, extensions, sessions, Discord task store) lives under **`/root/.pi/agent`** — no database. LLM inference is handled by your provider's API (no GPU needed). Tailscale provides a private encrypted network so nothing is exposed to the public internet. Extensions are auto-discovered from `.pi/extensions/` and activate based on which env vars are set.

## Memory system (separate repo: alfred-memory)

Open-STRiX layout (clone as `/alfred` on the server):

```
alfred-memory/
├── blocks/              # YAML — always loaded via memory-loader.sh
│   ├── identity.yaml      # Who you are, role, focus
│   ├── preferences.yaml   # Communication and workflow (optional)
│   ├── goals.yaml         # Current goals with status and next action
│   └── patterns.yaml      # Recurring commitments, habits
├── state/               # Markdown — read on demand (projects, notes, today.md, …)
├── skills/              # Optional markdown skills (auto-discovered when present)
├── logs/                # Append-only JSONL
│   ├── events.jsonl       # Operational events
│   ├── journal.jsonl      # Agent log — what happened, what it predicted
│   └── chat-history.jsonl # Conversation transcript (optional; often gitignored)
├── config.yaml           # Local preferences template (secrets still in Railway)
└── .gitignore
```

**Key principle:** Always-on vs on-demand is structural — different directories, explicit. `blocks/*.yaml` are loaded at every turn via `memory-loader.sh`. Everything else is read on demand. Work items and next actions live in **`blocks/goals.yaml`**, not a root-level `tasks.md`.
## Extensions

| Extension | Tools | Description |
|-----------|-------|-------------|
| **caldav** | `get_today_events`, `get_calendar_events`, `get_upcoming` | Read Apple Calendar via iCloud CalDAV |
| **discord-notify** | `send_discord_message` | Send Discord DMs from tools (REST API) |
| **web-search** | `web_search` | Live web search via Tavily API |
| **subagent** | `delegate_task` | Offload long tasks to a background agent |

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
