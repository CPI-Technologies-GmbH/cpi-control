import { eq, and, like, sql, inArray, gte, desc } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { DB } from '../../db/client.js';
import {
  projects,
  websites,
  monitoringTargets,
  infrastructureBindings,
  repositoryBindings,
  deploymentSources,
  incidents,
  healthCheckResults,
  deploymentRecords,
} from '../../db/schema.js';
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

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function listProjects(db: DB) {
  return db.select().from(projects).all();
}

export async function getProject(db: DB, id: string) {
  const rows = db.select().from(projects).where(eq(projects.id, id)).all();
  return rows[0] || null;
}

export async function createProject(db: DB, body: CreateProjectBody) {
  const now = new Date().toISOString();
  const id = ulid();
  db.insert(projects)
    .values({
      id,
      name: body.name,
      slug: body.slug,
      icon: body.icon || null,
      contactEmail: body.contactEmail || null,
      contactPhone: body.contactPhone || null,
      notes: body.notes || null,
      metadata: body.metadata || null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getProject(db, id);
}

export async function updateProject(db: DB, id: string, body: UpdateProjectBody) {
  const now = new Date().toISOString();
  const existing = await getProject(db, id);
  if (!existing) return null;

  db.update(projects)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.slug !== undefined && { slug: body.slug }),
      ...(body.icon !== undefined && { icon: body.icon }),
      ...(body.contactEmail !== undefined && { contactEmail: body.contactEmail }),
      ...(body.contactPhone !== undefined && { contactPhone: body.contactPhone }),
      ...(body.notes !== undefined && { notes: body.notes }),
      ...(body.metadata !== undefined && { metadata: body.metadata }),
      updatedAt: now,
    })
    .where(eq(projects.id, id))
    .run();
  return getProject(db, id);
}

export async function deleteProject(db: DB, id: string) {
  const existing = await getProject(db, id);
  if (!existing) return false;
  db.delete(projects).where(eq(projects.id, id)).run();
  return true;
}

export async function getProjectStats(db: DB, projectId: string) {
  // Get all services for this project
  const projectServices = db
    .select()
    .from(websites)
    .where(eq(websites.projectId, projectId))
    .all();

  const serviceIds = projectServices.map((s) => s.id);
  const serviceCount = serviceIds.length;

  // Status breakdown
  const statusBreakdown = { healthy: 0, degraded: 0, down: 0, unknown: 0 };
  for (const svc of projectServices) {
    const status = svc.status as keyof typeof statusBreakdown;
    if (status in statusBreakdown) {
      statusBreakdown[status]++;
    } else {
      statusBreakdown.unknown++;
    }
  }

  // Open incidents count + recent incidents
  const allIncidents = serviceIds.length > 0
    ? db
        .select()
        .from(incidents)
        .where(inArray(incidents.websiteId, serviceIds))
        .orderBy(desc(incidents.detectedAt))
        .all()
    : [];

  const openIncidents = allIncidents.filter((i) => i.status === 'open').length;

  // Map service names onto incidents
  const serviceMap = new Map(projectServices.map((s) => [s.id, s.name]));
  const recentIncidents = allIncidents.slice(0, 5).map((i) => ({
    id: i.id,
    title: i.title,
    severity: i.severity,
    status: i.status,
    detectedAt: i.detectedAt,
    serviceName: serviceMap.get(i.websiteId) || 'Unknown',
    serviceId: i.websiteId,
  }));

  // Recent deployments
  const recentDeployments = serviceIds.length > 0
    ? db
        .select()
        .from(deploymentRecords)
        .where(inArray(deploymentRecords.websiteId, serviceIds))
        .orderBy(desc(deploymentRecords.createdAt))
        .limit(5)
        .all()
        .map((d) => ({
          id: d.id,
          status: d.status,
          provider: d.provider,
          branch: d.branch,
          environment: d.environment,
          createdAt: d.createdAt,
          serviceName: serviceMap.get(d.websiteId ?? '') || 'Unknown',
          serviceId: d.websiteId,
        }))
    : [];

  // Uptime calculation: healthy checks / total checks in last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const healthChecks = serviceIds.length > 0
    ? db
        .select()
        .from(healthCheckResults)
        .where(
          and(
            inArray(healthCheckResults.websiteId, serviceIds),
            gte(healthCheckResults.checkedAt, thirtyDaysAgo)
          )
        )
        .all()
    : [];

  const totalChecks = healthChecks.length;
  const healthyChecks = healthChecks.filter((c) => c.status === 'healthy').length;
  const uptimePercent30d = totalChecks > 0
    ? Math.round((healthyChecks / totalChecks) * 10000) / 100
    : null;

  // Avg response time from recent health checks
  const responseTimes = healthChecks
    .map((c) => c.responseTimeMs)
    .filter((t): t is number => t !== null && t !== undefined);
  const avgResponseTimeMs = responseTimes.length > 0
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : null;

  return {
    serviceCount,
    statusBreakdown,
    openIncidents,
    avgResponseTimeMs,
    uptimePercent30d,
    recentIncidents,
    recentDeployments,
  };
}

