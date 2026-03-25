import { FastifyInstance } from 'fastify';
import * as service from './service.js';
import type {
  CreateProjectBody,
  UpdateProjectBody,
  CreateServiceBody,
  UpdateServiceBody,
  BatchUpdateServicesBody,
  ServiceQueryParams,
  CreateMonitoringTargetBody,
  UpdateMonitoringTargetBody,
  CreateInfraBindingBody,
  CreateRepoBindingBody,
  CreateDeploymentSourceBody,
} from './types.js';

export default async function inventoryRoutes(app: FastifyInstance) {
  const db = app.db;

  // ─── Projects ───────────────────────────────────────────────────────────────

  app.get('/projects', async (_request, reply) => {
    const result = await service.listProjects(db);
    return reply.send(result);
  });

  app.get<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const project = await service.getProject(db, request.params.id);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    return reply.send(project);
  });

  app.post<{ Body: CreateProjectBody }>('/projects', async (request, reply) => {
    const body = request.body;
    if (!body.name || !body.slug) {
      return reply.status(400).send({ error: 'name and slug are required' });
    }
    try {
      const project = await service.createProject(db, body);
      return reply.status(201).send(project);
    } catch (err: any) {
      if (err.message?.includes('UNIQUE constraint')) {
        return reply.status(409).send({ error: 'Project slug already exists' });
      }
      throw err;
    }
  });

  app.put<{ Params: { id: string }; Body: UpdateProjectBody }>(
    '/projects/:id',
    async (request, reply) => {
      const result = await service.updateProject(db, request.params.id, request.body);
      if (!result) {
        return reply.status(404).send({ error: 'Project not found' });
      }
      return reply.send(result);
    }
  );

  app.delete<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const deleted = await service.deleteProject(db, request.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    return reply.status(204).send();
  });

  app.get<{ Params: { id: string } }>('/projects/:id/stats', async (request, reply) => {
    const project = await service.getProject(db, request.params.id);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    const stats = await service.getProjectStats(db, request.params.id);
    return reply.send(stats);
  });

  // ─── Services (formerly Websites) ────────────────────────────────────────────

  app.get<{ Querystring: ServiceQueryParams }>('/services', async (request, reply) => {
    const result = await service.listServices(db, request.query);
    return reply.send(result);
  });

  app.get<{ Params: { id: string } }>('/services/:id', async (request, reply) => {
    const svc = await service.getService(db, request.params.id);
    if (!svc) {
      return reply.status(404).send({ error: 'Service not found' });
    }
    return reply.send(svc);
  });

  app.post<{ Body: CreateServiceBody }>('/services', async (request, reply) => {
    const body = request.body;
    if (!body.projectId || !body.name || !body.environment || !body.hostingType) {
      return reply
        .status(400)
        .send({ error: 'projectId, name, environment, and hostingType are required' });
    }
    try {
      const svc = await service.createService(db, body);
      return reply.status(201).send(svc);
    } catch (err: any) {
      if (err.message?.includes('url is required')) {
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }
  });

  app.patch<{ Body: BatchUpdateServicesBody }>(
    '/services/batch',
    async (request, reply) => {
      const { ids, updates } = request.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({ error: 'ids must be a non-empty array' });
      }
      if (!updates || Object.keys(updates).length === 0) {
        return reply.status(400).send({ error: 'updates must contain at least one field' });
      }
      const result = await service.batchUpdateServices(db, { ids, updates });
      return reply.send(result);
    }
  );

  app.put<{ Params: { id: string }; Body: UpdateServiceBody }>(
    '/services/:id',
    async (request, reply) => {
      const result = await service.updateService(db, request.params.id, request.body);
      if (!result) {
        return reply.status(404).send({ error: 'Service not found' });
      }
      return reply.send(result);
    }
  );

  app.delete<{ Params: { id: string } }>('/services/:id', async (request, reply) => {
    const deleted = await service.deleteService(db, request.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: 'Service not found' });
    }
    return reply.status(204).send();
  });

  // ─── Monitoring Targets ────────────────────────────────────────────────────

  app.get<{ Querystring: { serviceId?: string } }>(
    '/monitoring-targets',
    async (request, reply) => {
      const result = await service.listMonitoringTargets(db, request.query.serviceId);
      return reply.send(result);
    }
  );

  app.get<{ Params: { id: string } }>(
    '/monitoring-targets/:id',
    async (request, reply) => {
      const target = await service.getMonitoringTarget(db, request.params.id);
      if (!target) {
        return reply.status(404).send({ error: 'Monitoring target not found' });
      }
      return reply.send(target);
    }
  );

  app.post<{ Body: CreateMonitoringTargetBody }>(
    '/monitoring-targets',
    async (request, reply) => {
      const body = request.body;
      if (!body.serviceId || !body.type || !body.target) {
        return reply
          .status(400)
          .send({ error: 'serviceId, type, and target are required' });
      }
      const target = await service.createMonitoringTarget(db, body);
      return reply.status(201).send(target);
    }
  );

  app.put<{ Params: { id: string }; Body: UpdateMonitoringTargetBody }>(
    '/monitoring-targets/:id',
    async (request, reply) => {
      const result = await service.updateMonitoringTarget(
        db,
        request.params.id,
        request.body
      );
      if (!result) {
        return reply.status(404).send({ error: 'Monitoring target not found' });
      }
      return reply.send(result);
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/monitoring-targets/:id',
    async (request, reply) => {
      const deleted = await service.deleteMonitoringTarget(db, request.params.id);
      if (!deleted) {
        return reply.status(404).send({ error: 'Monitoring target not found' });
      }
      return reply.status(204).send();
    }
  );

  // ─── Infrastructure Bindings ───────────────────────────────────────────────

  app.get<{ Querystring: { serviceId?: string } }>(
    '/infra-bindings',
    async (request, reply) => {
      const result = await service.listInfraBindings(db, request.query.serviceId);
      return reply.send(result);
    }
  );

  app.get<{ Params: { id: string } }>('/infra-bindings/:id', async (request, reply) => {
    const binding = await service.getInfraBinding(db, request.params.id);
    if (!binding) {
      return reply.status(404).send({ error: 'Infrastructure binding not found' });
    }
    return reply.send(binding);
  });

  app.post<{ Body: CreateInfraBindingBody }>('/infra-bindings', async (request, reply) => {
    const body = request.body;
    if (!body.serviceId || !body.provider || !body.externalId) {
      return reply
        .status(400)
        .send({ error: 'serviceId, provider, and externalId are required' });
    }
    const binding = await service.createInfraBinding(db, body);
    return reply.status(201).send(binding);
  });

  app.delete<{ Params: { id: string } }>(
    '/infra-bindings/:id',
    async (request, reply) => {
      const deleted = await service.deleteInfraBinding(db, request.params.id);
      if (!deleted) {
        return reply.status(404).send({ error: 'Infrastructure binding not found' });
      }
      return reply.status(204).send();
    }
  );

  // ─── Repository Bindings ───────────────────────────────────────────────────

  app.get<{ Querystring: { serviceId?: string } }>(
    '/repo-bindings',
    async (request, reply) => {
      const result = await service.listRepoBindings(db, request.query.serviceId);
      return reply.send(result);
    }
  );

  app.get<{ Params: { id: string } }>('/repo-bindings/:id', async (request, reply) => {
    const binding = await service.getRepoBinding(db, request.params.id);
    if (!binding) {
      return reply.status(404).send({ error: 'Repository binding not found' });
    }
    return reply.send(binding);
  });

  app.post<{ Body: CreateRepoBindingBody }>('/repo-bindings', async (request, reply) => {
    const body = request.body;
    if (!body.serviceId || !body.provider || !body.owner || !body.repo) {
      return reply
        .status(400)
        .send({ error: 'serviceId, provider, owner, and repo are required' });
    }
    const binding = await service.createRepoBinding(db, body);
    return reply.status(201).send(binding);
  });

  app.delete<{ Params: { id: string } }>(
    '/repo-bindings/:id',
    async (request, reply) => {
      const deleted = await service.deleteRepoBinding(db, request.params.id);
      if (!deleted) {
        return reply.status(404).send({ error: 'Repository binding not found' });
      }
      return reply.status(204).send();
    }
  );

  // ─── Deployment Sources ────────────────────────────────────────────────────

  app.get<{ Querystring: { serviceId?: string } }>(
    '/deployment-sources',
    async (request, reply) => {
      const result = await service.listDeploymentSources(db, request.query.serviceId);
      return reply.send(result);
    }
  );

  app.get<{ Params: { id: string } }>(
    '/deployment-sources/:id',
    async (request, reply) => {
      const source = await service.getDeploymentSource(db, request.params.id);
      if (!source) {
        return reply.status(404).send({ error: 'Deployment source not found' });
      }
      return reply.send(source);
    }
  );

  app.post<{ Body: CreateDeploymentSourceBody }>(
    '/deployment-sources',
    async (request, reply) => {
      const body = request.body;
      if (!body.serviceId || !body.provider) {
        return reply.status(400).send({ error: 'serviceId and provider are required' });
      }
      const source = await service.createDeploymentSource(db, body);
      return reply.status(201).send(source);
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/deployment-sources/:id',
    async (request, reply) => {
      const deleted = await service.deleteDeploymentSource(db, request.params.id);
      if (!deleted) {
        return reply.status(404).send({ error: 'Deployment source not found' });
      }
      return reply.status(204).send();
    }
  );

  // ─── Service Health Check History ───────────────────────────────────────────
  app.get<{
    Params: { id: string };
    Querystring: { since?: string; limit?: string };
  }>('/services/:id/health-checks', async (request, reply) => {
    const { id } = request.params;
    const { since, limit } = request.query;

    const { healthCheckResults } = await import('../../db/schema.js');
    const { eq, and, gte, desc } = await import('drizzle-orm');

    let query = db
      .select()
      .from(healthCheckResults)
      .where(eq(healthCheckResults.websiteId, id))
      .orderBy(desc(healthCheckResults.checkedAt));

    const results = query.all();

    let filtered = results;
    if (since) {
      filtered = filtered.filter((r: any) => r.checkedAt >= since);
    }

    const maxResults = limit ? parseInt(limit, 10) : 100;
    filtered = filtered.slice(0, maxResults);

    return reply.send(filtered);
  });
}
