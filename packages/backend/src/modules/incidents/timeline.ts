import { eq, desc } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { DB } from '../../db/client.js';
import { incidentEvents } from '../../db/schema.js';

export interface TimelineEvent {
  id: string;
  incidentId: string;
  type: string;
  message: string;
  source: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export async function addTimelineEvent(
  db: DB,
  incidentId: string,
  type: string,
  message: string,
  source: string = 'system',
  metadata?: Record<string, unknown>
): Promise<TimelineEvent> {
  const now = new Date().toISOString();
  const id = ulid();
  db.insert(incidentEvents)
    .values({
      id,
      incidentId,
      type,
      message,
      source,
      metadata: metadata || null,
      createdAt: now,
    })
    .run();

  const rows = db
    .select()
    .from(incidentEvents)
    .where(eq(incidentEvents.id, id))
    .all();
  return rows[0] as TimelineEvent;
}

export async function getTimeline(db: DB, incidentId: string): Promise<TimelineEvent[]> {
  return db
    .select()
    .from(incidentEvents)
    .where(eq(incidentEvents.incidentId, incidentId))
    .orderBy(desc(incidentEvents.createdAt))
    .all() as TimelineEvent[];
}