// ─── Services (formerly Websites) ────────────────────────────────────────────

export async function listServices(db: DB, params: ServiceQueryParams) {
  const conditions: ReturnType<typeof eq>[] = [];

  if (params.projectId) {
    conditions.push(eq(websites.projectId, params.projectId));
  }
  if (params.type) {
    conditions.push(eq(websites.type, params.type));
  }
  if (params.environment) {
    conditions.push(eq(websites.environment, params.environment));
  }
  if (params.hostingType) {
    conditions.push(eq(websites.hostingType, params.hostingType));
  }
  if (params.status) {
    conditions.push(eq(websites.status, params.status));
  }
  if (params.search) {
    conditions.push(
      sql`(${websites.name} LIKE ${'%' + params.search + '%'} OR ${websites.url} LIKE ${'%' + params.search + '%'})`
    );
  }
  // Exclude archived by default
  if (params.includeArchived !== 'true') {
    conditions.push(sql`(${websites.archived} = 0 OR ${websites.archived} IS NULL)`);
  }

  const limit = params.limit ? parseInt(params.limit, 10) : 50;
  const offset = params.offset ? parseInt(params.offset, 10) : 0;

  // Count total matching records (before limit/offset)
  const countConditions = [...conditions];
  let countQuery = db.select({ count: sql<number>`COUNT(*)` }).from(websites);
  if (countConditions.length > 0) {
    countQuery = countQuery.where(and(...countConditions)) as any;
  }
  const totalCount = (countQuery as any).all()[0]?.count || 0;

  let query = db
    .select({
      id: websites.id,
      projectId: websites.projectId,
      name: websites.name,
      type: websites.type,
      url: websites.url,
      environment: websites.environment,
      hostingType: websites.hostingType,
      status: websites.status,
      healthCheckUrl: websites.healthCheckUrl,
      expectedStatusCode: websites.expectedStatusCode,
      checkIntervalSeconds: websites.checkIntervalSeconds,
      tags: websites.tags,
      metadata: websites.metadata,
      archived: websites.archived,
      mutedUntil: websites.mutedUntil,
      createdAt: websites.createdAt,
      updatedAt: websites.updatedAt,
      projectName: projects.name,
    })
    .from(websites)
    .leftJoin(projects, eq(websites.projectId, projects.id));

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  let results = (query as any).limit(limit).offset(offset).all();

  // Enrich with latest health check data
  const serviceIds = results.map((r: any) => r.id);
  if (serviceIds.length > 0) {
    const latestChecks = db
      .select({
        websiteId: healthCheckResults.websiteId,
        checkedAt: sql<string>`MAX(${healthCheckResults.checkedAt})`,
        responseTimeMs: healthCheckResults.responseTimeMs,
      })
      .from(healthCheckResults)
      .where(inArray(healthCheckResults.websiteId, serviceIds))
      .groupBy(healthCheckResults.websiteId)
      .all();
    const checkMap = new Map(latestChecks.map((c) => [c.websiteId, c]));
    results = results.map((s: any) => {
      const check = checkMap.get(s.id);
      return {
        ...s,
        lastCheckedAt: check?.checkedAt || null,
        lastResponseTimeMs: check?.responseTimeMs || null,
      };
    });
  }

  // Filter by hasOpenIncident if requested
  if (params.hasOpenIncident !== undefined) {
    const wantOpen = params.hasOpenIncident === 'true';
    const openIncidents = db
      .select({ websiteId: incidents.websiteId })
      .from(incidents)
      .where(eq(incidents.status, 'open'))
      .all();
    const websiteIdsWithOpenIncidents = new Set(openIncidents.map((i) => i.websiteId));

    results = results.filter((w: any) =>
      wantOpen
        ? websiteIdsWithOpenIncidents.has(w.id)
        : !websiteIdsWithOpenIncidents.has(w.id)
    );
  }

  return { data: results, total: totalCount, limit, offset };
}

export async function getService(db: DB, id: string) {
  const rows = db.select().from(websites).where(eq(websites.id, id)).all();
  return rows[0] || null;
}

