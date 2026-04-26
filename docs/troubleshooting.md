# Troubleshooting

## Alfred doesn't appear in Tailscale admin console

- Check Railway deploy logs for Tailscale authentication errors
- Verify `TS_AUTHKEY` is set correctly in Railway env vars
- Auth keys expire — generate a new one if needed

## SSH connection drops on mobile

- Use `mosh` if your setup supports it for more stable mobile connections
- Make sure your terminal app supports mosh

## `ssh` / `sftp` to Alfred's Tailscale IP times out

- On **Railway**, there is usually **no `/dev/net/tun`**, so Tailscale runs in **userspace**; plain TCP to `100.x.x.x:22` does not reach `sshd`. Use **`tailscale ssh root@alfred`**. For native SFTP, run Alfred on a host that exposes **`/dev/net/tun`** + **`NET_ADMIN`** so logs show **`Tailscale: kernel TUN`** (see [SSH, SFTP, and file access](ssh-and-access.md)).

## `-bash: export: ... not a valid identifier` when logging in

- Usually fixed in current `start.sh` (safe quoting for Railway env). Redeploy; if it persists, check for unusual env var names in Railway.

## Pi can't find LLM models

- Verify your API key env var is set in Railway
- Check that `start.sh` is writing `auth.json` for the correct provider
- SSH in and run `env | grep API` to confirm the var is available

## Volume data gone after redeploy

- Railway volumes persist across restarts but **not** across project deletions
- Consider setting up git backup: `cd /alfred && git add -A && git commit -m "backup" && git push`

## Discord bot doesn't respond

- Verify `DISCORD_BOT_TOKEN` is set in Railway
- Enable **Message Content Intent** in the Discord Developer Portal
- Check deploy logs for "Discord bridge started"

## Discord task finished but no completion DM

- Set `TASK_WEBHOOK_SECRET` so signed task callbacks and completion notifications are enabled
- Check logs for `Task completion webhook listening` and `Invalid callback token/signature` messages
- If DM access is restricted, verify `DISCORD_DM_POLICY` and user IDs are configured correctly

## Stale Discord replies after resetting `alfred-memory` (or “blank `blocks/` but old tasks”)

**Git is not the whole volume.** Pushing a fresh `alfred-memory` repo updates tracked files under `/alfred`, but **gitignored runtime state** can still hold old data.

**On-container audit** (read-only checks):

1. `cd /alfred && git status -sb && git log -1 --oneline`
2. `ls -la blocks/ && cat blocks/*.yaml 2>/dev/null`
3. **Interactive Pi session (Discord + SSH when configured to match):** `ls -la "${ALFRED_PI_SESSION_DIR:-/alfred/state/pi-session}" 2>/dev/null`
4. **Legacy path (safe to delete after upgrade):** `ls -la .pi/sessions/discord 2>/dev/null`
5. **`!status` store:** `ls -la state/discord-tasks.json 2>/dev/null`
6. **Stray notes:** `find state logs -maxdepth 2 -type f 2>/dev/null | head -50`
7. **Overrides:** `grep -E '^ALFRED_PI_SESSION_DIR|^ALFRED_MEMORY_LOADER_PATH|^DISCORD_TASKS_FILE|^ALFRED_MEMORY_ROOT' /alfred/config.env 2>/dev/null; env | grep -E 'ALFRED_PI_SESSION_DIR|DISCORD_TASKS_FILE|ALFRED_MEMORY_ROOT'`

**How it works now:** The bridge keeps **one interactive session directory** (default `/alfred/state/pi-session`, override with `ALFRED_PI_SESSION_DIR`). It is **gitignored**. Each DM **refreshes `blocks/`** via `memory-loader.sh` into the system prompt (same idea as proactive check-ins). **`!new`** deletes that directory and starts a **new** Pi session (it no longer only disposed the in-process object).

**Hard reset** (when you want the volume to match a blank repo intent): stop the service if you can, then on the box remove at least:

- `state/pi-session/` (or your `ALFRED_PI_SESSION_DIR`)
- Optional: legacy `.pi/sessions/discord/`
- `state/discord-tasks.json` if `!status` is wrong
- `state/task-sessions/` for orphaned background Pi sessions

Then `cd /alfred && git fetch && git reset --hard origin/<branch> && git clean -fd` (review before running — drops **untracked** files). Redeploy.

**SSH `pi` vs Discord:** Both use **`cwd: /alfred`** and the same files for durable memory. The **transcript** path for Discord is `ALFRED_PI_SESSION_DIR`. The stock `pi` CLI uses its own default session layout unless you wrap it; sharing one continuous transcript across Discord and SSH requires matching Pi session configuration (future enhancement). **Goals and state on disk are still shared.**
