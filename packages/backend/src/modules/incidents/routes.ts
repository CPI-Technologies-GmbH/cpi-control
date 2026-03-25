import { FastifyInstance } from 'fastify';
import * as service from './service.js';
import { getTimeline, addTimelineEvent } from './timeline.js';

export default async function incidentRoutes(app: FastifyInstance) {
  const db = app.db;

  // List incidents
  app.get<{
    Querystring: {
      serviceId?: string;
      status?: string | string[];
      severity?: string | string[];
      since?: string;
      limit?: string;
      offset?: string;
    };
  }>('/incidents', async (request, reply) => {
    const result = await service.listIncidents(db, request.query);
    return reply.send(result);
  });

  // Get incident detail with timeline
  app.get<{ Params: { id: string } }>('/incidents/:id', async (request, reply) => {
    const detail = await service.getIncidentDetail(db, request.params.id);
    if (!detail) {
      return reply.status(404).send({ error: 'Incident not found' });
    }
    return reply.send(detail);
  });

  // Get incident timeline
  app.get<{ Params: { id: string } }>(
    '/incidents/:id/timeline',
    async (request, reply) => {
      const incident = await service.getIncident(db, request.params.id);
      if (!incident) {
        return reply.status(404).send({ error: 'Incident not found' });
      }
      const timeline = await getTimeline(db, request.params.id);
      return reply.send(timeline);
    }
  );

  // Add comment to incident timeline
  app.post<{ Params: { id: string }; Body: { message: string; source?: string } }>(
    '/incidents/:id/timeline',
    async (request, reply) => {
      const incident = await service.getIncident(db, request.params.id);
      if (!incident) {
        return reply.status(404).send({ error: 'Incident not found' });
      }
      if (!request.body.message) {
        return reply.status(400).send({ error: 'message is required' });
      }
      const event = await addTimelineEvent(
        db,
        request.params.id,
        'comment',
        request.body.message,
        request.body.source || 'user'
      );
      return reply.status(201).send(event);
    }
  );

  // Acknowledge incident
  app.post<{ Params: { id: string }; Body: { acknowledgedBy: string } }>(
    '/incidents/:id/acknowledge',
    async (request, reply) => {
      if (!request.body.acknowledgedBy) {
        return reply.status(400).send({ error: 'acknowledgedBy is required' });
      }
      const result = await service.acknowledgeIncident(
        db,
        request.params.id,
        request.body.acknowledgedBy
      );
      if (!result) {
        return reply.status(404).send({ error: 'Incident not found' });
      }
      return reply.send(result);
    }
  );

  // Resolve incident
  app.post<{
    Params: { id: string };
    Body: { resolvedBy: string; rootCause?: string; summary?: string };
  }>('/incidents/:id/resolve', async (request, reply) => {
    if (!request.body.resolvedBy) {
      return reply.status(400).send({ error: 'resolvedBy is required' });
    }
    const result = await service.resolveIncident(
      db,
      request.params.id,
      request.body.resolvedBy,
      request.body.rootCause,
      request.body.summary
    );
    if (!result) {
      return reply.status(404).send({ error: 'Incident not found' });
    }
    return reply.send(result);
  });
}
