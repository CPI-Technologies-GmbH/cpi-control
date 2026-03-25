import type {
  Customer,
  Service,
  ServiceFilters,
  MonitoringTarget,
  InfrastructureBinding,
  RepositoryBinding,
  DeploymentSource,
  IntegrationConfig,
  DeploymentRecord,
  DeploymentFilters,
  Incident,
  IncidentFilters,
  IncidentEvent,
  NotificationRule,
  DiagnosticRun,
  SecretProvider,
  SecretStatus,
  RemoteAgent,
  AgentInstallRequest,
  AgentSettings,
  DashboardSummary,
  HealthCheckResult,
  LogEntry,
  LogSourceInfo,
  LogViewConfig,
  LogViewConfigData,
  AppSettings,
} from '@/types';

const BASE_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL) || 'http://localhost:19876';

// ─── Fetch Helpers ─────────────────────────────────────────────────────────

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${res.statusText} - ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

function buildQuery(params: Record<string, any>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      value.forEach((v) => sp.append(key, String(v)));
    } else {
      sp.set(key, String(value));
    }
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

// ─── Customers ─────────────────────────────────────────────────────────────
// Backend: inventoryRoutes registered with prefix '/api/inventory'
// Routes: /customers, /customers/:id

export const customers = {
  list: () => request<Customer[]>('/api/inventory/customers'),
  get: (id: string) => request<Customer>(`/api/inventory/customers/${id}`),
  create: (data: Partial<Customer>) =>
    request<Customer>('/api/inventory/customers', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Customer>) =>
    request<Customer>(`/api/inventory/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/api/inventory/customers/${id}`, { method: 'DELETE' }),
};

// ─── Services ──────────────────────────────────────────────────────────────
// Backend: inventoryRoutes registered with prefix '/api/inventory'
// Routes: /services, /services/:id

export const services = {
  list: (filters?: ServiceFilters) =>
    request<Service[]>(`/api/inventory/services${buildQuery((filters ?? {}) as Record<string, any>)}`),
  get: (id: string) => request<Service>(`/api/inventory/services/${id}`),
  create: (data: Partial<Service>) =>
    request<Service>('/api/inventory/services', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Service>) =>
    request<Service>(`/api/inventory/services/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/api/inventory/services/${id}`, { method: 'DELETE' }),
  batchUpdate: (ids: string[], updates: Partial<Service>) =>
    request<Service[]>('/api/inventory/services/batch', {
      method: 'PATCH',
      body: JSON.stringify({ ids, updates }),
    }),
};

// ─── Monitoring Targets ────────────────────────────────────────────────────
// Backend: inventoryRoutes registered with prefix '/api/inventory'
// Routes: /monitoring-targets (with ?serviceId= query param), /monitoring-targets/:id

