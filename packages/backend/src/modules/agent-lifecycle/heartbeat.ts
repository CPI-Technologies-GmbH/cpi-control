import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { remoteAgents } from '../../db/schema.js';
import { createChildLogger } from '../../shared/logger.js';
import { execOnAgent } from './ssh-helper.js';

const log = createChildLogger('agent-poller');

interface AgentHealthResponse {
  status: string;
  version: string;
  uptime: string;
  targetsCount: number;
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
    // Poll immediately on start
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

    // Strategy 1: Direct HTTP
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`http://${agent.host}:${apiPort}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const data: AgentHealthResponse = await res.json();
        this.updateAgentOnline(agent.id, data, now);
        log.debug({ agentId: agent.id, version: data.version }, 'Agent polled via HTTP');
        return { success: true, data };
      }
    } catch {
      // HTTP failed, try SSH
    }

    // Strategy 2: SSH fallback
    try {
      const result = await execOnAgent(agent, `curl -s --max-time 5 http://localhost:${apiPort}/health 2>/dev/null`);
      if (result.stdout.trim()) {
        const data: AgentHealthResponse = JSON.parse(result.stdout.trim());
        this.updateAgentOnline(agent.id, data, now);
        log.debug({ agentId: agent.id, version: data.version }, 'Agent polled via SSH');
        return { success: true, data };
      }
    } catch (err: any) {
      log.debug({ agentId: agent.id, error: err.message }, 'SSH poll failed');
    }

    // Both failed — mark offline
    if (agent.status === 'online') {
      this.db.update(remoteAgents)
        .set({ status: 'offline', updatedAt: now })
        .where(eq(remoteAgents.id, agent.id))
        .run();
      log.warn({ agentId: agent.id }, 'Agent unreachable, marked offline');
    }

    return { success: false };
  }

  private updateAgentOnline(agentId: string, data: AgentHealthResponse, now: string): void {
    this.db.update(remoteAgents)
      .set({
        status: 'online',
        version: data.version || undefined,
        lastHeartbeatAt: now,
        updatedAt: now,
      })
      .where(eq(remoteAgents.id, agentId))
      .run();
  }

  // Keep backward compat — old code may call this
  async processHeartbeat(
    agentId: string,
    data: { version?: string; metrics?: Record<string, unknown> }
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
