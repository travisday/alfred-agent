#!/bin/bash
set -e

# Sync repo to volume via git
if [ -n "$GITHUB_REPO" ]; then
  git config --global user.email "alfred@railway.app"
  git config --global user.name "Alfred"
  if [ ! -d /alfred/.git ]; then
    echo "First boot: cloning repo into /alfred..."
    git clone "https://${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git" /tmp/repo
    shopt -s dotglob
    mv /tmp/repo/* /alfred/ 2>/dev/null || true
    mv /tmp/repo/.git /alfred/.git
    shopt -u dotglob
    rm -rf /tmp/repo
  else
    echo "Pulling latest from git..."
    cd /alfred && git pull --rebase --autostash || echo "Git pull failed — skipping (resolve manually)"
  fi
fi

# Store Tailscale state inside the /alfred volume (single volume setup)
mkdir -p /alfred/.tailscale

# Start Tailscale daemon in userspace networking mode
# (Railway containers don't have /dev/net/tun)
tailscaled --state=/alfred/.tailscale/tailscaled.state --tun=userspace-networking &
sleep 2

# Authenticate and join tailnet
tailscale up --authkey=${TS_AUTHKEY} --hostname=alfred --ssh

# Set SSH password from env (fallback for non-Tailscale connections)
echo "root:${SSH_PASSWORD:-changeme}" | chpasswd

# Start SSH server (needed for mosh connections)
/usr/sbin/sshd

echo "==============================="
echo " Alfred is online."
echo " Connect via: ssh alfred"
echo "==============================="

# Keep container alive
tail -f /dev/null
