export interface ConnectionTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
  metadata?: Record<string, unknown>;
}

export interface SyncOptions {
  fullSync?: boolean;
  since?: string; // ISO 8601
  serviceIds?: string[];
}

export interface SyncedDeployment {
  externalId: string;
  provider: string;
  status: string;
  environment?: string;
  branch?: string;
  commitSha?: string;
  commitMessage?: string;
  author?: string;
  url?: string;
  startedAt?: string;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface SyncResult {
  success: boolean;
  itemsSynced: number;
  errors: SyncError[];
  durationMs: number;
  nextCursor?: string;
  data?: {
    deployments?: SyncedDeployment[];
    k8sServices?: Array<{
      name: string;
      namespace: string;
      type: string;
      clusterIP: string;
      ports: { port: number; targetPort: number | string; protocol: string; name?: string }[];
      selector: Record<string, string>;
      createdAt: string;
    }>;
    k8sIngresses?: Array<{
      name: string;
      namespace: string;
      hosts: string[];
      paths: { host: string; path: string; serviceName: string; servicePort: number | string }[];
      tlsHosts: string[];
      createdAt: string;
    }>;
    k8sCronJobs?: Array<{
      name: string;
      namespace: string;
      schedule: string;
      suspended: boolean;
      lastScheduleTime: string | null;
      activeJobs: number;
      createdAt: string;
      concurrencyPolicy: string;
      image: string;
    }>;
    vercelProjects?: Array<{
      name: string;
      id: string;
      framework: string | null;
      productionUrl: string | null;
      domains: string[];
    }>;
  };
}

export interface SyncError {
  item: string;
  error: string;
  retryable: boolean;
}

export interface ProviderAdapter {
  readonly name: string;
  readonly version: string;

  testConnection(config: Record<string, unknown>): Promise<ConnectionTestResult>;
  sync(config: Record<string, unknown>, options: SyncOptions): Promise<SyncResult>;
}