export const monitoringTargets = {
  list: (serviceId: string) =>
    request<MonitoringTarget[]>(`/api/inventory/monitoring-targets${buildQuery({ serviceId })}`),
  get: (_serviceId: string, id: string) =>
    request<MonitoringTarget>(`/api/inventory/monitoring-targets/${id}`),
  create: (serviceId: string, data: Partial<MonitoringTarget>) =>
    request<MonitoringTarget>('/api/inventory/monitoring-targets', {
      method: 'POST',
      body: JSON.stringify({ ...data, serviceId }),
    }),
  update: (_serviceId: string, id: string, data: Partial<MonitoringTarget>) =>
    request<MonitoringTarget>(`/api/inventory/monitoring-targets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (_serviceId: string, id: string) =>
    request<void>(`/api/inventory/monitoring-targets/${id}`, { method: 'DELETE' }),
};

// ─── Infrastructure Bindings ───────────────────────────────────────────────
// Backend: inventoryRoutes registered with prefix '/api/inventory'
// Routes: /infra-bindings (with ?serviceId= query param), /infra-bindings/:id
// Note: backend has no PUT for infra-bindings

export const infraBindings = {
  list: (serviceId: string) =>
    request<InfrastructureBinding[]>(`/api/inventory/infra-bindings${buildQuery({ serviceId })}`),
  get: (_serviceId: string, id: string) =>
    request<InfrastructureBinding>(`/api/inventory/infra-bindings/${id}`),
  create: (serviceId: string, data: Partial<InfrastructureBinding>) =>
    request<InfrastructureBinding>('/api/inventory/infra-bindings', {
      method: 'POST',
      body: JSON.stringify({ ...data, serviceId }),
    }),
  update: (_serviceId: string, id: string, data: Partial<InfrastructureBinding>) =>
    request<InfrastructureBinding>(`/api/inventory/infra-bindings/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (_serviceId: string, id: string) =>
    request<void>(`/api/inventory/infra-bindings/${id}`, { method: 'DELETE' }),
};

// ─── Repository Bindings ───────────────────────────────────────────────────
// Backend: inventoryRoutes registered with prefix '/api/inventory'
// Routes: /repo-bindings (with ?serviceId= query param), /repo-bindings/:id
// Note: backend has no PUT for repo-bindings

export const repoBindings = {
  list: (serviceId: string) =>
    request<RepositoryBinding[]>(`/api/inventory/repo-bindings${buildQuery({ serviceId })}`),
  get: (_serviceId: string, id: string) =>
    request<RepositoryBinding>(`/api/inventory/repo-bindings/${id}`),
  create: (serviceId: string, data: Partial<RepositoryBinding>) =>
    request<RepositoryBinding>('/api/inventory/repo-bindings', {
      method: 'POST',
      body: JSON.stringify({ ...data, serviceId }),
    }),
  update: (_serviceId: string, id: string, data: Partial<RepositoryBinding>) =>
    request<RepositoryBinding>(`/api/inventory/repo-bindings/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (_serviceId: string, id: string) =>
    request<void>(`/api/inventory/repo-bindings/${id}`, { method: 'DELETE' }),
};

// ─── Deployment Sources ────────────────────────────────────────────────────
// Backend: inventoryRoutes registered with prefix '/api/inventory'
// Routes: /deployment-sources (with ?serviceId= query param), /deployment-sources/:id
// Note: backend has no PUT for deployment-sources

export const deploymentSources = {
  list: (serviceId: string) =>
    request<DeploymentSource[]>(`/api/inventory/deployment-sources${buildQuery({ serviceId })}`),
  get: (_serviceId: string, id: string) =>
    request<DeploymentSource>(`/api/inventory/deployment-sources/${id}`),
  create: (serviceId: string, data: Partial<DeploymentSource>) =>
    request<DeploymentSource>('/api/inventory/deployment-sources', {
      method: 'POST',
      body: JSON.stringify({ ...data, serviceId }),
    }),
  update: (_serviceId: string, id: string, data: Partial<DeploymentSource>) =>
    request<DeploymentSource>(`/api/inventory/deployment-sources/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (_serviceId: string, id: string) =>
    request<void>(`/api/inventory/deployment-sources/${id}`, { method: 'DELETE' }),
};

// ─── Integrations ──────────────────────────────────────────────────────────
// Backend: integrationRoutes registered with prefix '/api'
// Routes: /integrations, /integrations/:id, /integrations/:id/sync, /integrations/sync/status

export const integrations = {
  list: () => request<IntegrationConfig[]>('/api/integrations'),
  get: (id: string) => request<IntegrationConfig>(`/api/integrations/${id}`),
  create: (data: Partial<IntegrationConfig>) =>
    request<IntegrationConfig>('/api/integrations', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<IntegrationConfig>) =>
    request<IntegrationConfig>(`/api/integrations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<void>(`/api/integrations/${id}`, { method: 'DELETE' }),
  sync: (id: string) =>
    request<{ status: string }>(`/api/integrations/${id}/sync`, { method: 'POST' }),
  status: () =>
    request<Array<{ status: SyncStatus; lastSyncAt: string | null }>>('/api/integrations/sync/status'),
};

// ─── Deployments ───────────────────────────────────────────────────────────
// Backend: deploymentRoutes registered with prefix '/api'
// Routes: /deployments, /deployments/:id, /services/:serviceId/deployments

export const deployments = {
  list: (filters?: DeploymentFilters) =>
    request<DeploymentRecord[]>(`/api/deployments${buildQuery((filters ?? {}) as Record<string, any>)}`),
  byService: (serviceId: string) =>
    request<DeploymentRecord[]>(`/api/services/${serviceId}/deployments`),
  get: (id: string) => request<DeploymentRecord>(`/api/deployments/${id}`),
};

// ─── Incidents ─────────────────────────────────────────────────────────────
// Backend: incidentRoutes registered with prefix '/api'
// Routes: /incidents, /incidents/:id, /incidents/:id/timeline, /incidents/:id/acknowledge, /incidents/:id/resolve

export const incidents = {
  list: (filters?: IncidentFilters) =>
    request<Incident[]>(`/api/incidents${buildQuery((filters ?? {}) as Record<string, any>)}`),
  get: (id: string) => request<Incident>(`/api/incidents/${id}`),
  acknowledge: (id: string, by?: string) =>
    request<Incident>(`/api/incidents/${id}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify({ acknowledgedBy: by }),
    }),
  resolve: (id: string, data?: { resolvedBy?: string; rootCause?: string }) =>
    request<Incident>(`/api/incidents/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  events: (id: string) =>
    request<IncidentEvent[]>(`/api/incidents/${id}/timeline`),
};

// ─── Notifications ─────────────────────────────────────────────────────────
// Backend: notificationRoutes registered with prefix '/api'
// Routes: /notification-rules, /notification-rules/:id, /notification-rules/:id/test

export const notifications = {
  listRules: () => request<NotificationRule[]>('/api/notification-rules'),
  getRule: (id: string) => request<NotificationRule>(`/api/notification-rules/${id}`),
  createRule: (data: Partial<NotificationRule>) =>
    request<NotificationRule>('/api/notification-rules', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateRule: (id: string, data: Partial<NotificationRule>) =>
    request<NotificationRule>(`/api/notification-rules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteRule: (id: string) =>
    request<void>(`/api/notification-rules/${id}`, { method: 'DELETE' }),
  testRule: (id: string) =>
    request<{ success: boolean; message: string }>(`/api/notification-rules/${id}/test`, {
      method: 'POST',
    }),
};

// ─── AI Diagnostics ────────────────────────────────────────────────────────
// Backend: aiDiagnosticsRoutes registered with prefix '/api'
// Routes: POST /diagnostics, GET /diagnostics, GET /diagnostics/:id

export const diagnostics = {
  trigger: (serviceId: string, incidentId?: string) =>
    request<DiagnosticRun>('/api/diagnostics', {
      method: 'POST',
      body: JSON.stringify({ serviceId, incidentId }),
    }),
  listRuns: (serviceId?: string) =>
    request<DiagnosticRun[]>(`/api/diagnostics${buildQuery({ serviceId: serviceId ?? '' })}`),
  getRun: (id: string) => request<DiagnosticRun>(`/api/diagnostics/${id}`),
};

// ─── Secrets ───────────────────────────────────────────────────────────────
// Backend: secretsRoutes registered with prefix '/api'
// Routes: GET /secrets/providers, GET /secrets/status, PUT /secrets/:key, DELETE /secrets/:key, GET /secrets/:key/exists

export const secrets = {
  listProviders: () => request<SecretProvider[]>('/api/secrets/providers'),
  save: (_provider: string, key: string, value: string) =>
    request<{ key: string; saved: boolean }>(`/api/secrets/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
  delete: (_provider: string, key: string) =>
    request<void>(`/api/secrets/${key}`, { method: 'DELETE' }),
  status: () => request<SecretStatus>('/api/secrets/status'),
  kubeconfigs: () =>
    request<Array<{ key: string; name: string }>>('/api/secrets/kubernetes/configs'),
  saveKubeconfig: (name: string, value: string) =>
    request<{ key: string; saved: boolean }>(`/api/secrets/kubernetes/configs/${name}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
  deleteKubeconfig: (name: string) =>
    request<void>(`/api/secrets/kubernetes/configs/${name}`, { method: 'DELETE' }),
};

// ─── Agent ─────────────────────────────────────────────────────────────────
// Backend: agentLifecycleRoutes registered with prefix '/api'
// Routes: GET /agents, GET /agents/:id, POST /agents/install, POST /agents/:id/sync,
//         POST /agents/:id/uninstall, POST /agents/:id/restart, GET /agents/:id/status,
//         GET /agents/:id/config-preview, PUT /agents/:id/settings

export const agent = {
  list: () => request<RemoteAgent[]>('/api/agents'),
  get: (id: string) => request<RemoteAgent>(`/api/agents/${id}`),
  install: (data: AgentInstallRequest) =>
    request<RemoteAgent>('/api/agents/install', { method: 'POST', body: JSON.stringify(data) }),
  sync: (id: string) =>
    request<{ status: string }>(`/api/agents/${id}/sync`, { method: 'POST' }),
  uninstall: (id: string) =>
    request<{ success: boolean; message: string }>(`/api/agents/${id}/uninstall`, { method: 'POST' }),
  restart: (id: string) =>
    request<{ success: boolean; message: string }>(`/api/agents/${id}/restart`, { method: 'POST' }),
  status: (id: string) => request<RemoteAgent>(`/api/agents/${id}/status`),
  configPreview: (id: string) =>
    request<Record<string, unknown>>(`/api/agents/${id}/config-preview`),
  settings: {
    get: (id: string) => request<AgentSettings>(`/api/agents/${id}/settings`),
    update: (id: string, data: Partial<AgentSettings>) =>
      request<AgentSettings>(`/api/agents/${id}/settings`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  },
};

// ─── Dashboard ─────────────────────────────────────────────────────────────
// Backend: dashboardRoutes registered with prefix '/api'
// Routes: GET /dashboard/summary, GET /dashboard/health-overview

export const dashboard = {
  summary: () => request<DashboardSummary>('/api/dashboard/summary'),
  healthOverview: () =>
    request<Array<{ serviceId: string; serviceName: string; status: string; lastCheckedAt: string }>>(
      '/api/dashboard/health-overview'
    ),
};

// ─── Logs ───────────────────────────────────────────────────────────────────
// Backend: logRoutes registered with prefix '/api'
// Routes: GET /logs, GET /logs/sources, GET /logs/stream (SSE)

export const logs = {
  list: (filters?: Record<string, any>) =>
    request<LogEntry[]>(`/api/logs${buildQuery(filters ?? {})}`),
  sources: () => request<LogSourceInfo[]>('/api/logs/sources'),
};

// ─── Log Configs ─────────────────────────────────────────────────────────
// Backend: logConfigRoutes registered with prefix '/api'
// Routes: GET/POST /log-configs, GET/PUT/DELETE /log-configs/:id

export const logConfigs = {
  list: () => request<LogViewConfig[]>('/api/log-configs'),
  get: (id: string) => request<LogViewConfig>(`/api/log-configs/${id}`),
  create: (data: { name: string; config: LogViewConfigData }) =>
    request<LogViewConfig>('/api/log-configs', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; config?: LogViewConfigData }) =>
    request<LogViewConfig>(`/api/log-configs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/api/log-configs/${id}`, { method: 'DELETE' }),
};

// ─── CronJobs ────────────────────────────────────────────────────────────
// Backend: cronjobRoutes registered with prefix '/api'
// Routes: GET /cronjobs

export const cronjobs = {
  list: (filters?: Record<string, any>) =>
    request<CronJobEntry[]>(`/api/cronjobs${buildQuery(filters ?? {})}`),
};

// ─── Kubernetes ────────────────────────────────────────────────────────────
// Backend: kubernetesRoutes registered with prefix '/api'
// Routes: GET /kubernetes/namespaces, GET /kubernetes/cronjobs, GET /kubernetes/cluster,
//         POST /kubernetes/deployments/:namespace/:name/restart,
//         GET /kubernetes/pods, GET /kubernetes/deployments

export const kubernetes = {
  namespaces: (integrationId: string) =>
    request<K8sNamespace[]>(`/api/kubernetes/namespaces${buildQuery({ integrationId })}`),
  cronJobs: (integrationId: string, namespace?: string) =>
    request<K8sCronJobEntry[]>(`/api/kubernetes/cronjobs${buildQuery({ integrationId, namespace })}`),
  cluster: (integrationId: string) =>
    request<K8sClusterInfo>(`/api/kubernetes/cluster${buildQuery({ integrationId })}`),
  restartDeployment: (integrationId: string, namespace: string, name: string) =>
    request<{ success: boolean; message: string }>(`/api/kubernetes/deployments/${namespace}/${name}/restart${buildQuery({ integrationId })}`, {
      method: 'POST',
    }),
  pods: (integrationId: string, namespace?: string) =>
    request<K8sPod[]>(`/api/kubernetes/pods${buildQuery({ integrationId, namespace })}`),
  deployments: (integrationId: string, namespace?: string) =>
    request<K8sDeploymentEntry[]>(`/api/kubernetes/deployments${buildQuery({ integrationId, namespace })}`),
  metrics: (integrationId: string, namespace?: string) =>
    request<K8sMetricsResponse>(`/api/kubernetes/metrics${buildQuery({ integrationId, namespace })}`),
  events: (integrationId: string, namespace?: string, name?: string) =>
    request<K8sEvent[]>(`/api/kubernetes/events${buildQuery({ integrationId, namespace, name })}`),
};

// ─── Settings ────────────────────────────────────────────────────────────────
// Backend: settingsRoutes registered with prefix '/api'
// Routes: GET /settings, PUT /settings

export const settings = {
  get: () => request<AppSettings>('/api/settings'),
  update: (data: Partial<AppSettings>) =>
    request<AppSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),
  reset: () =>
    request<{ success: boolean; deletedServices: number; syncResult: { synced: number; errors: string[] } | null }>(
      '/api/settings/reset',
      { method: 'POST' }
    ),
};

// ─── Vercel ─────────────────────────────────────────────────────────────────
// Backend: vercelRoutes registered with prefix '/api'
// Routes: GET /vercel/projects, GET /vercel/projects/:projectId, GET /vercel/deployments

export const vercel = {
  projects: (integrationId: string) =>
    request<VercelProject[]>(`/api/vercel/projects${buildQuery({ integrationId })}`),
  projectDetails: (integrationId: string, projectId: string) =>
    request<VercelProjectDetails>(`/api/vercel/projects/${projectId}${buildQuery({ integrationId })}`),
  deployments: (integrationId: string, projectId?: string, limit?: number) =>
    request<VercelDeployment[]>(`/api/vercel/deployments${buildQuery({ integrationId, projectId, limit })}`),
};

export { BASE_URL };

// Re-export type used in integrations.status for completeness
import type {
  SyncStatus,
  CronJobEntry,
  K8sNamespace,
  K8sCronJobEntry,
  K8sClusterInfo,
  K8sPod,
  K8sDeploymentEntry,
  K8sMetricsResponse,
  K8sEvent,
  VercelProjectDetails,
} from '@/types';

// Lightweight API-level types (not the same as backend full types)
interface VercelProject {
  id: string;
  name: string;
  framework: string | null;
}

interface VercelDeployment {
  uid: string;
  name: string;
  url: string;
  state: string;
  created: number;
  ready: number;
  creator: { uid: string; username: string };
  meta?: Record<string, string>;
}
