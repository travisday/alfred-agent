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
