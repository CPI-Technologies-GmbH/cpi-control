import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { DB } from '../../db/client.js';
import { notificationRules } from '../../db/schema.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('notifications');

export interface CreateNotificationRuleBody {
  name: string;
  enabled?: boolean;
  eventType: string;
  severity?: string;
  channel: string;
  channelConfig?: Record<string, unknown>;
  cooldownMinutes?: number;
  serviceFilter?: string[];
  customerFilter?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateNotificationRuleBody {
  name?: string;
  enabled?: boolean;
  eventType?: string;
  severity?: string;
  channel?: string;
  channelConfig?: Record<string, unknown>;
  cooldownMinutes?: number;
  serviceFilter?: string[];
  customerFilter?: string[];
  metadata?: Record<string, unknown>;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function listRules(db: DB) {
  return db.select().from(notificationRules).all();
}

export async function getRule(db: DB, id: string) {
  const rows = db.select().from(notificationRules).where(eq(notificationRules.id, id)).all();
  return rows[0] || null;
}

export async function createRule(db: DB, body: CreateNotificationRuleBody) {
  const now = new Date().toISOString();
  const id = ulid();
  db.insert(notificationRules)
    .values({
      id,
      name: body.name,
      enabled: body.enabled ?? true,
      eventType: body.eventType,
      severity: body.severity || null,
      channel: body.channel,
      channelConfig: body.channelConfig || null,
      cooldownMinutes: body.cooldownMinutes ?? 15,
      websiteFilter: body.serviceFilter || null,
      customerFilter: body.customerFilter || null,
      metadata: body.metadata || null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getRule(db, id);
}

export async function updateRule(db: DB, id: string, body: UpdateNotificationRuleBody) {
  const now = new Date().toISOString();
  const existing = await getRule(db, id);
  if (!existing) return null;

  db.update(notificationRules)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.enabled !== undefined && { enabled: body.enabled }),
      ...(body.eventType !== undefined && { eventType: body.eventType }),
      ...(body.severity !== undefined && { severity: body.severity }),
      ...(body.channel !== undefined && { channel: body.channel }),
      ...(body.channelConfig !== undefined && { channelConfig: body.channelConfig }),
      ...(body.cooldownMinutes !== undefined && { cooldownMinutes: body.cooldownMinutes }),
      ...(body.serviceFilter !== undefined && { websiteFilter: body.serviceFilter }),
      ...(body.customerFilter !== undefined && { customerFilter: body.customerFilter }),
      ...(body.metadata !== undefined && { metadata: body.metadata }),
      updatedAt: now,
    })
    .where(eq(notificationRules.id, id))
    .run();
  return getRule(db, id);
}

export async function deleteRule(db: DB, id: string) {
  const existing = await getRule(db, id);
  if (!existing) return false;
  db.delete(notificationRules).where(eq(notificationRules.id, id)).run();
  return true;
}

// ─── Notification Service with Cooldown ──────────────────────────────────────

export class NotificationService {
  private db: DB;
  private senders = new Map<string, (config: Record<string, unknown>, message: string, details: Record<string, unknown>) => Promise<boolean>>();

  constructor(db: DB) {
    this.db = db;
  }

  registerSender(
    channel: string,
    sender: (config: Record<string, unknown>, message: string, details: Record<string, unknown>) => Promise<boolean>
  ) {
    this.senders.set(channel, sender);
  }

  async notify(
    eventType: string,
    message: string,
    details: Record<string, unknown> = {}
  ): Promise<{ sent: number; skipped: number; errors: string[] }> {
    const rules = this.db
      .select()
      .from(notificationRules)
      .where(eq(notificationRules.eventType, eventType))
      .all();

    let sent = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const rule of rules) {
      if (!rule.enabled) {
        skipped++;
        continue;
      }

      // Check cooldown
      if (rule.lastNotifiedAt && rule.cooldownMinutes) {
        const lastNotified = new Date(rule.lastNotifiedAt).getTime();
        const cooldownMs = rule.cooldownMinutes * 60 * 1000;
        if (Date.now() - lastNotified < cooldownMs) {
          log.debug({ ruleId: rule.id, eventType }, 'Notification skipped due to cooldown');
          skipped++;
          continue;
        }
      }

      // Check service filter
      if (rule.websiteFilter && details.serviceId) {
        const filter = rule.websiteFilter as string[];
        if (filter.length > 0 && !filter.includes(details.serviceId as string)) {
          skipped++;
          continue;
        }
      }

      // Check customer filter
      if (rule.customerFilter && details.customerId) {
        const filter = rule.customerFilter as string[];
        if (filter.length > 0 && !filter.includes(details.customerId as string)) {
          skipped++;
          continue;
        }
      }

      // Check severity filter
      if (rule.severity && details.severity && rule.severity !== details.severity) {
        skipped++;
        continue;
      }

      // Send notification
      const sender = this.senders.get(rule.channel);
      if (!sender) {
        errors.push(`No sender registered for channel: ${rule.channel}`);
        continue;
      }

      try {
        const config = (rule.channelConfig as Record<string, unknown>) || {};
        const success = await sender(config, message, details);
        if (success) {
          sent++;
          // Update last notified timestamp
          const now = new Date().toISOString();
          this.db
            .update(notificationRules)
            .set({ lastNotifiedAt: now, updatedAt: now })
            .where(eq(notificationRules.id, rule.id))
            .run();
        } else {
          errors.push(`Failed to send notification for rule ${rule.id}`);
        }
      } catch (err: any) {
        errors.push(`Error sending notification for rule ${rule.id}: ${err.message}`);
        log.error({ ruleId: rule.id, error: err.message }, 'Notification send failed');
      }
    }

    return { sent, skipped, errors };
  }

  async testNotification(ruleId: string): Promise<{ success: boolean; message: string }> {
    const rule = await getRule(this.db, ruleId);
    if (!rule) {
      return { success: false, message: 'Rule not found' };
    }

    const sender = this.senders.get(rule.channel);
    if (!sender) {
      return { success: false, message: `No sender registered for channel: ${rule.channel}` };
    }

    try {
      const config = (rule.channelConfig as Record<string, unknown>) || {};
      const success = await sender(
        config,
        `[TEST] OpsBoard notification test for rule: ${rule.name}`,
        { test: true, ruleId: rule.id }
      );
      return {
        success,
        message: success ? 'Test notification sent successfully' : 'Failed to send test notification',
      };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }
}
