import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../index.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp({ dbPath: ':memory:' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

// Helper to set up a project + service so we can create incidents
async function setupService() {
  const projRes = await app.inject({
    method: 'POST',
    url: '/api/inventory/projects',
    payload: { name: 'Incident Test Project', slug: 'incident-test' },
  });
  const project = projRes.json();

  const svcRes = await app.inject({
    method: 'POST',
    url: '/api/inventory/services',
    payload: {
      projectId: project.id,
      name: 'Monitored Site',
      url: 'https://monitored.example.com',
      environment: 'production',
      hostingType: 'vercel',
    },
  });
  const service = svcRes.json();
  return { project, service };
}

// Helper to send a health event via the webhook endpoint
async function sendHealthEvent(
  serviceId: string,
  status: 'healthy' | 'degraded' | 'down',
  extra: Record<string, unknown> = {}
) {
  return app.inject({
    method: 'POST',
    url: '/api/webhooks/health-event',
    headers: {
      authorization: 'Bearer agent-test-token',
    },
    payload: {
      agentId: 'agent-1',
      serviceId,
      status,
      checkedAt: new Date().toISOString(),
      ...extra,
    },
  });
}

describe('Incidents API', () => {
  it('should list incidents (empty initially)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/incidents',
    });
    expect(res.statusCode).toBe(200);
    const incidents = res.json();
    expect(incidents).toEqual([]);
  });

  it('should create incident via health event webhook after threshold', async () => {
    const { service } = await setupService();

    // Send 3 consecutive 'down' health events (default failureThreshold is 3)
    const res1 = await sendHealthEvent(service.id, 'down', { errorMessage: 'Connection refused' });
    expect(res1.statusCode).toBe(200);
    expect(res1.json().incidentCreated).toBeUndefined();

    const res2 = await sendHealthEvent(service.id, 'down', { errorMessage: 'Connection refused' });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().incidentCreated).toBeUndefined();

    const res3 = await sendHealthEvent(service.id, 'down', { errorMessage: 'Connection refused' });
    expect(res3.statusCode).toBe(200);
    const result3 = res3.json();
    expect(result3.incidentCreated).toBeDefined();

    // Verify incident appears in list
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/incidents',
    });
    expect(listRes.statusCode).toBe(200);
    const incidents = listRes.json();
    expect(incidents).toHaveLength(1);
    expect(incidents[0].id).toBe(result3.incidentCreated);
    expect(incidents[0].status).toBe('open');
    expect(incidents[0].severity).toBe('critical');
    expect(incidents[0].websiteId).toBe(service.id);
  });

  it('should acknowledge an incident', async () => {
    const { service } = await setupService();

    // Trigger incident creation (3 consecutive failures)
    await sendHealthEvent(service.id, 'down');
    await sendHealthEvent(service.id, 'down');
    const res3 = await sendHealthEvent(service.id, 'down');
    const incidentId = res3.json().incidentCreated;

    // Acknowledge it
    const ackRes = await app.inject({
      method: 'POST',
      url: `/api/incidents/${incidentId}/acknowledge`,
      payload: { acknowledgedBy: 'admin@example.com' },
    });
    expect(ackRes.statusCode).toBe(200);
    const acked = ackRes.json();
    expect(acked.status).toBe('acknowledged');
    expect(acked.acknowledgedBy).toBe('admin@example.com');
    expect(acked.acknowledgedAt).toBeDefined();
  });

  it('should resolve an incident', async () => {
    const { service } = await setupService();

    // Trigger incident creation
    await sendHealthEvent(service.id, 'down');
    await sendHealthEvent(service.id, 'down');
    const res3 = await sendHealthEvent(service.id, 'down');
    const incidentId = res3.json().incidentCreated;

    // Resolve it
    const resolveRes = await app.inject({
      method: 'POST',
      url: `/api/incidents/${incidentId}/resolve`,
      payload: {
        resolvedBy: 'oncall@example.com',
        rootCause: 'Upstream provider outage',
        summary: 'AWS us-east-1 had an incident',
      },
    });
    expect(resolveRes.statusCode).toBe(200);
    const resolved = resolveRes.json();
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedBy).toBe('oncall@example.com');
    expect(resolved.rootCause).toBe('Upstream provider outage');
    expect(resolved.summary).toBe('AWS us-east-1 had an incident');
    expect(resolved.resolvedAt).toBeDefined();
  });

  it('should get incident with timeline events', async () => {
    const { service } = await setupService();

    // Trigger incident creation
    await sendHealthEvent(service.id, 'down');
    await sendHealthEvent(service.id, 'down');
    const res3 = await sendHealthEvent(service.id, 'down');
    const incidentId = res3.json().incidentCreated;

    // Acknowledge the incident to add a timeline event
    await app.inject({
      method: 'POST',
      url: `/api/incidents/${incidentId}/acknowledge`,
      payload: { acknowledgedBy: 'admin@example.com' },
    });

    // Add a comment to the timeline
    const commentRes = await app.inject({
      method: 'POST',
      url: `/api/incidents/${incidentId}/timeline`,
      payload: { message: 'Investigating root cause', source: 'user' },
    });
    expect(commentRes.statusCode).toBe(201);

    // Get incident detail (includes timeline)
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/incidents/${incidentId}`,
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json();
    expect(detail.id).toBe(incidentId);
    expect(detail.timeline).toBeDefined();
    expect(Array.isArray(detail.timeline)).toBe(true);

    // Timeline should contain: detected, acknowledged, comment
    const types = detail.timeline.map((e: any) => e.type);
    expect(types).toContain('detected');
    expect(types).toContain('acknowledged');
    expect(types).toContain('comment');
  });

  it('should return 404 for non-existent incident', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/incidents/nonexistent',
    });
    expect(res.statusCode).toBe(404);
  });

  it('should require acknowledgedBy when acknowledging', async () => {
    const { service } = await setupService();
    await sendHealthEvent(service.id, 'down');
    await sendHealthEvent(service.id, 'down');
    const res3 = await sendHealthEvent(service.id, 'down');
    const incidentId = res3.json().incidentCreated;

    const ackRes = await app.inject({
      method: 'POST',
      url: `/api/incidents/${incidentId}/acknowledge`,
      payload: {},
    });
    expect(ackRes.statusCode).toBe(400);
  });

  it('should reject health event without auth token', async () => {
    const { service } = await setupService();
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/health-event',
      payload: {
        agentId: 'agent-1',
        serviceId: service.id,
        status: 'down',
        checkedAt: new Date().toISOString(),
      },
    });
    expect(res.statusCode).toBe(401);
  });
});
