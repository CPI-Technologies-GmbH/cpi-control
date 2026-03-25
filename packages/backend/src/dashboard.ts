import { FastifyInstance } from 'fastify';
import { eq, and, gte, sql } from 'drizzle-orm';
import {
  websites,
  projects,
  incidents,
  deploymentRecords,
  healthCheckResults,
  remoteAgents,
} from './db/schema.js';

export async function dashboardRoutes(app: FastifyInstance) {
  const db = app.db;

  // GET /api/dashboard/summary
  app.get('/dashboard/summary', async (_request, reply) => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    // Total services
    const allServices = db.select().from(websites).all();
    const totalServices = allServices.length;

    // Service status counts
    const downCount = allServices.filter((w) => w.status === 'down').length;
    const degradedCount = allServices.filter((w) => w.status === 'degraded').length;
    const healthyCount = allServices.filter((w) => w.status === 'healthy').length;
    const unknownCount = allServices.filter((w) => w.status === 'unknown').length;

    // Incidents in last 24h
    const recentIncidents = db
      .select()
      .from(incidents)
      .where(gte(incidents.detectedAt, oneDayAgo))
      .all();
    const incidentsLast24h = recentIncidents.length;
    const openIncidents = db
      .select()
      .from(incidents)
      .where(eq(incidents.status, 'open'))
      .all().length;

    // Active deployments (pending, building, deploying)
    const activeDeployments = db
      .select()
      .from(deploymentRecords)
      .where(
        sql`${deploymentRecords.status} IN ('pending', 'building', 'deploying')`
      )
      .all().length;

    // Deployments in last 24h
    const deploymentsLast24h = db
      .select()
      .from(deploymentRecords)
      .where(gte(deploymentRecords.createdAt, oneDayAgo))
      .all().length;

    // Agent status
    const agents = db.select().from(remoteAgents).all();
    const agentStatus = {
      total: agents.length,
      online: agents.filter((a) => a.status === 'online').length,
      offline: agents.filter((a) => a.status === 'offline').length,
      error: agents.filter((a) => a.status === 'error').length,
    };

    // Total projects
    const totalProjects = db.select().from(projects).all().length;

    return reply.send({
      totalServices,
      totalProjects,
      serviceStatus: {
        healthy: healthyCount,
        degraded: degradedCount,
        down: downCount,
        unknown: unknownCount,
      },
      incidentsLast24h,
      openIncidents,
      activeDeployments,
      deploymentsLast24h,
      agentStatus,
      generatedAt: now.toISOString(),
    });
  });

  // GET /api/dashboard/health-overview
  app.get('/dashboard/health-overview', async (_request, reply) => {
    const allServices = db
      .select({
        id: websites.id,
        name: websites.name,
        url: websites.url,
        status: websites.status,
        environment: websites.environment,
        hostingType: websites.hostingType,
        projectId: websites.projectId,
      })
      .from(websites)
      .all();

    // Get latest health check for each service
    const result = [];

    for (const service of allServices) {
      // Get project name
      let projectName = 'Unassigned';
      if (service.projectId) {
        const projectRows = db
          .select({ name: projects.name })
          .from(projects)
          .where(eq(projects.id, service.projectId))
          .all();
        projectName = projectRows[0]?.name || 'Unknown';
      }

      // Get latest health check
      const latestChecks = db
        .select()
        .from(healthCheckResults)
        .where(eq(healthCheckResults.websiteId, service.id))
        .orderBy(sql`${healthCheckResults.checkedAt} DESC`)
        .limit(1)
        .all();

      const latestCheck = latestChecks[0] || null;

      // Get open incident count
      const openIncidentCount = db
        .select()
        .from(incidents)
        .where(
          and(
            eq(incidents.websiteId, service.id),
            eq(incidents.status, 'open')
          )
        )
        .all().length;

      result.push({
        id: service.id,
        name: service.name,
        url: service.url,
        status: service.status,
        environment: service.environment,
        hostingType: service.hostingType,
        projectName,
        lastCheck: latestCheck
          ? {
              status: latestCheck.status,
              statusCode: latestCheck.statusCode,
              responseTimeMs: latestCheck.responseTimeMs,
              checkedAt: latestCheck.checkedAt,
              errorMessage: latestCheck.errorMessage,
            }
          : null,
        openIncidents: openIncidentCount,
      });
    }

    // Sort: down first, then degraded, then healthy, then unknown
    const statusOrder: Record<string, number> = {
      down: 0,
      degraded: 1,
      unknown: 2,
      healthy: 3,
    };

    result.sort(
      (a, b) =>
        (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99)
    );

    return reply.send(result);
  });
}
