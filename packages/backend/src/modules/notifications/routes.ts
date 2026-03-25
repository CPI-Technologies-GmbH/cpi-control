import { FastifyInstance } from 'fastify';
import * as service from './service.js';
import type { CreateNotificationRuleBody, UpdateNotificationRuleBody } from './service.js';

export default async function notificationRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/notification-rules', async (_request, reply) => {
    const result = await service.listRules(db);
    return reply.send(result);
  });

  app.get<{ Params: { id: string } }>(
    '/notification-rules/:id',
    async (request, reply) => {
      const rule = await service.getRule(db, request.params.id);
      if (!rule) {
        return reply.status(404).send({ error: 'Notification rule not found' });
      }
      return reply.send(rule);
    }
  );

  app.post<{ Body: CreateNotificationRuleBody }>(
    '/notification-rules',
    async (request, reply) => {
      const body = request.body;
      if (!body.name || !body.eventType || !body.channel) {
        return reply
          .status(400)
          .send({ error: 'name, eventType, and channel are required' });
      }
      const rule = await service.createRule(db, body);
      return reply.status(201).send(rule);
    }
  );

  app.put<{ Params: { id: string }; Body: UpdateNotificationRuleBody }>(
    '/notification-rules/:id',
    async (request, reply) => {
      const result = await service.updateRule(db, request.params.id, request.body);
      if (!result) {
        return reply.status(404).send({ error: 'Notification rule not found' });
      }
      return reply.send(result);
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/notification-rules/:id',
    async (request, reply) => {
      const deleted = await service.deleteRule(db, request.params.id);
      if (!deleted) {
        return reply.status(404).send({ error: 'Notification rule not found' });
      }
      return reply.status(204).send();
    }
  );

  // Test notification
  app.post<{ Params: { id: string } }>(
    '/notification-rules/:id/test',
    async (request, reply) => {
      if (!app.notificationService) {
        return reply.status(503).send({ error: 'Notification service not available' });
      }
      const result = await app.notificationService.testNotification(request.params.id);
      return reply.send(result);
    }
  );
}
