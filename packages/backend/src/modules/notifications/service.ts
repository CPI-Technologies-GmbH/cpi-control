import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { DB } from '../../db/client.js';
import { notificationRules, websites, projects } from '../../db/schema.js';
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
  projectFilter?: string[];
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
  projectFilter?: string[];
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
      projectFilter: body.projectFilter || null,
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
      ...(body.projectFilter !== undefined && { projectFilter: body.projectFilter }),
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

interface PendingEvent {
  eventType: string;
  message: string;
  details: Record<string, unknown>;
}

export class NotificationService {
  private db: DB;
  private senders = new Map<string, (config: Record<string, unknown>, message: string, details: Record<string, unknown>) => Promise<boolean>>();
  private pendingEvents: PendingEvent[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private batchWindowMs = 30_000; // 30s debounce window

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

      // Check if service is muted or archived
      if (details.serviceId) {
        const svcRows = this.db
          .select({ archived: websites.archived, mutedUntil: websites.mutedUntil })
          .from(websites)
          .where(eq(websites.id, details.serviceId as string))
          .all();
        if (svcRows.length > 0) {
          const svc = svcRows[0];
          if (svc.archived) {
            skipped++;
            continue;
          }
          if (svc.mutedUntil) {
            if (svc.mutedUntil === 'forever' || new Date(svc.mutedUntil).getTime() > Date.now()) {
              log.debug({ serviceId: details.serviceId, mutedUntil: svc.mutedUntil }, 'Notification skipped — service muted');
              skipped++;
              continue;
            }
          }
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

      // Check project filter
      if (rule.projectFilter && details.projectId) {
        const filter = rule.projectFilter as string[];
        if (filter.length > 0 && !filter.includes(details.projectId as string)) {
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

    // ─── Per-project Slack webhook ──────────────────────────────────────────
    if (details.serviceId) {
      try {
        const svcRows = this.db
          .select({ projectId: websites.projectId })
          .from(websites)
          .where(eq(websites.id, details.serviceId as string))
          .all();
        const projectId = svcRows[0]?.projectId;
        if (projectId) {
          const projRows = this.db
            .select({ slackWebhookUrl: projects.slackWebhookUrl })
            .from(projects)
            .where(eq(projects.id, projectId))
            .all();
          const slackUrl = projRows[0]?.slackWebhookUrl;
          if (slackUrl) {
            const severity = (details.severity as string) || 'info';
            const serviceName = (details.serviceName as string) || 'Unknown';
            const isResolved = eventType.includes('resolved');
            const emoji = isResolved ? '\u{1F7E2}' : severity === 'critical' ? '\u{1F534}' : severity === 'warning' ? '\u{1F7E1}' : '\u{1F7E2}';
            const text = isResolved
              ? `\u{1F7E2} *${serviceName}* has recovered`
              : `${emoji} *${serviceName}* is ${severity === 'critical' ? 'down' : 'degraded'}`;

            fetch(slackUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text }),
            }).catch((err) => {
              log.warn({ projectId, error: err.message }, 'Failed to send project Slack webhook');
            });
          }
        }
      } catch (err: any) {
        log.warn({ error: err.message }, 'Failed to look up project Slack webhook');
      }
    }

    return { sent, skipped, errors };
  }

  /**
   * Queue a notification into a 30s batch window. Events are collected and sent
   * as a single consolidated notification to prevent notification floods during
   * cluster outages.
   */
  notifyBatched(
    eventType: string,
    message: string,
    details: Record<string, unknown> = {}
  ): void {
    this.pendingEvents.push({ eventType, message, details });

    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this.flushBatch(), this.batchWindowMs);
    }
  }

  /** Check if a service is muted or archived. Returns true if notifications should be suppressed. */
  private isServiceSuppressed(serviceId: string): boolean {
    const rows = this.db
      .select({ archived: websites.archived, mutedUntil: websites.mutedUntil })
      .from(websites)
      .where(eq(websites.id, serviceId))
      .all();
    if (rows.length === 0) return false;
    const svc = rows[0];
    if (svc.archived) return true;
    if (svc.mutedUntil) {
      if (svc.mutedUntil === 'forever' || new Date(svc.mutedUntil).getTime() > Date.now()) return true;
    }
    return false;
  }

  private async flushBatch(): Promise<void> {
    this.batchTimer = null;
    const events = this.pendingEvents.splice(0);
    if (events.length === 0) return;

    // Filter out muted/archived services BEFORE grouping
    const filteredEvents = events.filter((ev) => {
      const serviceId = ev.details.serviceId as string | undefined;
      if (serviceId && this.isServiceSuppressed(serviceId)) {
        log.debug({ serviceId, eventType: ev.eventType }, 'Suppressed batched notification for muted/archived service');
        return false;
      }
      return true;
    });
    if (filteredEvents.length === 0) return;

    // Group by eventType
    const groups = new Map<string, PendingEvent[]>();
    for (const ev of filteredEvents) {
      const group = groups.get(ev.eventType) || [];
      group.push(ev);
      groups.set(ev.eventType, group);
    }

    for (const [eventType, group] of groups) {
      if (group.length === 1) {
        // Single event — send as-is
        await this.notify(eventType, group[0].message, group[0].details);
      } else {
        // Multiple events — consolidate into one message
        const serviceNames = group
          .map((e) => e.details.serviceName as string || 'Unknown')
          .filter((v, i, a) => a.indexOf(v) === i);
        const consolidatedMessage = `${group.length} services affected: ${serviceNames.join(', ')}`;
        const consolidatedDetails: Record<string, unknown> = {
          affectedCount: group.length,
          serviceNames,
          events: group.map((e) => ({
            message: e.message,
            serviceId: e.details.serviceId,
            serviceName: e.details.serviceName,
          })),
        };
        await this.notify(eventType, consolidatedMessage, consolidatedDetails);
      }
    }
  }

  /** Flush all pending batched notifications immediately (for graceful shutdown). */
  async flushAll(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    await this.flushBatch();
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
