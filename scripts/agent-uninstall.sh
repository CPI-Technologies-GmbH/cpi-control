#!/bin/bash
# OpsBoard Remote Agent Uninstallation Script
set -e

echo "=== Uninstalling OpsBoard Monitoring Agent ==="

# Stop and disable service
systemctl stop opsboard-agent 2>/dev/null || true
systemctl disable opsboard-agent 2>/dev/null || true

# Remove files
rm -f /etc/systemd/system/opsboard-agent.service
rm -f /usr/local/bin/opsboard-agent
rm -rf /etc/opsboard-agent
rm -rf /var/lib/opsboard-agent

# Remove user (optional)
userdel opsboard 2>/dev/null || true

# Reload systemd
systemctl daemon-reload

echo "=== OpsBoard Agent uninstalled ==="
