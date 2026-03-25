// ─── Enums / Unions ────────────────────────────────────────────────────────

export type Environment = 'production' | 'staging' | 'development';
export type HostingType = 'vercel' | 'kubernetes' | 'digitalocean' | 'ovh' | 'github' | 'aws' | 'docker' | 'other';
export type ServiceStatus = 'healthy' | 'degraded' | 'down' | 'unknown';
export type ServiceType = 'website' | 'service';
export type IncidentSeverity = 'critical' | 'warning' | 'info';
export type IncidentStatus = 'open' | 'acknowledged' | 'resolved';
export type MonitoringType = 'http' | 'tcp' | 'dns' | 'ssl_expiry' | 'custom';
export type InfraProvider = 'vercel' | 'kubernetes' | 'digitalocean';
export type RepoProvider = 'github' | 'bitbucket';
export type DeploymentProvider = 'vercel' | 'github_actions' | 'semaphore' | 'kubernetes';
export type DeploymentStatus = 'pending' | 'building' | 'deploying' | 'success' | 'failed' | 'cancelled';
export type IntegrationProvider = 'github' | 'vercel' | 'digitalocean' | 'kubernetes' | 'slack' | 'bitbucket' | 'semaphore';
export type SyncStatus = 'success' | 'failed' | 'partial';
export type AgentStatus = 'online' | 'offline' | 'installing' | 'error' | 'unknown';
export type DiagnosticTrigger = 'manual' | 'automatic' | 'incident';
export type DiagnosticStatus = 'running' | 'completed' | 'failed';
export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';
export type IncidentEventType = 'detected' | 'acknowledged' | 'escalated' | 'resolved' | 'comment' | 'diagnostic';
export type EventSource = 'system' | 'user' | 'ai';
export type NotificationChannel = 'slack' | 'email' | 'webhook';
export type NotificationEventType = 'incident.opened' | 'incident.resolved' | 'deployment.failed' | 'health.down';

// ─── Entities ──────────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  name: string;
  slug: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface Service {
  id: string;
  customerId: string | null;
  name: string;
  url: string;
  type: ServiceType;
  environment: Environment;
  hostingType: HostingType;
  status: ServiceStatus;
  healthCheckUrl?: string | null;
  expectedStatusCode?: number | null;
  checkIntervalSeconds?: number | null;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  // Joined fields (returned by API)
  customerName?: string;
  lastResponseTimeMs?: number | null;
  lastCheckedAt?: string | null;
  openIncidentCount?: number;
}

