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

// Helper to create a project through the API
async function createProject(overrides: Record<string, unknown> = {}) {
  const body = {
    name: 'Test Project',
    slug: 'test-project',
    contactEmail: 'test@example.com',
    ...overrides,
  };
  const res = await app.inject({
    method: 'POST',
    url: '/api/inventory/projects',
    payload: body,
  });
  return { res, body };
}

// Helper to create a service through the API (requires an existing project ID)
async function createService(projectId: string, overrides: Record<string, unknown> = {}) {
  const body = {
    projectId,
    name: 'My Service',
    url: 'https://example.com',
    environment: 'production',
    hostingType: 'vercel',
    ...overrides,
  };
  const res = await app.inject({
    method: 'POST',
    url: '/api/inventory/services',
    payload: body,
  });
  return { res, body };
}

describe('Inventory API - Projects', () => {
  it('should create a project and list it', async () => {
    const { res } = await createProject();
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.name).toBe('Test Project');
    expect(created.slug).toBe('test-project');
    expect(created.id).toBeDefined();

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/inventory/projects',
    });
    expect(listRes.statusCode).toBe(200);
    const projects = listRes.json();
    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe(created.id);
  });

  it('should update a project', async () => {
    const { res: createRes } = await createProject();
    const project = createRes.json();

    const updateRes = await app.inject({
      method: 'PUT',
      url: `/api/inventory/projects/${project.id}`,
      payload: { name: 'Updated Project', contactEmail: 'updated@example.com' },
    });
    expect(updateRes.statusCode).toBe(200);
    const updated = updateRes.json();
    expect(updated.name).toBe('Updated Project');
    expect(updated.contactEmail).toBe('updated@example.com');
    expect(updated.slug).toBe('test-project'); // slug unchanged
  });

  it('should delete a project', async () => {
    const { res: createRes } = await createProject();
    const project = createRes.json();

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/inventory/projects/${project.id}`,
    });
    expect(deleteRes.statusCode).toBe(204);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/inventory/projects/${project.id}`,
    });
    expect(getRes.statusCode).toBe(404);
  });

  it('should return 404 when updating non-existent project', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/inventory/projects/nonexistent',
      payload: { name: 'Updated' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('should return 400 when creating project without required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/inventory/projects',
      payload: { name: 'No Slug' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Inventory API - Services', () => {
  it('should create a service with monitoring target and get full detail', async () => {
    const { res: projRes } = await createProject();
    const project = projRes.json();

    const { res: svcRes } = await createService(project.id);
    expect(svcRes.statusCode).toBe(201);
    const service = svcRes.json();
    expect(service.name).toBe('My Service');
    expect(service.projectId).toBe(project.id);
    expect(service.status).toBe('unknown');

    // Create a monitoring target for this service
    const mtRes = await app.inject({
      method: 'POST',
      url: '/api/inventory/monitoring-targets',
      payload: {
        serviceId: service.id,
        type: 'http',
        target: 'https://example.com/health',
        checkIntervalSeconds: 30,
      },
    });
    expect(mtRes.statusCode).toBe(201);
    const mt = mtRes.json();
    expect(mt.websiteId).toBe(service.id);
    expect(mt.type).toBe('http');
    expect(mt.target).toBe('https://example.com/health');

    // Get service detail
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/inventory/services/${service.id}`,
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json();
    expect(detail.id).toBe(service.id);
    expect(detail.name).toBe('My Service');
  });

  it('should create service, then create infra binding', async () => {
    const { res: projRes } = await createProject();
    const project = projRes.json();
    const { res: svcRes } = await createService(project.id);
    const service = svcRes.json();

    const bindRes = await app.inject({
      method: 'POST',
      url: '/api/inventory/infra-bindings',
      payload: {
        serviceId: service.id,
        provider: 'vercel',
        externalId: 'prj_abc123',
        region: 'iad1',
        resourceType: 'project',
      },
    });
    expect(bindRes.statusCode).toBe(201);
    const binding = bindRes.json();
    expect(binding.websiteId).toBe(service.id);
    expect(binding.provider).toBe('vercel');
    expect(binding.externalId).toBe('prj_abc123');
    expect(binding.region).toBe('iad1');

    // List infra bindings by serviceId
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/inventory/infra-bindings?serviceId=${service.id}`,
    });
    expect(listRes.statusCode).toBe(200);
    const bindings = listRes.json();
    expect(bindings).toHaveLength(1);
    expect(bindings[0].id).toBe(binding.id);
  });

  it('should filter services by environment', async () => {
    const { res: projRes } = await createProject();
    const project = projRes.json();

    await createService(project.id, { name: 'Prod Site', environment: 'production' });
    await createService(project.id, { name: 'Staging Site', environment: 'staging' });

    const prodRes = await app.inject({
      method: 'GET',
      url: '/api/inventory/services?environment=production',
    });
    expect(prodRes.statusCode).toBe(200);
    const prodSites = prodRes.json();
    expect(prodSites).toHaveLength(1);
    expect(prodSites[0].name).toBe('Prod Site');

    const stagingRes = await app.inject({
      method: 'GET',
      url: '/api/inventory/services?environment=staging',
    });
    expect(stagingRes.statusCode).toBe(200);
    const stagingSites = stagingRes.json();
    expect(stagingSites).toHaveLength(1);
    expect(stagingSites[0].name).toBe('Staging Site');
  });

  it('should filter services by status', async () => {
    const { res: projRes } = await createProject();
    const project = projRes.json();

    const { res: svcRes } = await createService(project.id, { name: 'Site A' });
    const serviceA = svcRes.json();

    // Update status to healthy
    await app.inject({
      method: 'PUT',
      url: `/api/inventory/services/${serviceA.id}`,
      payload: { status: 'healthy' },
    });

    await createService(project.id, { name: 'Site B' });

    const healthyRes = await app.inject({
      method: 'GET',
      url: '/api/inventory/services?status=healthy',
    });
    expect(healthyRes.statusCode).toBe(200);
    const healthySites = healthyRes.json();
    expect(healthySites).toHaveLength(1);
    expect(healthySites[0].name).toBe('Site A');

    const unknownRes = await app.inject({
      method: 'GET',
      url: '/api/inventory/services?status=unknown',
    });
    expect(unknownRes.statusCode).toBe(200);
    const unknownSites = unknownRes.json();
    expect(unknownSites).toHaveLength(1);
    expect(unknownSites[0].name).toBe('Site B');
  });

  it('should search services by name', async () => {
    const { res: projRes } = await createProject();
    const project = projRes.json();

    await createService(project.id, { name: 'Alpha Portal' });
    await createService(project.id, { name: 'Beta Dashboard' });

    const searchRes = await app.inject({
      method: 'GET',
      url: '/api/inventory/services?search=Alpha',
    });
    expect(searchRes.statusCode).toBe(200);
    const results = searchRes.json();
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Alpha Portal');
  });

  it('should set projectId null when project is deleted', async () => {
    const { res: projRes } = await createProject();
    const project = projRes.json();

    const { res: svcRes } = await createService(project.id, { name: 'Will Be Orphaned' });
    const service = svcRes.json();

    // Confirm service exists
    const beforeRes = await app.inject({
      method: 'GET',
      url: `/api/inventory/services/${service.id}`,
    });
    expect(beforeRes.statusCode).toBe(200);

    // Delete the project
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/inventory/projects/${project.id}`,
    });
    expect(deleteRes.statusCode).toBe(204);

    // Service should still exist (projectId is set null, not cascade)
    const afterRes = await app.inject({
      method: 'GET',
      url: `/api/inventory/services/${service.id}`,
    });
    expect(afterRes.statusCode).toBe(200);
    const afterService = afterRes.json();
    expect(afterService.projectId).toBeNull();
  });
});
