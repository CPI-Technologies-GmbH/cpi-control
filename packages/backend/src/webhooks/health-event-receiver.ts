import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { healthCheckResults, remoteAgents } from '../db/schema.js';
import { IncidentDetector } from '../modules/incidents/service.js';
import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('health-event-receiver');

interface HealthEvent {
  agentId: string;
  serviceId: string;
  monitoringTargetId?: string;
  status: 'healthy' | 'degraded' | 'down';
  statusCode?: number;
  responseTimeMs?: number;
  errorMessage?: string;
  checkedAt: string;
  metadata?: Record<string, unknown>;
}

interface HeartbeatEvent {
  agentId: string;
  version?: string;
  metrics?: Record<string, unknown>;
}

export default async function healthEventReceiver(app: FastifyInstance) {
  const db = app.db;
  const incidentDetector = new IncidentDetector(db);

  // Validate bearer token
  const validateToken = (request: any): boolean => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return false;
    }
    const token = authHeader.slice(7);

    // In production, validate against stored agent tokens
    // For now, accept any token that starts with 'agent-'
    return token.startsWith('agent-') || token === process.env.OPSBOARD_WEBHOOK_TOKEN;
  };

  // Receive health check results from remote agent
  app.post<{ Body: HealthEvent }>('/webhooks/health-event', async (request, reply) => {
    if (!validateToken(request)) {
      return reply.status(401).send({ error: 'Invalid or missing bearer token' });
    }

    const event = request.body;

    if (!event.serviceId || !event.status || !event.checkedAt) {
      return reply.status(400).send({ error: 'serviceId, status, and checkedAt are required' });
    }

    log.info(
      {
        serviceId: event.serviceId,
        status: event.status,
        agentId: event.agentId,
      },
      'Received health event'
    );

    // Store health check result
    const id = ulid();
    const now = new Date().toISOString();

    db.insert(healthCheckResults)
      .values({
        id,
        websiteId: event.serviceId,
        monitoringTargetId: event.monitoringTargetId || null,
        status: event.status,
        statusCode: event.statusCode || null,
        responseTimeMs: event.responseTimeMs || null,
        errorMessage: event.errorMessage || null,
        checkedAt: event.checkedAt,
        metadata: {
          ...event.metadata,
          agentId: event.agentId,
        },
        createdAt: now,
      })
      .run();

    // Process through incident detector
    const result = await incidentDetector.processHealthCheck(event.serviceId, event.status, {
      statusCode: event.statusCode,
      responseTimeMs: event.responseTimeMs,
      errorMessage: event.errorMessage,
    });

    // Trigger notifications if incident was created
    if (result.incidentCreated && app.notificationService) {
      app.notificationService.notify('incident.opened', `Incident created for service`, {
        serviceId: event.serviceId,
        incidentId: result.incidentCreated,
        severity: event.status === 'down' ? 'critical' : 'warning',
      });
    }

    if (result.incidentResolved && app.notificationService) {
      app.notificationService.notify('incident.resolved', `Incident auto-resolved`, {
        serviceId: event.serviceId,
        incidentId: result.incidentResolved,
      });
    }

    return reply.send({
      received: true,
      healthCheckId: id,
      ...result,
    });
  });

  // Receive batch health events
  app.post<{ Body: { events: HealthEvent[] } }>(
    '/webhooks/health-events/batch',
    async (request, reply) => {
      if (!validateToken(request)) {
        return reply.status(401).send({ error: 'Invalid or missing bearer token' });
      }

      const { events } = request.body;
      if (!events || !Array.isArray(events)) {
        return reply.status(400).send({ error: 'events array is required' });
      }

      const results = [];

      for (const event of events) {
        if (!event.serviceId || !event.status || !event.checkedAt) continue;

        const id = ulid();
        const now = new Date().toISOString();

        db.insert(healthCheckResults)
          .values({
            id,
            websiteId: event.serviceId,
            monitoringTargetId: event.monitoringTargetId || null,
            status: event.status,
            statusCode: event.statusCode || null,
            responseTimeMs: event.responseTimeMs || null,
            errorMessage: event.errorMessage || null,
            checkedAt: event.checkedAt,
            metadata: {
              ...event.metadata,
              agentId: event.agentId,
            },
            createdAt: now,
          })
          .run();

        const result = await incidentDetector.processHealthCheck(
          event.serviceId,
          event.status,
          {
            statusCode: event.statusCode,
            responseTimeMs: event.responseTimeMs,
            errorMessage: event.errorMessage,
          }
        );

        results.push({ healthCheckId: id, serviceId: event.serviceId, ...result });
      }

      return reply.send({ received: events.length, results });
    }
  );

  // Receive agent heartbeat
  app.post<{ Body: HeartbeatEvent }>(
    '/webhooks/agent-heartbeat',
    async (request, reply) => {
      if (!validateToken(request)) {
        return reply.status(401).send({ error: 'Invalid or missing bearer token' });
      }

      const { agentId, version, metrics } = request.body;
      if (!agentId) {
        return reply.status(400).send({ error: 'agentId is required' });
      }

      const now = new Date().toISOString();

      // Update agent status
      const rows = db
        .select()
        .from(remoteAgents)
        .where(eq(remoteAgents.id, agentId))
        .all();

      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Agent not found' });
      }

      db.update(remoteAgents)
        .set({
          status: 'online',
          lastHeartbeatAt: now,
          ...(version && { version }),
          updatedAt: now,
        })
        .where(eq(remoteAgents.id, agentId))
        .run();

      return reply.send({ received: true, agentId });
    }
  );
}
