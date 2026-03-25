import { describe, it, expect, beforeEach } from 'vitest';
import { IncidentDetector } from '../../modules/incidents/service.js';
import { createDatabase, runMigrations, type DB } from '../../db/client.js';
import { projects, websites, incidents } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';

let db: DB;
let detector: IncidentDetector;
let serviceId: string;

function seedService(): string {
  const now = new Date().toISOString();
  const custId = ulid();
  const svcId = ulid();

  db.insert(projects)
    .values({
      id: custId,
      name: 'Test Project',
      slug: 'test-proj-' + custId.slice(-6),
      createdAt: now,
      updatedAt: now,
    })
    .run();

  db.insert(websites)
    .values({
      id: svcId,
      projectId: custId,
      name: 'Test Service',
      url: 'https://test.example.com',
      environment: 'production',
      hostingType: 'vercel',
      status: 'unknown',
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return svcId;
}

beforeEach(() => {
  db = createDatabase(':memory:');
  runMigrations(db);
  serviceId = seedService();
  detector = new IncidentDetector(db, { failureThreshold: 3, recoveryThreshold: 2 });
});

describe('IncidentDetector', () => {
  it('should not create incident on first failure', async () => {
    const result = await detector.processHealthCheck(serviceId, 'down', {
      errorMessage: 'Connection refused',
    });
    expect(result.incidentCreated).toBeUndefined();

    // Website status should be updated to 'down'
    const site = db.select().from(websites).where(eq(websites.id, serviceId)).all()[0];
    expect(site.status).toBe('down');
  });

  it('should not create incident on second consecutive failure', async () => {
    await detector.processHealthCheck(serviceId, 'down');
    const result = await detector.processHealthCheck(serviceId, 'down');
    expect(result.incidentCreated).toBeUndefined();
  });

  it('should create incident after failureThreshold consecutive failures', async () => {
    await detector.processHealthCheck(serviceId, 'down');
    await detector.processHealthCheck(serviceId, 'down');
    const result = await detector.processHealthCheck(serviceId, 'down');

    expect(result.incidentCreated).toBeDefined();

    // Verify the incident exists in the DB
    const incidentRows = db.select().from(incidents).where(eq(incidents.id, result.incidentCreated!)).all();
    expect(incidentRows).toHaveLength(1);
    expect(incidentRows[0].status).toBe('open');
    expect(incidentRows[0].severity).toBe('critical');
    expect(incidentRows[0].websiteId).toBe(serviceId);
  });

  it('should not create a second incident when one is already open', async () => {
    // Create the first incident
    await detector.processHealthCheck(serviceId, 'down');
    await detector.processHealthCheck(serviceId, 'down');
    const firstResult = await detector.processHealthCheck(serviceId, 'down');
    expect(firstResult.incidentCreated).toBeDefined();

    // Continue failing - should not create another incident
    const fourthResult = await detector.processHealthCheck(serviceId, 'down');
    expect(fourthResult.incidentCreated).toBeUndefined();

    const fifthResult = await detector.processHealthCheck(serviceId, 'down');
    expect(fifthResult.incidentCreated).toBeUndefined();
  });

  it('should resolve incident after recoveryThreshold consecutive successes', async () => {
    // First create an incident
    await detector.processHealthCheck(serviceId, 'down');
    await detector.processHealthCheck(serviceId, 'down');
    const createResult = await detector.processHealthCheck(serviceId, 'down');
    const incidentId = createResult.incidentCreated!;
    expect(incidentId).toBeDefined();

    // Send healthy checks: 1st healthy won't resolve yet
    const rec1 = await detector.processHealthCheck(serviceId, 'healthy');
    expect(rec1.incidentResolved).toBeUndefined();

    // 2nd healthy reaches recovery threshold and should resolve
    const rec2 = await detector.processHealthCheck(serviceId, 'healthy');
    expect(rec2.incidentResolved).toBe(incidentId);

    // Verify incident is resolved in DB
    const resolved = db.select().from(incidents).where(eq(incidents.id, incidentId)).all()[0];
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedBy).toBe('system');

    // Verify website is back to healthy
    const site = db.select().from(websites).where(eq(websites.id, serviceId)).all()[0];
    expect(site.status).toBe('healthy');
  });

  it('should mark degraded when status is degraded', async () => {
    await detector.processHealthCheck(serviceId, 'degraded');

    const site = db.select().from(websites).where(eq(websites.id, serviceId)).all()[0];
    expect(site.status).toBe('degraded');
  });

  it('should create warning-severity incident for degraded status', async () => {
    await detector.processHealthCheck(serviceId, 'degraded');
    await detector.processHealthCheck(serviceId, 'degraded');
    const result = await detector.processHealthCheck(serviceId, 'degraded');

    expect(result.incidentCreated).toBeDefined();
    const incidentRow = db.select().from(incidents).where(eq(incidents.id, result.incidentCreated!)).all()[0];
    expect(incidentRow.severity).toBe('warning');
  });

  it('should reset failure counter on success', async () => {
    // 2 failures, then a success, then 2 more failures - should NOT create incident
    await detector.processHealthCheck(serviceId, 'down');
    await detector.processHealthCheck(serviceId, 'down');
    await detector.processHealthCheck(serviceId, 'healthy'); // resets counter

    await detector.processHealthCheck(serviceId, 'down');
    const result = await detector.processHealthCheck(serviceId, 'down');
    // Only 2 consecutive failures, not 3 - so no incident yet
    expect(result.incidentCreated).toBeUndefined();
  });

  it('should reset recovery counter on failure during recovery', async () => {
    // Create incident
    await detector.processHealthCheck(serviceId, 'down');
    await detector.processHealthCheck(serviceId, 'down');
    const createResult = await detector.processHealthCheck(serviceId, 'down');
    expect(createResult.incidentCreated).toBeDefined();

    // 1 recovery, then a failure (resets recovery counter)
    await detector.processHealthCheck(serviceId, 'healthy');
    await detector.processHealthCheck(serviceId, 'down'); // resets recovery

    // 1 more recovery should not resolve since counter was reset
    const rec1 = await detector.processHealthCheck(serviceId, 'healthy');
    expect(rec1.incidentResolved).toBeUndefined();
  });
});