export async function createService(db: DB, body: CreateServiceBody) {
  const serviceType = body.type ?? 'website';

  // Validate: url is required when type is 'website'
  if (serviceType === 'website' && !body.url) {
    throw new Error('url is required when type is website');
  }

  const now = new Date().toISOString();
  const id = ulid();
  db.insert(websites)
    .values({
      id,
      projectId: body.projectId,
      name: body.name,
      type: serviceType,
      url: body.url || null,
      environment: body.environment,
      hostingType: body.hostingType,
      status: 'unknown',
      healthCheckUrl: body.healthCheckUrl || null,
      expectedStatusCode: body.expectedStatusCode ?? 200,
      checkIntervalSeconds: body.checkIntervalSeconds ?? 60,
      tags: body.tags || null,
      metadata: body.metadata || null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getService(db, id);
}

export async function updateService(db: DB, id: string, body: UpdateServiceBody) {
  const now = new Date().toISOString();
  const existing = await getService(db, id);
  if (!existing) return null;

  db.update(websites)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.type !== undefined && { type: body.type }),
      ...(body.url !== undefined && { url: body.url }),
      ...(body.environment !== undefined && { environment: body.environment }),
      ...(body.hostingType !== undefined && { hostingType: body.hostingType }),
      ...(body.status !== undefined && { status: body.status }),
      ...(body.healthCheckUrl !== undefined && { healthCheckUrl: body.healthCheckUrl }),
      ...(body.expectedStatusCode !== undefined && {
        expectedStatusCode: body.expectedStatusCode,
      }),
      ...(body.checkIntervalSeconds !== undefined && {
        checkIntervalSeconds: body.checkIntervalSeconds,
      }),
      ...(body.tags !== undefined && { tags: body.tags }),
      ...(body.metadata !== undefined && { metadata: body.metadata }),
      ...(body.projectId !== undefined && { projectId: body.projectId }),
      ...(body.archived !== undefined && { archived: body.archived }),
      ...(body.mutedUntil !== undefined && { mutedUntil: body.mutedUntil }),
      updatedAt: now,
    })
    .where(eq(websites.id, id))
    .run();
  return getService(db, id);
}

export async function deleteService(db: DB, id: string) {
  const existing = await getService(db, id);
  if (!existing) return false;
  db.delete(websites).where(eq(websites.id, id)).run();
  return true;
}

export async function batchDeleteServices(db: DB, ids: string[]) {
  db.delete(websites).where(inArray(websites.id, ids)).run();
  return { deleted: ids.length };
}

export async function batchUpdateServices(db: DB, body: BatchUpdateServicesBody) {
  const now = new Date().toISOString();
  const { ids, updates } = body;

  const setFields: Record<string, unknown> = { updatedAt: now };
  if (updates.environment !== undefined) setFields.environment = updates.environment;
  if (updates.type !== undefined) setFields.type = updates.type;
  if (updates.hostingType !== undefined) setFields.hostingType = updates.hostingType;
  if (updates.archived !== undefined) setFields.archived = updates.archived;
  if (updates.mutedUntil !== undefined) setFields.mutedUntil = updates.mutedUntil;

  db.update(websites)
    .set(setFields as any)
    .where(inArray(websites.id, ids))
    .run();

  return db
    .select()
    .from(websites)
    .where(inArray(websites.id, ids))
    .all();
}

// ─── Monitoring Targets ──────────────────────────────────────────────────────

export async function listMonitoringTargets(db: DB, serviceId?: string) {
  if (serviceId) {
    return db
      .select()
      .from(monitoringTargets)
      .where(eq(monitoringTargets.websiteId, serviceId))
      .all();
  }
  return db.select().from(monitoringTargets).all();
}

export async function getMonitoringTarget(db: DB, id: string) {
  const rows = db
    .select()
    .from(monitoringTargets)
    .where(eq(monitoringTargets.id, id))
    .all();
  return rows[0] || null;
}

