import { eq, and, lt } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { websites, monitoringTargets, healthCheckResults, remoteAgents } from '../../db/schema.js';
import { createChildLogger } from '../../shared/logger.js';
import { eventBus, type ServiceEventType } from '../../shared/event-bus.js';
import { ulid } from 'ulid';
import type { IncidentDetector } from '../incidents/service.js';
import type { NotificationService } from '../notifications/service.js';

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
  responseHeaders?: Record<string, string>;
  responseBody?: string;
}

export class HealthChecker {
  private db: DB;
  private interval: ReturnType<typeof setInterval> | null = null;
  private checkIntervalMs: number;
  private semaphore: Semaphore;
  private running = false;
  private incidentDetector: IncidentDetector | null = null;
  private notificationService: NotificationService | null = null;

  constructor(db: DB, options?: {
    checkIntervalMs?: number;
    maxConcurrency?: number;
    incidentDetector?: IncidentDetector;
    notificationService?: NotificationService;
  }) {
    this.db = db;
    this.checkIntervalMs = options?.checkIntervalMs ?? 60 * 1000; // 60 seconds
    this.semaphore = new Semaphore(options?.maxConcurrency ?? 10);
    this.incidentDetector = options?.incidentDetector ?? null;
    this.notificationService = options?.notificationService ?? null;
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
            archived: websites.archived,
          },
        })
        .from(monitoringTargets)
        .innerJoin(websites, eq(monitoringTargets.websiteId, websites.id))
        .where(eq(monitoringTargets.enabled, true))
        .all();

      // Filter: skip private services and archived services
      let targets = rows.filter((row) => row.website.type !== 'service' && !row.website.archived);

      // Skip services that are covered by an online agent — agent results take priority
      const onlineAgents = this.db.select().from(remoteAgents)
        .where(eq(remoteAgents.status, 'online')).all();
      if (onlineAgents.length > 0) {
        const agentCoveredIds = new Set<string>();
        for (const agent of onlineAgents) {
          const cfg = (agent.config || {}) as Record<string, unknown>;
          const agentTargets = (cfg as any).targets as Array<{ websiteId: string }> | undefined;
          if (agentTargets) {
            for (const t of agentTargets) agentCoveredIds.add(t.websiteId);
          }
        }
        if (agentCoveredIds.size > 0) {
          const before = targets.length;
          targets = targets.filter((row) => !agentCoveredIds.has(row.target.websiteId));
          if (before !== targets.length) {
            log.info({ skipped: before - targets.length, agentCovered: agentCoveredIds.size }, 'Skipping services covered by online agents');
          }
        }
      }

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

      // Feed result to IncidentDetector (tracks consecutive failures/recoveries)
      if (this.incidentDetector) {
        try {
          const incidentResult = await this.incidentDetector.processHealthCheck(
            target.websiteId,
            result.status,
            {
              statusCode: result.statusCode ?? undefined,
              responseTimeMs: result.responseTimeMs,
              errorMessage: result.errorMessage ?? undefined,
              ...(result.responseHeaders && { responseHeaders: result.responseHeaders }),
              ...(result.responseBody && { responseBody: result.responseBody }),
              url: target.target,
            }
          );

          // Check if service is muted — skip all notifications if so
          const isMuted = (() => {
            const svcRow = this.db.select({ mutedUntil: websites.mutedUntil }).from(websites).where(eq(websites.id, target.websiteId)).all()[0];
            if (!svcRow?.mutedUntil) return false;
            return svcRow.mutedUntil === 'forever' || new Date(svcRow.mutedUntil).getTime() > Date.now();
          })();

          // Send notifications for new incidents (batched to prevent flood during cluster outages)
          if (incidentResult.incidentCreated && this.notificationService && !isMuted) {
            this.notificationService.notifyBatched(
              'incident.created',
              `${website.name} is ${result.status}`,
              {
                serviceId: target.websiteId,
                serviceName: website.name,
                severity: result.status === 'down' ? 'critical' : 'warning',
                incidentId: incidentResult.incidentCreated,
                statusCode: result.statusCode,
                errorMessage: result.errorMessage,
              }
            );
          }

          // Send notifications for auto-resolved incidents (batched)
          if (incidentResult.incidentResolved && this.notificationService && !isMuted) {
            this.notificationService.notifyBatched(
              'incident.resolved',
              `${website.name} has recovered`,
              {
                serviceId: target.websiteId,
                serviceName: website.name,
                incidentId: incidentResult.incidentResolved,
              }
            );
          }
        } catch (err: any) {
          log.error(
            { websiteId: target.websiteId, error: err.message },
            'IncidentDetector processing failed'
          );
        }
      }

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

        // Emit event when status actually changes (skip initial unknown -> X, skip muted services)
        const svcMuted = (() => {
          const row = this.db.select({ mutedUntil: websites.mutedUntil }).from(websites).where(eq(websites.id, target.websiteId)).all()[0];
          if (!row?.mutedUntil) return false;
          return row.mutedUntil === 'forever' || new Date(row.mutedUntil).getTime() > Date.now();
        })();
        if (website.status !== 'unknown' && website.status !== result.status && !svcMuted) {
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

      // Capture response details for non-healthy results (for incident metadata)
      const captureDetails = async () => {
        const headers: Record<string, string> = {};
        response.headers.forEach((v, k) => { headers[k] = v; });
        let body = '';
        try { body = await response.text(); } catch { /* ignore */ }
        if (body.length > 15000) body = body.slice(0, 15000) + '\n... [truncated]';
        return { responseHeaders: headers, responseBody: body };
      };

      if (code === expectedStatusCode) {
        return { status: 'healthy', statusCode: code, responseTimeMs, errorMessage: null };
      }
      if (code >= 200 && code < 400) {
        return {
          status: 'healthy',
          statusCode: code,
          responseTimeMs,
          errorMessage: code !== expectedStatusCode ? `Expected status ${expectedStatusCode}, got ${code}` : null,
        };
      }
      if (code === 404) {
        return { status: 'healthy', statusCode: code, responseTimeMs, errorMessage: null };
      }
      if (code === 401 || code === 403 || code === 406) {
        return { status: 'healthy', statusCode: code, responseTimeMs, errorMessage: code === 406 ? 'Not Acceptable' : 'Auth required' };
      }
      if (code >= 500) {
        const details = await captureDetails();
        return {
          status: 'down',
          statusCode: code,
          responseTimeMs,
          errorMessage: `HTTP ${code}`,
          ...details,
        };
      }
      // Other 4xx (429, etc.) → degraded
      const details = await captureDetails();
      return {
        status: 'degraded',
        statusCode: code,
        responseTimeMs,
        errorMessage: `HTTP ${code}`,
        ...details,
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
