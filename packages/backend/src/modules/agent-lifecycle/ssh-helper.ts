import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('ssh-helper');

function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return p.replace('~', process.env.HOME || '/root');
  }
  return p;
}

interface AgentRecord {
  host: string;
  port: number | null;
  username: string;
  config: Record<string, unknown> | null;
}

export async function connectToAgent(agent: AgentRecord) {
  const { NodeSSH } = await import('node-ssh');
  const ssh = new NodeSSH();
  const agentConfig = (agent.config || {}) as Record<string, unknown>;

  const baseOptions: any = {
    host: agent.host,
    port: agent.port || 22,
    username: agent.username,
  };

  // Try private key first
  if (agentConfig.privateKeyPath) {
    try {
      await ssh.connect({
        ...baseOptions,
        privateKeyPath: expandHome(agentConfig.privateKeyPath as string),
      });
      return ssh;
    } catch { /* try next */ }
  }

  // Try SSH agent
  if (process.env.SSH_AUTH_SOCK) {
    try {
      await ssh.connect({
        ...baseOptions,
        agent: process.env.SSH_AUTH_SOCK,
      });
      return ssh;
    } catch { /* try next */ }
  }

  // Final attempt
  await ssh.connect(baseOptions);
  return ssh;
}

export async function execOnAgent(
  agent: AgentRecord,
  command: string
): Promise<{ stdout: string; stderr: string }> {
  const ssh = await connectToAgent(agent);
  try {
    const result = await ssh.execCommand(command);
    return { stdout: result.stdout, stderr: result.stderr };
  } finally {
    ssh.dispose();
  }
}
