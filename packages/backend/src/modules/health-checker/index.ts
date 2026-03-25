import { eq, and, lt } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { websites, monitoringTargets, healthCheckResults } from '../../db/schema.js';
import { createChildLogger } from '../../shared/logger.js';
import { eventBus, type ServiceEventType } from '../../shared/event-bus.js';
import { ulid } from 'ulid';

const log = createChildLogger('health-checker');

/** Simple concurrency limiter */
class Semaphore {
  private current = 0;
  private queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) {
      this.current++;
      next();
    }
  }
}

interface TargetWithWebsite {
  target: {
    id: string;
    websiteId: string;
    type: string;
    target: string;
    checkIntervalSeconds: number | null;
    timeoutMs: number | null;
    expectedStatusCode: number | null;
    enabled: boolean | null;
  };
  website: {
    id: string;
    name: string;
    type: string;
    status: string;
    url: string | null;
  };
}

interface CheckResult {
  status: 'healthy' | 'degraded' | 'down';
  statusCode: number | null;
  responseTimeMs: number;
  errorMessage: string | null;
}

export class HealthChecker {
  private db: DB;
  private interval: ReturnType<typeof setInterval> | null = null;
  private checkIntervalMs: number;
  private semaphore: Semaphore;
  private running = false;

  constructor(db: DB, options?: { checkIntervalMs?: number; maxConcurrency?: number }) {
    this.db = db;
    this.checkIntervalMs = options?.checkIntervalMs ?? 60 * 1000; // 60 seconds
    this.semaphore = new Semaphore(options?.maxConcurrency ?? 10);
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.checkAll(), this.checkIntervalMs);
    log.info({ checkIntervalMs: this.checkIntervalMs }, 'Health checker started');

