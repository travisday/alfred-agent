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

# Expose Railway env vars to SSH sessions
# (Railway injects env vars into PID 1 only — SSH sessions don't inherit them)
env | grep -E '^(GROQ_|ANTHROPIC_|OPENAI_|GEMINI_|GITHUB_TOKEN|GITHUB_REPO)' | \
  sed 's/^/export /' > /etc/profile.d/railway-env.sh 2>/dev/null || true
chmod 644 /etc/profile.d/railway-env.sh

# Configure Pi agent auth.json (recreated on every boot since /root is ephemeral)
# Pi resolution order: CLI flag → auth.json → env var → models.json
mkdir -p /root/.pi/agent
if [ -n "$GROQ_API_KEY" ]; then
  cat > /root/.pi/agent/auth.json << EOF
{
  "groq": { "type": "api_key", "key": "$GROQ_API_KEY" }
}
EOF
  chmod 600 /root/.pi/agent/auth.json
fi

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
