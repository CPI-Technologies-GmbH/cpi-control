import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { remoteAgents, websites, monitoringTargets } from '../../db/schema.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('agent-syncer');

function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return p.replace('~', process.env.HOME || '/root');
  }
  return p;
}

export interface AgentConfig {
  agentId: string;
  serverUrl: string;
  apiToken: string;
  apiPort: number;
  targets: Array<{
    id: string;
    websiteId: string;
    websiteName: string;
    name: string;
    url: string;
    endpoint: string;
    type: string;
    checkIntervalSeconds: number;
    timeoutMs: number;
    expectedStatusCodes: number[];
    expectedContentPattern?: string;
  }>;
  checkDefaults: {
    timeoutSeconds: number;
    failureThreshold: number;
    recoveryThreshold: number;
    cooldownMinutes: number;
  };
}

export async function generateAgentConfig(
  db: DB,
  agentId: string,
  serverUrl: string
): Promise<AgentConfig | null> {
  const agent = db
    .select()
    .from(remoteAgents)
    .where(eq(remoteAgents.id, agentId))
    .all()[0];

  if (!agent) return null;

  // Get all services (with URLs) + monitoring targets
  const allServices = db.select().from(websites).all();
  const allTargets = db.select().from(monitoringTargets).all();

  const targetsByService = new Map<string, typeof allTargets>();
  for (const t of allTargets) {
    if (!t.enabled) continue;
    const arr = targetsByService.get(t.websiteId) || [];
    arr.push(t);
    targetsByService.set(t.websiteId, arr);
  }

  // Flatten targets: use monitoring_targets if available, otherwise create from service URL
  const targets: AgentConfig['targets'] = [];
  const addedServiceIds = new Set<string>();

  // 1. Add explicit monitoring targets
  for (const w of allServices) {
    if (w.archived) continue;
    const serviceTargets = targetsByService.get(w.id);
    if (serviceTargets && serviceTargets.length > 0) {
      for (const t of serviceTargets) {
        targets.push({
          id: t.id,
          websiteId: w.id,
          websiteName: w.name,
          endpoint: t.target,
        url: t.target,
        name: w.name,
          type: t.type,
          checkIntervalSeconds: t.checkIntervalSeconds || 60,
          timeoutMs: t.timeoutMs || 10000,
          expectedStatusCodes: t.expectedStatusCode ? [t.expectedStatusCode] : [200],
          expectedContentPattern: t.expectedBodyContains || undefined,
        });
        addedServiceIds.add(w.id);
      }
    }
  }

  // 2. Auto-generate targets for services with URLs that don't have monitoring targets
  for (const w of allServices) {
    if (w.archived || addedServiceIds.has(w.id) || !w.url) continue;
    targets.push({
      id: `auto-${w.id}`,
      websiteId: w.id,
      websiteName: w.name,
      endpoint: w.url,
      url: w.url,
      name: w.name,
      type: 'http',
      checkIntervalSeconds: w.checkIntervalSeconds || 60,
      timeoutMs: 10000,
      expectedStatusCodes: [200, 301, 302, 404], // Accept common HTTP responses as "up"
    });
  }

  // Generate a bearer token for this agent (in production, use proper token generation)
  const apiToken = `agent-${agentId}-${Date.now()}`;

  return {
    agentId,
    serverUrl: '',
    apiToken,
    apiPort: 9111,
    targets,
    checkDefaults: {
      timeoutSeconds: 10,
      failureThreshold: 3,
      recoveryThreshold: 2,
      cooldownMinutes: 15,
    },
  };
}

export async function syncAgentConfig(
  db: DB,
  agentId: string,
  serverUrl: string
): Promise<{ success: boolean; message: string }> {
  const agent = db
    .select()
    .from(remoteAgents)
    .where(eq(remoteAgents.id, agentId))
    .all()[0];

  if (!agent) {
    return { success: false, message: 'Agent not found' };
  }

  try {
    const config = await generateAgentConfig(db, agentId, serverUrl);
    if (!config) {
      return { success: false, message: 'Failed to generate config' };
    }

    const { NodeSSH } = await import('node-ssh');
    const ssh = new NodeSSH();

    const agentConfig = (agent.config as Record<string, unknown>) || {};
    const connectOptions: any = {
      host: agent.host,
      port: agent.port || 22,
      username: agent.username,
    };

    if (agentConfig.privateKeyPath) {
      connectOptions.privateKeyPath = expandHome(agentConfig.privateKeyPath as string);
    }

    await ssh.connect(connectOptions);

    const configJson = JSON.stringify(config, null, 2);
    await ssh.execCommand('sudo mkdir -p /etc/opsboard-agent');
    await ssh.execCommand(
      `sudo tee /etc/opsboard-agent/config.json > /dev/null << 'EOCONFIG'\n${configJson}\nEOCONFIG`
    );

    // Restart agent to pick up new config
    await ssh.execCommand('sudo systemctl restart opsboard-agent');
    ssh.dispose();

    // Update agent record
    const now = new Date().toISOString();
    const existingConfig = (agent.config as Record<string, unknown>) || {};
    db.update(remoteAgents)
      .set({
        updatedAt: now,
        config: {
          ...existingConfig,
          apiToken: config.apiToken,
          apiPort: config.apiPort,
          targets: config.targets.map((t) => ({ id: t.id, websiteId: t.websiteId })),
        },
      })
      .where(eq(remoteAgents.id, agentId))
      .run();

    log.info({ agentId }, 'Agent config synced successfully');
    return { success: true, message: 'Config synced and agent restarted' };
  } catch (err: any) {
    log.error({ agentId, error: err.message }, 'Failed to sync agent config');
    return { success: false, message: err.message };
  }
}
