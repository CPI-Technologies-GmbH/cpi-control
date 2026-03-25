import { FastifyInstance } from 'fastify';
import { logViewConfigs, type LogViewConfigData } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';

export default async function logConfigRoutes(app: FastifyInstance) {
  // GET /log-configs — List all saved configs
  app.get('/log-configs', async (_request, reply) => {
    const configs = app.db.select().from(logViewConfigs).all();
    return reply.send(configs);
  });

  // GET /log-configs/:id — Get a single config
  app.get<{ Params: { id: string } }>('/log-configs/:id', async (request, reply) => {
    const { id } = request.params;
    const config = app.db
      .select()
      .from(logViewConfigs)
      .where(eq(logViewConfigs.id, id))
      .get();

    if (!config) {
      return reply.status(404).send({ error: 'Config not found' });
    }
    return reply.send(config);
  });

  // POST /log-configs — Create a new config
  app.post<{
    Body: { name: string; config: LogViewConfigData };
  }>('/log-configs', async (request, reply) => {
    const { name, config } = request.body;
    const now = new Date().toISOString();
    const id = ulid();

    app.db.insert(logViewConfigs).values({
      id,
      name,
      config,
      createdAt: now,
      updatedAt: now,
    }).run();

    const created = app.db
      .select()
      .from(logViewConfigs)
      .where(eq(logViewConfigs.id, id))
      .get();

    return reply.status(201).send(created);
  });

  // PUT /log-configs/:id — Update an existing config
  app.put<{
    Params: { id: string };
    Body: { name?: string; config?: LogViewConfigData };
  }>('/log-configs/:id', async (request, reply) => {
    const { id } = request.params;
    const { name, config } = request.body;
    const now = new Date().toISOString();

    const existing = app.db
      .select()
      .from(logViewConfigs)
      .where(eq(logViewConfigs.id, id))
      .get();

    if (!existing) {
      return reply.status(404).send({ error: 'Config not found' });
    }

    app.db
      .update(logViewConfigs)
      .set({
        ...(name !== undefined && { name }),
        ...(config !== undefined && { config }),
        updatedAt: now,
      })
      .where(eq(logViewConfigs.id, id))
      .run();

    const updated = app.db
      .select()
      .from(logViewConfigs)
      .where(eq(logViewConfigs.id, id))
      .get();

    return reply.send(updated);
  });

  // DELETE /log-configs/:id — Delete a config
  app.delete<{ Params: { id: string } }>('/log-configs/:id', async (request, reply) => {
    const { id } = request.params;

    const existing = app.db
      .select()
      .from(logViewConfigs)
      .where(eq(logViewConfigs.id, id))
      .get();

    if (!existing) {
      return reply.status(404).send({ error: 'Config not found' });
    }

    app.db.delete(logViewConfigs).where(eq(logViewConfigs.id, id)).run();
    return reply.status(204).send();
  });
}
