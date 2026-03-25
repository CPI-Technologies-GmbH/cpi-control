import { eq, and, like, sql, inArray } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { DB } from '../../db/client.js';
import {
  customers,
  websites,
  monitoringTargets,
  infrastructureBindings,
  repositoryBindings,
  deploymentSources,
  incidents,
} from '../../db/schema.js';
import type {
  CreateCustomerBody,
  UpdateCustomerBody,
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

// ─── Customers ───────────────────────────────────────────────────────────────

export async function listCustomers(db: DB) {
  return db.select().from(customers).all();
}

export async function getCustomer(db: DB, id: string) {
  const rows = db.select().from(customers).where(eq(customers.id, id)).all();
  return rows[0] || null;
}

export async function createCustomer(db: DB, body: CreateCustomerBody) {
  const now = new Date().toISOString();
  const id = ulid();
  db.insert(customers)
    .values({
      id,
      name: body.name,
      slug: body.slug,
      contactEmail: body.contactEmail || null,
      contactPhone: body.contactPhone || null,
      notes: body.notes || null,
      metadata: body.metadata || null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getCustomer(db, id);
}

export async function updateCustomer(db: DB, id: string, body: UpdateCustomerBody) {
  const now = new Date().toISOString();
  const existing = await getCustomer(db, id);
  if (!existing) return null;

  db.update(customers)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.slug !== undefined && { slug: body.slug }),
      ...(body.contactEmail !== undefined && { contactEmail: body.contactEmail }),
      ...(body.contactPhone !== undefined && { contactPhone: body.contactPhone }),
      ...(body.notes !== undefined && { notes: body.notes }),
      ...(body.metadata !== undefined && { metadata: body.metadata }),
      updatedAt: now,
    })
    .where(eq(customers.id, id))
    .run();
  return getCustomer(db, id);
}

export async function deleteCustomer(db: DB, id: string) {
  const existing = await getCustomer(db, id);
  if (!existing) return false;
  db.delete(customers).where(eq(customers.id, id)).run();
  return true;
}

// ─── Services (formerly Websites) ────────────────────────────────────────────

export async function listServices(db: DB, params: ServiceQueryParams) {
  const conditions: ReturnType<typeof eq>[] = [];

  if (params.customerId) {
    conditions.push(eq(websites.customerId, params.customerId));
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

  const limit = params.limit ? parseInt(params.limit, 10) : 100;
  const offset = params.offset ? parseInt(params.offset, 10) : 0;

  let query = db.select().from(websites);

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  let results = (query as any).limit(limit).offset(offset).all();

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

  return results;
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
      customerId: body.customerId,
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

export async function batchUpdateServices(db: DB, body: BatchUpdateServicesBody) {
  const now = new Date().toISOString();
  const { ids, updates } = body;

  const setFields: Record<string, unknown> = { updatedAt: now };
  if (updates.environment !== undefined) setFields.environment = updates.environment;
  if (updates.type !== undefined) setFields.type = updates.type;
  if (updates.hostingType !== undefined) setFields.hostingType = updates.hostingType;

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
