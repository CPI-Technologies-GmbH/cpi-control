import { eq, and, desc, gte, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { DB } from '../../db/client.js';
import { incidents, websites, healthCheckResults } from '../../db/schema.js';
import { addTimelineEvent, getTimeline } from './timeline.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('incidents');

// ─── Incident CRUD ───────────────────────────────────────────────────────────

export async function listIncidents(
  db: DB,
  params: {
    serviceId?: string;
    status?: string | string[];
    severity?: string | string[];
    since?: string;
    limit?: string;
    offset?: string;
  }
) {
  const conditions: ReturnType<typeof eq>[] = [];

  if (params.serviceId) conditions.push(eq(incidents.websiteId, params.serviceId));
  if (params.status) {
    const statusArr = Array.isArray(params.status) ? params.status : [params.status];
    conditions.push(sql`${incidents.status} IN (${sql.join(statusArr.map(s => sql`${s}`), sql`, `)})`);
  }
  if (params.severity) {
    const sevArr = Array.isArray(params.severity) ? params.severity : [params.severity];
    conditions.push(sql`${incidents.severity} IN (${sql.join(sevArr.map(s => sql`${s}`), sql`, `)})`);
  }
  if (params.since) conditions.push(gte(incidents.detectedAt, params.since));

  const limit = params.limit ? parseInt(params.limit, 10) : 50;
  const offset = params.offset ? parseInt(params.offset, 10) : 0;

  let query = db.select().from(incidents);
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  return (query as any)
    .orderBy(desc(incidents.detectedAt))
    .limit(limit)
    .offset(offset)
    .all();
}

export async function getIncident(db: DB, id: string) {
  const rows = db.select().from(incidents).where(eq(incidents.id, id)).all();
  return rows[0] || null;
}

export async function getIncidentDetail(db: DB, id: string) {
  const incident = await getIncident(db, id);
  if (!incident) return null;

  const timeline = await getTimeline(db, id);

  return {
    ...incident,
    timeline,
  };
}

export async function acknowledgeIncident(db: DB, id: string, acknowledgedBy: string) {
  const now = new Date().toISOString();
  const incident = await getIncident(db, id);
  if (!incident) return null;
  if (incident.status === 'resolved') return incident;

  db.update(incidents)
    .set({
      status: 'acknowledged',
      acknowledgedAt: now,
      acknowledgedBy,
      updatedAt: now,
    })
    .where(eq(incidents.id, id))
    .run();

  await addTimelineEvent(
    db,
    id,
    'acknowledged',
    `Incident acknowledged by ${acknowledgedBy}`,
    'user'
  );

  return getIncident(db, id);
}

export async function resolveIncident(
  db: DB,
  id: string,
  resolvedBy: string,
  rootCause?: string,
  summary?: string
) {
  const now = new Date().toISOString();
  const incident = await getIncident(db, id);
  if (!incident) return null;

  db.update(incidents)
    .set({
      status: 'resolved',
      resolvedAt: now,
      resolvedBy,
      rootCause: rootCause || incident.rootCause,
      summary: summary || incident.summary,
      updatedAt: now,
    })
    .where(eq(incidents.id, id))
    .run();

  // Update service status back to healthy
  db.update(websites)
    .set({ status: 'healthy', updatedAt: now })
    .where(eq(websites.id, incident.websiteId))
    .run();

  await addTimelineEvent(
    db,
    id,
    'resolved',
    `Incident resolved by ${resolvedBy}${rootCause ? `. Root cause: ${rootCause}` : ''}`,
    'user'
  );

  return getIncident(db, id);
}

// ─── Incident Detector (State Machine) ──────────────────────────────────────

interface ServiceState {
  consecutiveFailures: number;
  consecutiveRecoveries: number;
  currentIncidentId: string | null;
}

export class IncidentDetector {
  private states = new Map<string, ServiceState>();
  private failureThreshold: number;
  private recoveryThreshold: number;

  constructor(
    private db: DB,
    options?: { failureThreshold?: number; recoveryThreshold?: number }
  ) {
    this.failureThreshold = options?.failureThreshold ?? 3;
    this.recoveryThreshold = options?.recoveryThreshold ?? 2;
  }

  private getState(serviceId: string): ServiceState {
    let state = this.states.get(serviceId);
    if (!state) {
      // Check for existing open incident
      const openIncidents = this.db
        .select()
        .from(incidents)
        .where(
          and(
            eq(incidents.websiteId, serviceId),
            eq(incidents.status, 'open')
          )
        )
        .all();
      state = {
        consecutiveFailures: 0,
        consecutiveRecoveries: 0,
        currentIncidentId: openIncidents[0]?.id || null,
      };
      this.states.set(serviceId, state);
    }
    return state;
  }

  async processHealthCheck(
    serviceId: string,
    status: 'healthy' | 'degraded' | 'down',
    details?: { statusCode?: number; responseTimeMs?: number; errorMessage?: string }
  ): Promise<{ incidentCreated?: string; incidentResolved?: string }> {
    const state = this.getState(serviceId);
    const now = new Date().toISOString();
    const result: { incidentCreated?: string; incidentResolved?: string } = {};

    if (status === 'down' || status === 'degraded') {
      state.consecutiveFailures++;
      state.consecutiveRecoveries = 0;

      // Update service status
      this.db
        .update(websites)
        .set({ status, updatedAt: now })
        .where(eq(websites.id, serviceId))
        .run();

      // Create incident if threshold reached and no current incident
      if (
        state.consecutiveFailures >= this.failureThreshold &&
        !state.currentIncidentId
      ) {
        const service = this.db
          .select()
          .from(websites)
          .where(eq(websites.id, serviceId))
          .all()[0];

        const incidentId = ulid();
        const severity = status === 'down' ? 'critical' : 'warning';
        const title = `${service?.name || serviceId} is ${status}`;

        this.db
          .insert(incidents)
          .values({
            id: incidentId,
            websiteId: serviceId,
            title,
            severity,
            status: 'open',
            detectedAt: now,
            metadata: details ? (details as Record<string, unknown>) : null,
            createdAt: now,
            updatedAt: now,
          })
          .run();

        await addTimelineEvent(
          this.db,
          incidentId,
          'detected',
          `${title} - detected after ${state.consecutiveFailures} consecutive failures${details?.errorMessage ? `: ${details.errorMessage}` : ''}`,
          'system',
          details as Record<string, unknown>
        );

        state.currentIncidentId = incidentId;
        result.incidentCreated = incidentId;

        log.warn(
          { serviceId, incidentId, severity },
          'Incident created'
        );
      }
    } else {
      // Healthy
      state.consecutiveRecoveries++;
      state.consecutiveFailures = 0;

      // Auto-resolve incident if recovery threshold reached
      if (
        state.consecutiveRecoveries >= this.recoveryThreshold &&
        state.currentIncidentId
      ) {
        const incidentId = state.currentIncidentId;

        this.db
          .update(incidents)
          .set({
            status: 'resolved',
            resolvedAt: now,
            resolvedBy: 'system',
            summary: 'Auto-resolved after sustained recovery',
            updatedAt: now,
          })
          .where(eq(incidents.id, incidentId))
          .run();

        this.db
          .update(websites)
          .set({ status: 'healthy', updatedAt: now })
          .where(eq(websites.id, serviceId))
          .run();

        await addTimelineEvent(
          this.db,
          incidentId,
          'resolved',
          `Auto-resolved after ${state.consecutiveRecoveries} consecutive healthy checks`,
          'system'
        );

        state.currentIncidentId = null;
        result.incidentResolved = incidentId;

        log.info({ serviceId, incidentId }, 'Incident auto-resolved');
      } else if (!state.currentIncidentId) {
        // Just update service status
        this.db
          .update(websites)
          .set({ status: 'healthy', updatedAt: now })
          .where(eq(websites.id, serviceId))
          .run();
      }
    }

    return result;
  }
}
