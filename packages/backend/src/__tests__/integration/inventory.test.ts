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

// Helper to create a customer through the API
async function createCustomer(overrides: Record<string, unknown> = {}) {
  const body = {
    name: 'Test Customer',
    slug: 'test-customer',
    contactEmail: 'test@example.com',
    ...overrides,
  };
  const res = await app.inject({
    method: 'POST',
    url: '/api/inventory/customers',
    payload: body,
  });
  return { res, body };
}

// Helper to create a service through the API (requires an existing customer ID)
async function createService(customerId: string, overrides: Record<string, unknown> = {}) {
  const body = {
    customerId,
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

describe('Inventory API - Customers', () => {
  it('should create a customer and list it', async () => {
    const { res } = await createCustomer();
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.name).toBe('Test Customer');
    expect(created.slug).toBe('test-customer');
    expect(created.id).toBeDefined();

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/inventory/customers',
    });
    expect(listRes.statusCode).toBe(200);
    const customers = listRes.json();
    expect(customers).toHaveLength(1);
    expect(customers[0].id).toBe(created.id);
  });

  it('should update a customer', async () => {
    const { res: createRes } = await createCustomer();
    const customer = createRes.json();

    const updateRes = await app.inject({
      method: 'PUT',
      url: `/api/inventory/customers/${customer.id}`,
      payload: { name: 'Updated Customer', contactEmail: 'updated@example.com' },
    });
    expect(updateRes.statusCode).toBe(200);
    const updated = updateRes.json();
    expect(updated.name).toBe('Updated Customer');
    expect(updated.contactEmail).toBe('updated@example.com');
    expect(updated.slug).toBe('test-customer'); // slug unchanged
  });

  it('should delete a customer', async () => {
    const { res: createRes } = await createCustomer();
    const customer = createRes.json();

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/inventory/customers/${customer.id}`,
    });
    expect(deleteRes.statusCode).toBe(204);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/inventory/customers/${customer.id}`,
    });
    expect(getRes.statusCode).toBe(404);
  });

  it('should return 404 when updating non-existent customer', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/inventory/customers/nonexistent',
      payload: { name: 'Updated' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('should return 400 when creating customer without required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/inventory/customers',
      payload: { name: 'No Slug' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Inventory API - Services', () => {
  it('should create a service with monitoring target and get full detail', async () => {
    const { res: custRes } = await createCustomer();
    const customer = custRes.json();

    const { res: svcRes } = await createService(customer.id);
    expect(svcRes.statusCode).toBe(201);
    const service = svcRes.json();
    expect(service.name).toBe('My Service');
    expect(service.customerId).toBe(customer.id);
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
    const { res: custRes } = await createCustomer();
    const customer = custRes.json();
    const { res: svcRes } = await createService(customer.id);
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
    const { res: custRes } = await createCustomer();
    const customer = custRes.json();

    await createService(customer.id, { name: 'Prod Site', environment: 'production' });
    await createService(customer.id, { name: 'Staging Site', environment: 'staging' });

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
    const { res: custRes } = await createCustomer();
    const customer = custRes.json();

    const { res: svcRes } = await createService(customer.id, { name: 'Site A' });
    const serviceA = svcRes.json();

    // Update status to healthy
    await app.inject({
      method: 'PUT',
      url: `/api/inventory/services/${serviceA.id}`,
      payload: { status: 'healthy' },
    });

    await createService(customer.id, { name: 'Site B' });

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
    const { res: custRes } = await createCustomer();
    const customer = custRes.json();

    await createService(customer.id, { name: 'Alpha Portal' });
    await createService(customer.id, { name: 'Beta Dashboard' });

    const searchRes = await app.inject({
      method: 'GET',
      url: '/api/inventory/services?search=Alpha',
    });
    expect(searchRes.statusCode).toBe(200);
    const results = searchRes.json();
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Alpha Portal');
  });

  it('should cascade delete services when customer is deleted', async () => {
    const { res: custRes } = await createCustomer();
    const customer = custRes.json();

    const { res: svcRes } = await createService(customer.id, { name: 'Will Be Deleted' });
    const service = svcRes.json();

    // Confirm service exists
    const beforeRes = await app.inject({
      method: 'GET',
      url: `/api/inventory/services/${service.id}`,
    });
    expect(beforeRes.statusCode).toBe(200);

    // Delete the customer
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/inventory/customers/${customer.id}`,
    });
    expect(deleteRes.statusCode).toBe(204);

    // Service should be gone (cascade)
    const afterRes = await app.inject({
      method: 'GET',
      url: `/api/inventory/services/${service.id}`,
    });
    expect(afterRes.statusCode).toBe(404);
  });
});
