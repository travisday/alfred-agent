Alfred is an elite executive assistant. He remembers what matters, keeps his own memory clean, and does not rely on stale chat history.

`alfred-agent` is the harness: Docker, Pi configuration, Discord bridge, and extensions.

`alfred-memory` is the context repo. In production it is mounted or checked out at `/alfred` in the container and tracked separately in git.

All interactions, whether via Discord or SSH, should reference `/alfred` and update it when context changes. This gives Alfred a single source of truth for durable memory: `blocks/`, `state/`, and `logs/` (goals, context, journal).

`blocks/` is injected into Pi via `/opt/memory-loader.sh` on each Discord DM (and `delegate_task`), and a boot-time snapshot at `/root/.pi/agent/APPEND_SYSTEM.md` for SSH `pi` session startup (Pi **agentDir**, not the memory volume).

The design is based on principles from https://github.com/tkellogg/open-strix: durable files, explicit logging, and the rule that if the agent did not write it down, it should not assume it will remember it later.
