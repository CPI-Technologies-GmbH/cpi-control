import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { remoteAgents } from '../../db/schema.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('heartbeat');

export class HeartbeatMonitor {
  private db: DB;
  private interval: ReturnType<typeof setInterval> | null = null;
  private staleThresholdMs: number;
  private checkIntervalMs: number;

  constructor(
    db: DB,
    options?: { staleThresholdMs?: number; checkIntervalMs?: number }
  ) {
    this.db = db;
    this.staleThresholdMs = options?.staleThresholdMs ?? 5 * 60 * 1000; // 5 minutes
    this.checkIntervalMs = options?.checkIntervalMs ?? 60 * 1000; // 1 minute
  }

  start(): void {
    this.interval = setInterval(() => this.check(), this.checkIntervalMs);
    log.info(
      { staleThresholdMs: this.staleThresholdMs, checkIntervalMs: this.checkIntervalMs },
      'Heartbeat monitor started'
    );
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    log.info('Heartbeat monitor stopped');
  }

  async processHeartbeat(
    agentId: string,
    data: { version?: string; metrics?: Record<string, unknown> }
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const rows = this.db
      .select()
      .from(remoteAgents)
      .where(eq(remoteAgents.id, agentId))
      .all();

    if (rows.length === 0) return false;

    this.db
      .update(remoteAgents)
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

  private async check(): Promise<void> {
    const now = Date.now();
    const agents = this.db.select().from(remoteAgents).all();

    for (const agent of agents) {
      if (agent.status === 'installing' || agent.status === 'unknown') continue;

      if (agent.lastHeartbeatAt) {
        const lastBeat = new Date(agent.lastHeartbeatAt).getTime();
        const elapsed = now - lastBeat;

        if (elapsed > this.staleThresholdMs && agent.status === 'online') {
          log.warn({ agentId: agent.id, elapsed }, 'Agent heartbeat stale, marking offline');
          this.db
            .update(remoteAgents)
            .set({
              status: 'offline',
              updatedAt: new Date().toISOString(),
            })
            .where(eq(remoteAgents.id, agent.id))
            .run();
        }
      }
    }
  }
}
