import { EventEmitter } from 'events';
import { createChildLogger } from './logger.js';

const log = createChildLogger('event-bus');

// ─── Event Types ─────────────────────────────────────────────────────────────

export type DeploymentEventType = 'deployment.started' | 'deployment.completed' | 'deployment.failed';
export type ServiceEventType = 'service.down' | 'service.up' | 'service.degraded';
export type OpsEventType = DeploymentEventType | ServiceEventType;

export interface OpsEvent {
  id: string;
  type: OpsEventType;
  serviceName: string;
  serviceId?: string;
  provider: string;
  timestamp: string;
  details: Record<string, unknown>;
}

export interface DeploymentEventDetails {
  deploymentId?: string;
  externalId?: string;
  environment?: string;
  branch?: string;
  commitSha?: string;
  commitMessage?: string;
  author?: string;
  status?: string;
  url?: string;
}

export interface ServiceEventDetails {
  oldStatus?: string;
  newStatus?: string;
  statusCode?: number | null;
  responseTimeMs?: number;
  errorMessage?: string | null;
}

// ─── Singleton Event Bus ─────────────────────────────────────────────────────

class OpsEventBus extends EventEmitter {
  private eventCounter = 0;

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === 'ops-event') {
      log.debug({ event: (args[0] as OpsEvent)?.type }, 'Event emitted');
    }
    return super.emit(event, ...args);
  }

  publish(type: OpsEventType, data: Omit<OpsEvent, 'id' | 'type' | 'timestamp'>): void {
    const event: OpsEvent = {
      id: `evt_${Date.now()}_${++this.eventCounter}`,
      type,
      timestamp: new Date().toISOString(),
      ...data,
    };

    this.emit('ops-event', event);
    log.info(
      { eventType: type, serviceName: event.serviceName, provider: event.provider },
      'Published ops event'
    );
  }
}

export const eventBus = new OpsEventBus();