export async function createMonitoringTarget(db: DB, body: CreateMonitoringTargetBody) {
  const now = new Date().toISOString();
  const id = ulid();
  db.insert(monitoringTargets)
    .values({
      id,
      websiteId: body.serviceId,
      type: body.type,
      target: body.target,
      checkIntervalSeconds: body.checkIntervalSeconds ?? 60,
      timeoutMs: body.timeoutMs ?? 10000,
      expectedStatusCode: body.expectedStatusCode ?? null,
      expectedBodyContains: body.expectedBodyContains ?? null,
      headers: body.headers ?? null,
      enabled: body.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getMonitoringTarget(db, id);
}

export async function updateMonitoringTarget(
  db: DB,
  id: string,
  body: UpdateMonitoringTargetBody
) {
  const now = new Date().toISOString();
  const existing = await getMonitoringTarget(db, id);
  if (!existing) return null;

  db.update(monitoringTargets)
    .set({
      ...(body.type !== undefined && { type: body.type }),
      ...(body.target !== undefined && { target: body.target }),
      ...(body.checkIntervalSeconds !== undefined && {
        checkIntervalSeconds: body.checkIntervalSeconds,
      }),
      ...(body.timeoutMs !== undefined && { timeoutMs: body.timeoutMs }),
      ...(body.expectedStatusCode !== undefined && {
        expectedStatusCode: body.expectedStatusCode,
      }),
      ...(body.expectedBodyContains !== undefined && {
        expectedBodyContains: body.expectedBodyContains,
      }),
      ...(body.headers !== undefined && { headers: body.headers }),
      ...(body.enabled !== undefined && { enabled: body.enabled }),
      updatedAt: now,
    })
    .where(eq(monitoringTargets.id, id))
    .run();
  return getMonitoringTarget(db, id);
}

export async function deleteMonitoringTarget(db: DB, id: string) {
  const existing = await getMonitoringTarget(db, id);
  if (!existing) return false;
  db.delete(monitoringTargets).where(eq(monitoringTargets.id, id)).run();
  return true;
}

// ─── Infrastructure Bindings ─────────────────────────────────────────────────

export async function listInfraBindings(db: DB, serviceId?: string) {
  if (serviceId) {
    return db
      .select()
      .from(infrastructureBindings)
      .where(eq(infrastructureBindings.websiteId, serviceId))
      .all();
  }
  return db.select().from(infrastructureBindings).all();
}

export async function getInfraBinding(db: DB, id: string) {
  const rows = db
    .select()
    .from(infrastructureBindings)
    .where(eq(infrastructureBindings.id, id))
    .all();
  return rows[0] || null;
}

export async function createInfraBinding(db: DB, body: CreateInfraBindingBody) {
  const now = new Date().toISOString();
  const id = ulid();
  db.insert(infrastructureBindings)
    .values({
      id,
      websiteId: body.serviceId,
      provider: body.provider,
      externalId: body.externalId,
      region: body.region ?? null,
      resourceType: body.resourceType ?? null,
      metadata: body.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getInfraBinding(db, id);
}

export async function deleteInfraBinding(db: DB, id: string) {
  const existing = await getInfraBinding(db, id);
  if (!existing) return false;
  db.delete(infrastructureBindings).where(eq(infrastructureBindings.id, id)).run();
  return true;
}

// ─── Repository Bindings ─────────────────────────────────────────────────────

export async function listRepoBindings(db: DB, serviceId?: string) {
  if (serviceId) {
    return db
      .select()
      .from(repositoryBindings)
      .where(eq(repositoryBindings.websiteId, serviceId))
      .all();
  }
  return db.select().from(repositoryBindings).all();
}

export async function getRepoBinding(db: DB, id: string) {
  const rows = db
    .select()
    .from(repositoryBindings)
    .where(eq(repositoryBindings.id, id))
    .all();
  return rows[0] || null;
}

export async function createRepoBinding(db: DB, body: CreateRepoBindingBody) {
  const now = new Date().toISOString();
  const id = ulid();
  db.insert(repositoryBindings)
    .values({
      id,
      websiteId: body.serviceId,
      provider: body.provider,
      owner: body.owner,
      repo: body.repo,
      defaultBranch: body.defaultBranch ?? 'main',
      metadata: body.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getRepoBinding(db, id);
}

export async function deleteRepoBinding(db: DB, id: string) {
  const existing = await getRepoBinding(db, id);
  if (!existing) return false;
  db.delete(repositoryBindings).where(eq(repositoryBindings.id, id)).run();
  return true;
}

// ─── Deployment Sources ──────────────────────────────────────────────────────

export async function listDeploymentSources(db: DB, serviceId?: string) {
  if (serviceId) {
    return db
      .select()
      .from(deploymentSources)
      .where(eq(deploymentSources.websiteId, serviceId))
      .all();
  }
  return db.select().from(deploymentSources).all();
}

export async function getDeploymentSource(db: DB, id: string) {
  const rows = db
    .select()
    .from(deploymentSources)
    .where(eq(deploymentSources.id, id))
    .all();
  return rows[0] || null;
}

export async function createDeploymentSource(db: DB, body: CreateDeploymentSourceBody) {
  const now = new Date().toISOString();
  const id = ulid();
  db.insert(deploymentSources)
    .values({
      id,
      websiteId: body.serviceId,
      provider: body.provider,
      externalProjectId: body.externalProjectId ?? null,
      pipelineName: body.pipelineName ?? null,
      autoDeploy: body.autoDeploy ?? false,
      metadata: body.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getDeploymentSource(db, id);
}

export async function deleteDeploymentSource(db: DB, id: string) {
  const existing = await getDeploymentSource(db, id);
  if (!existing) return false;
  db.delete(deploymentSources).where(eq(deploymentSources.id, id)).run();
  return true;
}
