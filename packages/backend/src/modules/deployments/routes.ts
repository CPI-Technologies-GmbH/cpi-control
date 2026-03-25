import { FastifyInstance } from 'fastify';
import { eq, and, desc, gte, inArray, sql } from 'drizzle-orm';
import { deploymentRecords, websites, customers } from '../../db/schema.js';
import { DeploymentAggregator } from './aggregator.js';
import type { DeploymentQueryParams } from './types.js';

export default async function deploymentRoutes(app: FastifyInstance) {
  const db = app.db;
  const aggregator = new DeploymentAggregator(db);

  // List deployments with filtering
  app.get<{ Querystring: DeploymentQueryParams }>(
    '/deployments',
    async (request, reply) => {
      const { serviceId, provider, status, environment, branch, since, limit, offset } =
        request.query;

      const conditions: ReturnType<typeof eq>[] = [];

      if (serviceId) conditions.push(eq(deploymentRecords.websiteId, serviceId));
      if (provider) {
        const providers = Array.isArray(provider) ? provider : [provider];
        if (providers.length === 1) {
          conditions.push(eq(deploymentRecords.provider, providers[0]));
        } else if (providers.length > 1) {
          conditions.push(inArray(deploymentRecords.provider, providers));
        }
      }
      if (status) {
        const statuses = Array.isArray(status) ? status : [status];
        if (statuses.length === 1) {
          conditions.push(eq(deploymentRecords.status, statuses[0]));
        } else if (statuses.length > 1) {
          conditions.push(inArray(deploymentRecords.status, statuses));
        }
      }
      if (environment) {
        const envs = Array.isArray(environment) ? environment : [environment];
        if (envs.length === 1) {
          conditions.push(eq(deploymentRecords.environment, envs[0]));
        } else if (envs.length > 1) {
          conditions.push(inArray(deploymentRecords.environment, envs));
        }
      }
      if (branch) conditions.push(eq(deploymentRecords.branch, branch));
      if (since) conditions.push(gte(deploymentRecords.createdAt, since));

      const lim = limit ? parseInt(limit, 10) : 50;
      const off = offset ? parseInt(offset, 10) : 0;

      let query = db
        .select({
          id: deploymentRecords.id,
          websiteId: deploymentRecords.websiteId,
          provider: deploymentRecords.provider,
          externalId: deploymentRecords.externalId,
          status: deploymentRecords.status,
          environment: deploymentRecords.environment,
          branch: deploymentRecords.branch,
          commitSha: deploymentRecords.commitSha,
          commitMessage: deploymentRecords.commitMessage,
          author: deploymentRecords.author,
          url: deploymentRecords.url,
          startedAt: deploymentRecords.startedAt,
          completedAt: deploymentRecords.completedAt,
          buildDurationMs: deploymentRecords.buildDurationMs,
          metadata: deploymentRecords.metadata,
          createdAt: deploymentRecords.createdAt,
          updatedAt: deploymentRecords.updatedAt,
          serviceName: websites.name,
          customerName: customers.name,
        })
        .from(deploymentRecords)
        .leftJoin(websites, eq(deploymentRecords.websiteId, websites.id))
        .leftJoin(customers, eq(websites.customerId, customers.id));

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      const results = (query as any)
        .orderBy(desc(deploymentRecords.createdAt))
        .limit(lim)
        .offset(off)
        .all();

      return reply.send(results);
    }
  );

  // Get deployments for a specific service
  app.get<{ Params: { serviceId: string }; Querystring: { limit?: string } }>(
    '/services/:serviceId/deployments',
    async (request, reply) => {
      const lim = request.query.limit ? parseInt(request.query.limit, 10) : 20;
      const results = db
        .select()
        .from(deploymentRecords)
        .where(eq(deploymentRecords.websiteId, request.params.serviceId))
        .orderBy(desc(deploymentRecords.createdAt))
        .limit(lim)
        .all();
      return reply.send(results);
    }
  );

  // Get single deployment detail
  app.get<{ Params: { id: string } }>('/deployments/:id', async (request, reply) => {
    const rows = db
      .select()
      .from(deploymentRecords)
      .where(eq(deploymentRecords.id, request.params.id))
      .all();
    const deployment = rows[0];
    if (!deployment) {
      return reply.status(404).send({ error: 'Deployment not found' });
    }
    return reply.send(deployment);
  });

  // Get aggregated deployment stats
  app.get<{ Querystring: { serviceId?: string } }>(
    '/deployments/stats',
    async (request, reply) => {
      const stats = await aggregator.getStats(request.query.serviceId);
      return reply.send(stats);
    }
  );

  // Get deployment correlations
  app.get<{ Querystring: { serviceId?: string } }>(
    '/deployments/correlations',
    async (request, reply) => {
      const correlations = await aggregator.detectCorrelations(
        request.query.serviceId
      );
      return reply.send(correlations);
    }
  );
}
