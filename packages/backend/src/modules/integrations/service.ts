import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { DB } from '../../db/client.js';
import { integrationConfigs } from '../../db/schema.js';

export interface CreateIntegrationBody {
  provider: string;
  name: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  syncIntervalSeconds?: number;
}

export interface UpdateIntegrationBody {
  name?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  syncIntervalSeconds?: number;
}

export async function listIntegrations(db: DB) {
  return db.select().from(integrationConfigs).all();
}

export async function getIntegration(db: DB, id: string) {
  const rows = db.select().from(integrationConfigs).where(eq(integrationConfigs.id, id)).all();
  return rows[0] || null;
}

export async function getIntegrationByProvider(db: DB, provider: string) {
  const rows = db
    .select()
    .from(integrationConfigs)
    .where(eq(integrationConfigs.provider, provider))
    .all();
  return rows;
}

export async function createIntegration(db: DB, body: CreateIntegrationBody) {
  const now = new Date().toISOString();
  const id = ulid();
  db.insert(integrationConfigs)
    .values({
      id,
      provider: body.provider,
      name: body.name,
      enabled: body.enabled ?? true,
      config: body.config ?? null,
      syncIntervalSeconds: body.syncIntervalSeconds ?? 300,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getIntegration(db, id);
}

export async function updateIntegration(db: DB, id: string, body: UpdateIntegrationBody) {
  const now = new Date().toISOString();
  const existing = await getIntegration(db, id);
  if (!existing) return null;

  db.update(integrationConfigs)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.enabled !== undefined && { enabled: body.enabled }),
      ...(body.config !== undefined && { config: body.config }),
      ...(body.syncIntervalSeconds !== undefined && {
        syncIntervalSeconds: body.syncIntervalSeconds,
      }),
      updatedAt: now,
    })
    .where(eq(integrationConfigs.id, id))
    .run();
  return getIntegration(db, id);
}

export async function deleteIntegration(db: DB, id: string) {
  const existing = await getIntegration(db, id);
  if (!existing) return false;
  db.delete(integrationConfigs).where(eq(integrationConfigs.id, id)).run();
  return true;
}

export async function updateSyncStatus(
  db: DB,
  id: string,
  status: string,
  error?: string
) {
  const now = new Date().toISOString();
  db.update(integrationConfigs)
    .set({
      lastSyncAt: now,
      lastSyncStatus: status,
      lastSyncError: error || null,
      updatedAt: now,
    })
    .where(eq(integrationConfigs.id, id))
    .run();
}
