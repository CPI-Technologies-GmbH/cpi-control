import { FastifyInstance } from 'fastify';
import * as service from './service.js';
import type { CreateIntegrationBody, UpdateIntegrationBody } from './service.js';

export default async function integrationRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/integrations', async (_request, reply) => {
    const result = await service.listIntegrations(db);
    return reply.send(result);
  });

  app.get<{ Params: { id: string } }>('/integrations/:id', async (request, reply) => {
    const integration = await service.getIntegration(db, request.params.id);
    if (!integration) {
      return reply.status(404).send({ error: 'Integration not found' });
    }
    return reply.send(integration);
  });

  app.post<{ Body: CreateIntegrationBody }>('/integrations', async (request, reply) => {
    const body = request.body;
    if (!body.provider || !body.name) {
      return reply.status(400).send({ error: 'provider and name are required' });
    }
    const integration = await service.createIntegration(db, body);
    return reply.status(201).send(integration);
  });

  app.put<{ Params: { id: string }; Body: UpdateIntegrationBody }>(
    '/integrations/:id',
    async (request, reply) => {
      const result = await service.updateIntegration(db, request.params.id, request.body);
      if (!result) {
        return reply.status(404).send({ error: 'Integration not found' });
      }
      return reply.send(result);
    }
  );

  app.delete<{ Params: { id: string } }>('/integrations/:id', async (request, reply) => {
    const deleted = await service.deleteIntegration(db, request.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: 'Integration not found' });
    }
    // Remove from sync scheduler if registered
    if (app.syncScheduler) {
      app.syncScheduler.removeJob(request.params.id);
    }
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>(
    '/integrations/:id/sync',
    async (request, reply) => {
      if (!app.syncScheduler) {
        return reply.status(503).send({ error: 'Sync scheduler not available' });
      }
      const result = await app.syncScheduler.triggerSync(request.params.id);
      return reply.send(result);
    }
  );

  app.get('/integrations/sync/status', async (_request, reply) => {
    if (!app.syncScheduler) {
      return reply.send([]);
    }
    return reply.send(app.syncScheduler.getStatus());
  });
}
