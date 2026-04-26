# SSH, SFTP, and File Access

## Connecting to Alfred

**Railway (default):** Plain `ssh` / `sftp` to Alfred's Tailscale IP on port 22 often **times out** because Tailscale runs in **userspace** mode (Railway does not provide `/dev/net/tun` or `NET_ADMIN`). Use the **Tailscale CLI** after the [Tailscale app](https://tailscale.com/download) is running on your device:

```bash
tailscale ssh root@alfred
```

Then `cd /alfred && pi`. On boot, `start.sh` writes `blocks/` into `/alfred/.pi/APPEND_SYSTEM.md` so interactive Pi loads the same YAML context at session startup as proactive check-ins (edit `blocks/` and restart the service, or rely on tool reads for mid-session updates). See [Troubleshooting](troubleshooting.md) for Discord vs SSH transcript paths.

**Via Discord (if `DISCORD_BOT_TOKEN` is set):** DM the bot — no SSH needed. Same workspace and session as SSH.

For long work from Discord, prefer `/task ...` so Alfred can continue responding to other DMs while your task runs.

## From Your Phone

1. Install [Tailscale](https://tailscale.com) on your phone and sign into the same account
2. Install a terminal app:
   - **[Moshi](https://apps.apple.com/app/moshi-ai-terminal/id6504464458)** — built for AI agents, push notifications, voice input, mosh support
   - **[Blink Shell](https://blink.sh)** — open source, mature, excellent mosh support
   - **Termius** — cross-platform, SSH/mosh/SFTP
3. Connect with **`tailscale ssh root@alfred`** when plain `ssh` to the Tailnet IP does not work (typical on Railway); or `mosh` if your client supports it with the same transport your setup uses
4. Run Pi: `cd /alfred && pi`

## Why `ssh root@100.x` or SFTP can time out (Railway)

Startup picks **kernel TUN** only if **`/dev/net/tun`** exists in the container (unusual on Railway). Otherwise it uses **userspace** Tailscale. In userspace mode, **inbound TCP to the Tailscale address on port 22** usually does **not** reach OpenSSH, so generic clients that open `sftp://` or `ssh` to `100.x.x.x:22` may hang or time out. **Railway does not provide `/dev/net/tun` or `NET_ADMIN`**, so Alfred almost always runs userspace there. Community discussion: [Railway Help Station](https://station.railway.com) (search for TUN / privileged).

**On Railway, use:**

- **Shell:** `tailscale ssh root@alfred` (Tailscale app running on your Mac/PC/phone).
- **Files:** Prefer editing through that shell, sync tools, or SFTP with a client that can use **`tailscale ssh` as the SSH program** (or `ProxyCommand`; see [Tailscale SSH](https://tailscale.com/kb/1193/tailscale-ssh)).

## Native SSH and SFTP to `/alfred` (self-hosted / VPS with TUN)

If you run this image on a host that provides **`/dev/net/tun`** and **`CAP_NET_ADMIN`** (typical Docker flags: `--device /dev/net/tun --cap-add=NET_ADMIN`, or privileged on a VPS), startup **automatically** uses kernel TUN — check deploy logs for `Tailscale: kernel TUN`.

Then from a device on your tailnet, **verify** (replace the IP with Alfred's Tailscale IP from `tailscale status` or the admin console):

```bash
ssh root@100.x.x.x
# password: value of SSH_PASSWORD in your env

sftp root@100.x.x.x
sftp> cd /alfred
sftp> ls
```

Mount the folder with **Cyberduck**, **Transmit**, **sshfs**, or your editor using **SFTP/SSH**, user **`root`**, password **`SSH_PASSWORD`**, remote path **`/alfred`**.

Use a **strong `SSH_PASSWORD`**; your tailnet ACLs still matter.

## Manual checklist (kernel TUN mode only)

When deploy logs show **`Tailscale: kernel TUN`** and Tailscale is up:

| Step | Command / action |
|------|------------------|
| 1 | `tailscale status` on your laptop — `alfred` online |
| 2 | `ssh root@<alfred-tailscale-ip>` — login with `SSH_PASSWORD` |
| 3 | `sftp root@<ip>` — `cd /alfred`, list files |
| 4 | Optional: Cyberduck / sshfs to same host, path `/alfred` |
