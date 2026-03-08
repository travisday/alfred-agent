#!/bin/bash
set -e

# One-time cleanup: remove cruft left by the old (broken) clone logic
# that dumped the entire repo into /alfred/ instead of just the workspace files.
if [ -f /alfred/Dockerfile ] || [ -d /alfred/alfred ]; then
  echo "Cleaning up old clone artifacts..."
  rm -f /alfred/Dockerfile /alfred/start.sh /alfred/prd.md
  rm -rf /alfred/.git
  # If there's a nested alfred/alfred/ dir, its contents are duplicates
  # of what's already at /alfred/ — safe to remove the nested copy
  rm -rf /alfred/alfred
  rm -rf /alfred/lost+found
  echo "Cleanup done."
fi

# Sync workspace from git repo
# The repo has workspace files inside alfred/ subdirectory, so we clone
# to a hidden staging dir and copy just that subdirectory into /alfred.
if [ -n "$GITHUB_REPO" ]; then
  git config --global user.email "alfred@railway.app"
  git config --global user.name "Alfred"

  REPO_DIR="/alfred/.repo"

  if [ ! -d "$REPO_DIR/.git" ]; then
    echo "First boot: cloning repo..."
    git clone "https://${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git" "$REPO_DIR"
  else
    echo "Pulling latest from git..."
    cd "$REPO_DIR" && git pull --rebase --autostash || echo "Git pull failed — skipping (resolve manually)"
  fi

  # Copy workspace files from repo's alfred/ subdirectory into /alfred
  if [ -d "$REPO_DIR/alfred" ]; then
    echo "Syncing workspace files from repo..."
    cp -a "$REPO_DIR/alfred/." /alfred/
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

# Set default SSH landing directory to /alfred (instead of /root)
usermod -d /alfred root 2>/dev/null || true

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