    // Run first check immediately (non-blocking)
    this.checkAll();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    log.info('Health checker stopped');
  }

  async checkAll(): Promise<void> {
    if (this.running) {
      log.warn('Previous health check cycle still running, skipping');
      return;
    }

    this.running = true;
    try {
      // Clean up old results first
      this.cleanupOldResults();

      // Query all enabled monitoring targets with their associated websites
      const rows = this.db
        .select({
          target: {
            id: monitoringTargets.id,
            websiteId: monitoringTargets.websiteId,
            type: monitoringTargets.type,
            target: monitoringTargets.target,
            checkIntervalSeconds: monitoringTargets.checkIntervalSeconds,
            timeoutMs: monitoringTargets.timeoutMs,
            expectedStatusCode: monitoringTargets.expectedStatusCode,
            enabled: monitoringTargets.enabled,
          },
          website: {
            id: websites.id,
            name: websites.name,
            type: websites.type,
            status: websites.status,
            url: websites.url,
          },
        })
        .from(monitoringTargets)
        .innerJoin(websites, eq(monitoringTargets.websiteId, websites.id))
        .where(eq(monitoringTargets.enabled, true))
        .all();

      // Filter: skip private services (type='service') - those get status from K8s/Vercel sync
      const targets = rows.filter((row) => row.website.type !== 'service');

      if (targets.length === 0) {
        log.debug('No monitoring targets to check');
        this.running = false;
        return;
      }

      log.info({ count: targets.length }, 'Starting health check cycle');

      // Run checks concurrently with semaphore limiting
      const promises = targets.map((row) => this.checkWithSemaphore(row));
      await Promise.allSettled(promises);

      log.info({ count: targets.length }, 'Health check cycle complete');
    } catch (err: any) {
      log.error({ error: err.message }, 'Health check cycle failed');
    } finally {
      this.running = false;
    }
  }

  private async checkWithSemaphore(row: TargetWithWebsite): Promise<void> {
    await this.semaphore.acquire();
    try {
      await this.checkTargetAndRecord(row);
    } finally {
      this.semaphore.release();
    }
  }

  private async checkTargetAndRecord(row: TargetWithWebsite): Promise<void> {
    const { target, website } = row;
    try {
      const result = await this.checkTarget(target);
      const now = new Date().toISOString();

      // Record the result
      this.db.insert(healthCheckResults).values({
        id: ulid(),
        websiteId: target.websiteId,
        monitoringTargetId: target.id,
        status: result.status,
        statusCode: result.statusCode,
        responseTimeMs: result.responseTimeMs,
        errorMessage: result.errorMessage,
        checkedAt: now,
        createdAt: now,
      }).run();

      // Update website status if it was previously 'unknown' or if status changed
      if (website.status === 'unknown' || website.status !== result.status) {
        this.db.update(websites)
          .set({
            status: result.status,
            updatedAt: now,
          })
          .where(eq(websites.id, target.websiteId))
          .run();

        log.info(
          {
            websiteId: target.websiteId,
            name: website.name,
            oldStatus: website.status,
            newStatus: result.status,
          },
          'Website status updated'
        );

        // Emit event when status actually changes (skip initial unknown -> X transitions)
        if (website.status !== 'unknown' && website.status !== result.status) {
          const eventTypeMap: Record<string, ServiceEventType> = {
            down: 'service.down',
            degraded: 'service.degraded',
            healthy: 'service.up',
          };
          const eventType = eventTypeMap[result.status];
          if (eventType) {
            eventBus.publish(eventType, {
              serviceName: website.name,
              serviceId: website.id,
              provider: 'health-checker',
              details: {
                oldStatus: website.status,
                newStatus: result.status,
                statusCode: result.statusCode,
                responseTimeMs: result.responseTimeMs,
                errorMessage: result.errorMessage,
                url: target.target,
              },
            });
          }
        }
      }

      log.debug(
        {
          targetId: target.id,
          url: target.target,
          status: result.status,
          statusCode: result.statusCode,
          responseTimeMs: result.responseTimeMs,
        },
        'Health check completed'
      );
    } catch (err: any) {
      log.warn(
        { targetId: target.id, url: target.target, error: err.message },
        'Health check failed for target'
      );
    }
  }

  async checkTarget(target: {
    target: string;
    timeoutMs: number | null;
    expectedStatusCode: number | null;
  }): Promise<CheckResult> {
    const timeoutMs = target.timeoutMs ?? 10000;
    const expectedStatusCode = target.expectedStatusCode ?? 200;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const startTime = Date.now();

    try {
      const response = await fetch(target.target, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'OpsBoard-HealthChecker/1.0',
        },
      });

      const responseTimeMs = Date.now() - startTime;

      // Status mapping:
      // 2xx/3xx/404 → healthy (many services return 404 on root health endpoint)
      // Other 4xx → degraded
      // 5xx → down
      const code = response.status;

      if (code === expectedStatusCode) {
        return { status: 'healthy', statusCode: code, responseTimeMs, errorMessage: null };
      }
      if (code >= 200 && code < 400) {
        // 2xx/3xx but not the expected code — still healthy, just note the difference
        return {
          status: 'healthy',
          statusCode: code,
          responseTimeMs,
          errorMessage: code !== expectedStatusCode ? `Expected status ${expectedStatusCode}, got ${code}` : null,
        };
      }
      if (code === 404) {
        // 404 is treated as healthy — many services return 404 on their health endpoint root
        return { status: 'healthy', statusCode: code, responseTimeMs, errorMessage: null };
      }
      if (code >= 500) {
        return {
          status: 'down',
          statusCode: code,
          responseTimeMs,
          errorMessage: `HTTP ${code}`,
        };
      }
      // Other 4xx (401, 403, 429, etc.) → degraded
      return {
        status: 'degraded',
        statusCode: code,
        responseTimeMs,
        errorMessage: `HTTP ${code}`,
      };
    } catch (err: any) {
      const responseTimeMs = Date.now() - startTime;
      const isTimeout = err.name === 'AbortError';
      return {
        status: 'down',
        statusCode: null,
        responseTimeMs,
        errorMessage: isTimeout ? `Timeout after ${timeoutMs}ms` : err.message,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Delete health_check_results older than 7 days to prevent DB bloat.
   */
  private cleanupOldResults(): void {
    try {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      this.db
        .delete(healthCheckResults)
        .where(lt(healthCheckResults.checkedAt, cutoff))
        .run();
    } catch (err: any) {
      log.warn({ error: err.message }, 'Failed to clean up old health check results');
    }
  }
}
