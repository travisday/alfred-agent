#!/bin/bash
set -e

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
