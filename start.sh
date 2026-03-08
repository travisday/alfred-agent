#!/bin/bash
set -e

# Start Tailscale daemon
tailscaled --state=/var/lib/tailscale/tailscaled.state &
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
