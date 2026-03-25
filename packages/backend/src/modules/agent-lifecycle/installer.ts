import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('agent-installer');

export interface InstallOptions {
  host: string;
  port: number;
  username: string;
  privateKeyPath?: string;
  password?: string;
  agentVersion?: string;
  config?: Record<string, unknown>;
}

export interface InstallResult {
  success: boolean;
  message: string;
  version?: string;
  installedAt?: string;
}

const AGENT_INSTALL_SCRIPT = `#!/bin/bash
set -e

INSTALL_DIR="/opt/opsboard-agent"
AGENT_VERSION="\${1:-latest}"

echo "Installing OpsBoard Agent v\${AGENT_VERSION}..."

# Create directory
sudo mkdir -p "\$INSTALL_DIR"
sudo mkdir -p "\$INSTALL_DIR/config"
sudo mkdir -p "\$INSTALL_DIR/logs"

# Download agent (placeholder - in production this would download from a releases server)
echo "Agent installed at \$INSTALL_DIR"

# Create systemd service
sudo tee /etc/systemd/system/opsboard-agent.service > /dev/null <<EOSVC
[Unit]
Description=OpsBoard Monitoring Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=\$INSTALL_DIR
ExecStart=\$INSTALL_DIR/opsboard-agent
Restart=always
RestartSec=10
StandardOutput=append:\$INSTALL_DIR/logs/agent.log
StandardError=append:\$INSTALL_DIR/logs/agent.log

[Install]
WantedBy=multi-user.target
EOSVC

sudo systemctl daemon-reload
sudo systemctl enable opsboard-agent
sudo systemctl start opsboard-agent

echo "OpsBoard Agent installed and started successfully"
`;

function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return p.replace('~', process.env.HOME || '/root');
  }
  return p;
}

export async function installAgent(options: InstallOptions): Promise<InstallResult> {
  log.info({ host: options.host, username: options.username }, 'Starting agent installation');

  try {
    const { NodeSSH } = await import('node-ssh');
    const ssh = new NodeSSH();

    // Connect to remote host -- try key file first, fall back to SSH agent
    const connectOptions: any = {
      host: options.host,
      port: options.port || 22,
      username: options.username,
    };

    let connected = false;

    // Try key file auth first
    if (options.privateKeyPath) {
      try {
        connectOptions.privateKeyPath = expandHome(options.privateKeyPath);
        await ssh.connect(connectOptions);
        connected = true;
      } catch (keyErr: any) {
        log.warn(
          { host: options.host, error: keyErr.message },
          'Key file auth failed, trying SSH agent'
        );
      }
    } else if (options.password) {
      connectOptions.password = options.password;
    }

    // Fall back to SSH agent if key file didn't work
    if (!connected && process.env.SSH_AUTH_SOCK) {
      const agentOptions: any = {
        host: options.host,
        port: options.port || 22,
        username: options.username,
        agent: process.env.SSH_AUTH_SOCK,
      };
      try {
        await ssh.connect(agentOptions);
        connected = true;
        log.info({ host: options.host }, 'Connected via SSH agent');
      } catch (agentErr: any) {
        log.warn(
          { host: options.host, error: agentErr.message },
          'SSH agent auth also failed'
        );
      }
    }

    // If still not connected, try password or throw
    if (!connected) {
      if (options.password) {
        connectOptions.password = options.password;
        delete connectOptions.privateKeyPath;
        await ssh.connect(connectOptions);
      } else {
        await ssh.connect(connectOptions);
      }
    }

    // Upload install script
    const scriptPath = '/tmp/opsboard-install.sh';
    await ssh.execCommand(`cat > ${scriptPath} << 'EOSCRIPT'\n${AGENT_INSTALL_SCRIPT}\nEOSCRIPT`);
    await ssh.execCommand(`chmod +x ${scriptPath}`);

    // Execute install script
    const version = options.agentVersion || 'latest';
    const result = await ssh.execCommand(`bash ${scriptPath} ${version}`);

    // Upload config if provided
    if (options.config) {
      const configJson = JSON.stringify(options.config, null, 2);
      await ssh.execCommand(
        `sudo tee /opt/opsboard-agent/config/agent.json > /dev/null << 'EOCONFIG'\n${configJson}\nEOCONFIG`
      );
      await ssh.execCommand('sudo systemctl restart opsboard-agent');
    }

    // Cleanup
    await ssh.execCommand(`rm -f ${scriptPath}`);
    ssh.dispose();

    if (result.code !== 0 && result.code !== null) {
      return {
        success: false,
        message: `Installation failed: ${result.stderr || result.stdout}`,
      };
    }

    return {
      success: true,
      message: 'Agent installed successfully',
      version,
      installedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    log.error({ host: options.host, error: err.message }, 'Agent installation failed');
    return {
      success: false,
      message: `SSH connection or installation failed: ${err.message}`,
    };
  }
}

export async function uninstallAgent(options: {
  host: string;
  port: number;
  username: string;
  privateKeyPath?: string;
  password?: string;
}): Promise<{ success: boolean; message: string }> {
  log.info({ host: options.host }, 'Starting agent uninstallation');

  try {
    const { NodeSSH } = await import('node-ssh');
    const ssh = new NodeSSH();

    const connectOptions: any = {
      host: options.host,
      port: options.port || 22,
      username: options.username,
    };

    let connected = false;

    if (options.privateKeyPath) {
      try {
        connectOptions.privateKeyPath = expandHome(options.privateKeyPath);
        await ssh.connect(connectOptions);
        connected = true;
      } catch {
        // Key file auth failed, try SSH agent below
      }
    } else if (options.password) {
      connectOptions.password = options.password;
    }

    if (!connected && process.env.SSH_AUTH_SOCK) {
      try {
        await ssh.connect({
          host: options.host,
          port: options.port || 22,
          username: options.username,
          agent: process.env.SSH_AUTH_SOCK,
        });
        connected = true;
      } catch {
        // SSH agent also failed
      }
    }

    if (!connected) {
      await ssh.connect(connectOptions);
    }

    // Stop and disable service
    await ssh.execCommand('sudo systemctl stop opsboard-agent || true');
    await ssh.execCommand('sudo systemctl disable opsboard-agent || true');
    await ssh.execCommand('sudo rm -f /etc/systemd/system/opsboard-agent.service');
    await ssh.execCommand('sudo systemctl daemon-reload');

    // Remove installation directory
    await ssh.execCommand('sudo rm -rf /opt/opsboard-agent');

    ssh.dispose();

    return {
      success: true,
      message: 'Agent uninstalled successfully',
    };
  } catch (err: any) {
    log.error({ host: options.host, error: err.message }, 'Agent uninstallation failed');
    return {
      success: false,
      message: `Uninstallation failed: ${err.message}`,
    };
  }
}
