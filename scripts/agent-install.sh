#!/bin/bash
# OpsBoard Remote Agent Installation Script
# This script is executed on the target droplet via SSH
set -e

AGENT_BINARY="/usr/local/bin/opsboard-agent"
CONFIG_DIR="/etc/opsboard-agent"
DATA_DIR="/var/lib/opsboard-agent"
SERVICE_FILE="/etc/systemd/system/opsboard-agent.service"

echo "=== Installing OpsBoard Monitoring Agent ==="

# Create user (idempotent)
id opsboard >/dev/null 2>&1 || useradd -r -s /bin/false opsboard
echo "User 'opsboard' ready"

# Create directories
mkdir -p "$CONFIG_DIR" "$DATA_DIR/events"
chown -R opsboard:opsboard "$DATA_DIR"
echo "Directories created"

# Binary should already be uploaded to $AGENT_BINARY
chmod +x "$AGENT_BINARY"
echo "Binary installed"

# Config should already be uploaded to $CONFIG_DIR/config.json

# Install systemd service
cat > "$SERVICE_FILE" << 'EOF'
[Unit]
Description=OpsBoard Monitoring Agent
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=opsboard
Group=opsboard
ExecStart=/usr/local/bin/opsboard-agent
WorkingDirectory=/var/lib/opsboard-agent
Restart=always
RestartSec=5
Environment=CONFIG_PATH=/etc/opsboard-agent/config.json

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/opsboard-agent
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
systemctl daemon-reload
systemctl enable --now opsboard-agent

echo "=== OpsBoard Agent installed and started ==="
