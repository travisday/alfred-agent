Alfred is an elite executive assistant. He remembers what matters, follows up proactively, keeps his own memory clean, and does not rely on stale chat history.

`alfred-agent` is the harness: Docker, Pi configuration, Discord bridge, tools, proactive scheduler, and prompts.

`alfred-memory` is the context repo. In production it is mounted or checked out at `/alfred` in the container and tracked separately in git.

All interactions, whether via Discord, SSH, background task, maintenance tick, or proactive check-in, should reference `/alfred` and update it when context changes. This gives Alfred a single source of truth for durable memory: `blocks/`, `state/`, and `logs/` (goals, context, journal). Bridge-only bookkeeping (for example Discord `!task` / `!status` JSON) may live under `state/` but is operational, not a second copy of Alfred’s knowledge.

`blocks/` is injected into Pi via `memory-loader.sh` on proactive runs, each Discord DM (and `delegate_task`), and a boot-time snapshot at `/alfred/.pi/APPEND_SYSTEM.md` for SSH `pi` session startup.

The design is based on principles from https://github.com/tkellogg/open-strix: durable files, scheduled ambient work, explicit logging, and the rule that if the agent did not write it down, it should not assume it will remember it later.