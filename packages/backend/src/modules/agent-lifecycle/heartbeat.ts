import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { remoteAgents, healthCheckResults, websites } from '../../db/schema.js';
import { createChildLogger } from '../../shared/logger.js';
import { connectToAgent } from './ssh-helper.js';
import { ulid } from 'ulid';

const log = createChildLogger('agent-poller');

interface AgentHealthResponse {
  status: string;
  version: string;
  uptime: number;
  targetsCount: number;
}

interface AgentEvent {
  id: string;
  type: string;
  data: {
    targetId: string;
    websiteId: string;
    status: string;
    statusCode?: number;
    responseTimeMs?: number;
    errorMessage?: string;
    checkedAt: string;
  };
}

export class HeartbeatMonitor {
  private db: DB;
  private interval: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs: number;
  private running = false;

  constructor(
    db: DB,
    options?: { pollIntervalMs?: number }
  ) {
    this.db = db;
    this.pollIntervalMs = options?.pollIntervalMs ?? 60 * 1000;
  }

  start(): void {
    this.interval = setInterval(() => this.pollAllAgents(), this.pollIntervalMs);
    log.info({ pollIntervalMs: this.pollIntervalMs }, 'Agent poller started');
    setTimeout(() => this.pollAllAgents(), 5000);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    log.info('Agent poller stopped');
  }

  async pollAllAgents(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const agents = this.db.select().from(remoteAgents).all();
      for (const agent of agents) {
        if (agent.status === 'installing') continue;
        await this.pollSingleAgent(agent);
      }
    } catch (err: any) {
      log.error({ error: err.message }, 'Poll cycle failed');
    } finally {
      this.running = false;
    }
  }

  async pollSingleAgent(agent: any): Promise<{ success: boolean; data?: AgentHealthResponse }> {
    const now = new Date().toISOString();
    const agentConfig = (agent.config || {}) as Record<string, unknown>;
    const apiPort = (agentConfig.apiPort as number) || 9111;
    const apiToken = (agentConfig.apiToken as string) || '';

    let ssh;
    try {
      ssh = await connectToAgent(agent);
    } catch (err: any) {
      log.warn({ agentId: agent.id, error: err.message }, 'SSH connection failed');
      if (agent.status === 'online') {
        this.db.update(remoteAgents)
          .set({ status: 'offline', updatedAt: now })
          .where(eq(remoteAgents.id, agent.id))
          .run();
      }
      return { success: false };
    }

    try {
      // 1. Get agent health status
      const healthResult = await ssh.execCommand(`curl -s --max-time 5 http://localhost:${apiPort}/health 2>/dev/null`);
      const healthJson = healthResult.stdout.trim();
      if (!healthJson) {
        throw new Error('Empty health response');
      }

      const data: AgentHealthResponse = JSON.parse(healthJson);
      this.db.update(remoteAgents)
        .set({
          status: 'online',
          version: data.version || undefined,
          lastHeartbeatAt: now,
          updatedAt: now,
        })
        .where(eq(remoteAgents.id, agent.id))
        .run();
      log.debug({ agentId: agent.id, version: data.version, targets: data.targetsCount }, 'Agent polled');

      // 2. Pull pending health check events from agent
      const authHeader = apiToken ? `-H "Authorization: Bearer ${apiToken}"` : '';
      const eventsResult = await ssh.execCommand(
        `curl -s --max-time 10 ${authHeader} http://localhost:${apiPort}/events/pending 2>/dev/null`
      );
      const eventsJson = eventsResult.stdout.trim();
      if (eventsJson) {
        try {
          const parsed = JSON.parse(eventsJson);
          const events: AgentEvent[] = parsed.events || parsed || [];
          if (events.length > 0) {
            this.processAgentEvents(agent.id, events, now);
            // ACK the events
            const eventIds = events.map((e) => e.id);
            await ssh.execCommand(
              `curl -s --max-time 5 -X POST ${authHeader} -H "Content-Type: application/json" -d '${JSON.stringify({ eventIds })}' http://localhost:${apiPort}/events/ack 2>/dev/null`
            );
            log.info({ agentId: agent.id, count: events.length }, 'Processed agent health events');
          }
        } catch (err: any) {
          log.debug({ agentId: agent.id, error: err.message }, 'Failed to parse agent events');
        }
      }

      return { success: true, data };
    } catch (err: any) {
      log.warn({ agentId: agent.id, error: err.message }, 'Agent poll failed');
      if (agent.status === 'online') {
        this.db.update(remoteAgents)
          .set({ status: 'offline', updatedAt: now })
          .where(eq(remoteAgents.id, agent.id))
          .run();
      }
      return { success: false };
    } finally {
      ssh.dispose();
    }
  }

  private processAgentEvents(agentId: string, events: AgentEvent[], now: string): void {
    for (const event of events) {
      const d = event.data;
      if (!d?.websiteId) continue;

      // Map agent status to backend status
      const status = d.status === 'up' ? 'healthy' : d.status === 'degraded' ? 'degraded' : d.status === 'down' ? 'down' : d.status;

      // Store health check result
      this.db.insert(healthCheckResults).values({
        id: ulid(),
        websiteId: d.websiteId,
        monitoringTargetId: d.targetId || null,
        status,
        statusCode: d.statusCode ?? null,
        responseTimeMs: d.responseTimeMs ?? 0,
        errorMessage: d.errorMessage ?? null,
        checkedAt: d.checkedAt || now,
        createdAt: now,
      }).run();

      // Update website status from agent result
      this.db.update(websites)
        .set({ status, updatedAt: now })
        .where(eq(websites.id, d.websiteId))
        .run();
    }
  }

  // Backward compat
  async processHeartbeat(
    agentId: string,
    data: { version?: string }
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const rows = this.db.select().from(remoteAgents).where(eq(remoteAgents.id, agentId)).all();
    if (rows.length === 0) return false;

    this.db.update(remoteAgents)
      .set({
        status: 'online',
        lastHeartbeatAt: now,
        ...(data.version && { version: data.version }),
        updatedAt: now,
      })
      .where(eq(remoteAgents.id, agentId))
      .run();
    return true;
  }
}