export interface MonitoringTarget {
  id: string;
  serviceId: string;
  type: MonitoringType;
  target: string;
  checkIntervalSeconds?: number | null;
  timeoutMs?: number | null;
  expectedStatusCode?: number | null;
  expectedBodyContains?: string | null;
  headers?: Record<string, string> | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InfrastructureBinding {
  id: string;
  serviceId: string;
  provider: InfraProvider;
  externalId: string;
  region?: string | null;
  resourceType?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryBinding {
  id: string;
  serviceId: string;
  provider: RepoProvider;
  owner: string;
  repo: string;
  defaultBranch?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentSource {
  id: string;
  serviceId: string;
  provider: DeploymentProvider;
  externalProjectId?: string | null;
  pipelineName?: string | null;
  autoDeploy: boolean;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface Incident {
  id: string;
  serviceId: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  detectedAt: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  acknowledgedBy?: string | null;
  resolvedBy?: string | null;
  rootCause?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  // Joined
  serviceName?: string;
  customerName?: string;
}

export interface IncidentEvent {
  id: string;
  incidentId: string;
  type: IncidentEventType;
  message: string;
  source?: EventSource | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface DiagnosticStep {
  tool: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  durationMs: number;
  timestamp: string;
}

export interface DiagnosticRun {
  id: string;
  serviceId: string;
  incidentId?: string | null;
  status: DiagnosticStatus;
  trigger: DiagnosticTrigger;
  steps?: DiagnosticStep[] | null;
  summary?: string | null;
  recommendations?: string[] | null;
  tokensUsed?: number | null;
  durationMs?: number | null;
  startedAt: string;
  completedAt?: string | null;
  createdAt: string;
  // Joined
  serviceName?: string;
}

export interface HealthCheckResult {
  id: string;
  serviceId: string;
  monitoringTargetId?: string | null;
  status: HealthStatus;
  statusCode?: number | null;
  responseTimeMs?: number | null;
  errorMessage?: string | null;
  checkedAt: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface DeploymentRecord {
  id: string;
  serviceId: string;
  provider: DeploymentProvider;
  externalId: string;
  status: DeploymentStatus;
  environment?: Environment | null;
  branch?: string | null;
  commitSha?: string | null;
  commitMessage?: string | null;
  author?: string | null;
  url?: string | null;
  buildDurationMs?: number | null;
  deployDurationMs?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  // Joined
  serviceName?: string;
  customerName?: string;
}

export interface RemoteAgent {
  id: string;
  name: string;
  host: string;
  port?: number | null;
  username: string;
  status: AgentStatus;
  version?: string | null;
  lastHeartbeatAt?: string | null;
  installedAt?: string | null;
  config?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationConfig {
  id: string;
  provider: IntegrationProvider;
  name: string;
  enabled: boolean;
  config?: Record<string, unknown> | null;
  lastSyncAt?: string | null;
  lastSyncStatus?: SyncStatus | null;
  lastSyncError?: string | null;
  syncIntervalSeconds?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationRule {
  id: string;
  name: string;
  enabled: boolean;
  eventType: NotificationEventType;
  severity?: IncidentSeverity | null;
  channel: NotificationChannel;
  channelConfig?: Record<string, unknown> | null;
  cooldownMinutes?: number | null;
  lastNotifiedAt?: string | null;
  serviceFilter?: string[] | null;
  customerFilter?: string[] | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Dashboard / Aggregated Types ──────────────────────────────────────────

export interface DashboardSummary {
  totalServices: number;
  totalCustomers: number;
  serviceStatus: {
    healthy: number;
    degraded: number;
    down: number;
    unknown: number;
  };
  openIncidents: number;
  incidentsLast24h: number;
  activeDeployments: number;
  deploymentsLast24h: number;
  agentStatus: {
    total: number;
    online: number;
    offline: number;
    error: number;
  };
  generatedAt: string;
}

export interface AggregatedDeployment {
  serviceId: string;
  serviceName: string;
  customerName: string;
  lastDeployment?: DeploymentRecord | null;
  ciStatus?: DeploymentStatus | null;
  serviceStatusAfter?: ServiceStatus | null;
}

// ─── Log Types ────────────────────────────────────────────────────────────

export type LogSource = 'kubernetes' | 'vercel' | 'github' | 'agent' | 'backend';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: string;
  source: LogSource;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface LogSourceInfo {
  id: string;
  name: string;
  type: LogSource;
  available: boolean;
  description?: string;
}

export interface LogViewConfig {
  id: string;
  name: string;
  config: LogViewConfigData;
  createdAt: string;
  updatedAt: string;
}

export interface LogViewConfigData {
  selectedServiceIds?: string[];
  sources?: string[];
  levels?: string[];
  since?: string;
  search?: string;
  columns?: string[];
}

// ─── Filter Types ──────────────────────────────────────────────────────────

export interface ServiceFilters {
  customerId?: string;
  type?: ServiceType;
  environments?: Environment[];
  hostingTypes?: HostingType[];
  statuses?: ServiceStatus[];
  hasOpenIncident?: boolean;
  search?: string;
}

export interface IncidentFilters {
  serviceId?: string;
  customerId?: string;
  severity?: IncidentSeverity[];
  status?: IncidentStatus[];
  search?: string;
}

export interface DeploymentFilters {
  serviceId?: string;
  provider?: DeploymentProvider[];
  status?: DeploymentStatus[];
  environment?: Environment[];
}

// ─── API Response Wrappers ─────────────────────────────────────────────────

export interface ApiListResponse<T> {
  data: T[];
  total: number;
}

export interface SecretProvider {
  id: string;
  name: string;
  configured: boolean;
  keys: Array<{ key: string; hasValue: boolean }>;
}

export interface SecretStatus {
  backend: 'keychain' | 'encrypted-file';
  available: boolean;
  secretCount: number;
}

export interface AgentInstallRequest {
  host: string;
  username: string;
  sshKeyPath?: string;
  port?: number;
}

export interface AgentSettings {
  checkIntervalSeconds: number;
  healthCheckEnabled: boolean;
  metricsEnabled: boolean;
}

// ─── CronJob Types ────────────────────────────────────────────────────────

export type CronJobProvider = 'kubernetes' | 'vercel';

export interface CronJobEntry {
  id: string;
  name: string;
  provider: CronJobProvider;
  schedule: string;
  namespace?: string;
  projectName?: string;
  path?: string;
  suspended: boolean;
  lastRun?: string;
  lastRunStatus?: string;
  activeJobs?: number;
  image?: string;
  metadata?: Record<string, unknown>;
}

// ─── Kubernetes Types ─────────────────────────────────────────────────────

export interface K8sNamespace {
  name: string;
  status: string;
  labels: Record<string, string>;
  createdAt: string;
}

export interface K8sCronJobEntry {
  name: string;
  namespace: string;
  schedule: string;
  suspended: boolean;
  lastScheduleTime: string | null;
  activeJobs: number;
  createdAt: string;
  concurrencyPolicy: string;
  image: string;
}

export interface K8sClusterInfo {
  version: string;
  platform: string;
  nodeCount: number;
  nodes: K8sNodeInfo[];
}

export interface K8sNodeInfo {
  name: string;
  status: string;
  roles: string[];
  kubeletVersion: string;
  os: string;
  arch: string;
}

export interface K8sPod {
  name: string;
  namespace: string;
  status: string;
  phase: string;
  ready: boolean;
  restartCount: number;
  createdAt: string;
  nodeName: string;
  containers: K8sContainer[];
}

export interface K8sContainer {
  name: string;
  image: string;
  ready: boolean;
  restartCount: number;
  state: string;
}

export interface K8sDeploymentEntry {
  name: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  availableReplicas: number;
  updatedReplicas: number;
  conditions: K8sCondition[];
  createdAt: string;
}

export interface K8sCondition {
  type: string;
  status: string;
  reason: string;
  message: string;
  lastTransitionTime: string;
}

export interface K8sPodMetrics {
  name: string;
  namespace: string;
  timestamp: string;
  containers: {
    name: string;
    cpu: string;
    memory: string;
  }[];
}

export interface K8sMetricsResponse {
  available: boolean;
  pods: K8sPodMetrics[];
}

export interface K8sEvent {
  type: string;
  reason: string;
  message: string;
  involvedObject: {
    kind: string;
    name: string;
    namespace: string;
  };
  firstTimestamp: string;
  lastTimestamp: string;
  count: number;
}

// ─── App Settings ─────────────────────────────────────────────────────────────

export interface AppSettings {
  logBufferSize: number;
}

// ─── Vercel Types ─────────────────────────────────────────────────────────────

export interface VercelProjectDetails {
  id: string;
  name: string;
  framework: string | null;
  nodeVersion: string | null;
  buildCommand: string | null;
  outputDirectory: string | null;
  installCommand: string | null;
  devCommand: string | null;
  rootDirectory: string | null;
  productionDomain: string | null;
  domains: string[];
  envVarsCount: number;
  analytics: {
    speedInsights: boolean;
    webAnalytics: boolean;
  };
  gitRepo: {
    org: string;
    repo: string;
    type: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  latestDeployments: VercelDeploymentSummary[];
}

export interface VercelDeploymentSummary {
  uid: string;
  url: string;
  state: string;
  created: number;
  ready: number | null;
  target: string | null;
  creator: string;
  branch: string | null;
  commitMessage: string | null;
  commitSha: string | null;
}
