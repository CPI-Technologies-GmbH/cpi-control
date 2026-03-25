export type LogSource = 'kubernetes' | 'vercel' | 'github' | 'agent' | 'backend';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: string;
  source: LogSource;
  level: LogLevel;
  message: string;
  metadata?: {
    pod?: string;
    namespace?: string;
    container?: string;
    deployment?: string;
    node?: string;
    agentId?: string;
    agentName?: string;
    [key: string]: unknown;
  };
}

export interface LogFilter {
  source?: LogSource | LogSource[];
  level?: LogLevel | LogLevel[];
  since?: string; // ISO 8601 or duration like "1h", "30m"
  until?: string;
  search?: string;
  namespace?: string;
  pod?: string;
  limit?: number;
  serviceId?: string; // Filter logs to a specific service (resolves K8s namespace/deployment)
  /** @internal Resolved service name — set by LogService, not from API input. */
  _serviceName?: string;
}

export interface LogSourceInfo {
  id: string;
  name: string;
  type: LogSource;
  available: boolean;
  description?: string;
}
