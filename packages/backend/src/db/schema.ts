import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// ─── Projects (DB table: customers) ─────────────────────────────────────────
export const projects = sqliteTable('customers', {
  id: text('id').primaryKey(), // ULID
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  icon: text('icon'), // emoji or short text icon
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  notes: text('notes'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull(), // ISO 8601
  updatedAt: text('updated_at').notNull(),
});

// ─── Websites ────────────────────────────────────────────────────────────────
export const websites = sqliteTable('websites', {
  id: text('id').primaryKey(), // ULID
  projectId: text('customer_id')
    .references(() => projects.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  type: text('type').notNull().default('website'), // website | service
  url: text('url'),
  environment: text('environment').notNull(), // production | staging | development
  hostingType: text('hosting_type').notNull(), // vercel | kubernetes | digitalocean | other
  status: text('status').notNull().default('unknown'), // healthy | degraded | down | unknown
  healthCheckUrl: text('health_check_url'),
  expectedStatusCode: integer('expected_status_code').default(200),
  checkIntervalSeconds: integer('check_interval_seconds').default(60),
  tags: text('tags', { mode: 'json' }).$type<string[]>(),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  archived: integer('archived', { mode: 'boolean' }).default(false),
  mutedUntil: text('muted_until'), // ISO timestamp, 'forever', or null (not muted)
  publicName: text('public_name'),
  publicDescription: text('public_description'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Monitoring Targets ──────────────────────────────────────────────────────
export const monitoringTargets = sqliteTable('monitoring_targets', {
  id: text('id').primaryKey(),
  websiteId: text('website_id')
    .notNull()
    .references(() => websites.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // http | tcp | dns | ssl_expiry | custom
  target: text('target').notNull(), // URL or host:port
  checkIntervalSeconds: integer('check_interval_seconds').default(60),
  timeoutMs: integer('timeout_ms').default(10000),
  expectedStatusCode: integer('expected_status_code'),
  expectedBodyContains: text('expected_body_contains'),
  headers: text('headers', { mode: 'json' }).$type<Record<string, string>>(),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Infrastructure Bindings ─────────────────────────────────────────────────
export const infrastructureBindings = sqliteTable('infrastructure_bindings', {
  id: text('id').primaryKey(),
  websiteId: text('website_id')
    .notNull()
    .references(() => websites.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), // vercel | kubernetes | digitalocean
  externalId: text('external_id').notNull(), // project ID, deployment name, droplet ID
  region: text('region'),
  resourceType: text('resource_type'), // project | deployment | droplet | pod
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Repository Bindings ─────────────────────────────────────────────────────
export const repositoryBindings = sqliteTable('repository_bindings', {
  id: text('id').primaryKey(),
  websiteId: text('website_id')
    .notNull()
    .references(() => websites.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), // github | bitbucket
  owner: text('owner').notNull(),
  repo: text('repo').notNull(),
  defaultBranch: text('default_branch').default('main'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Deployment Sources ──────────────────────────────────────────────────────
export const deploymentSources = sqliteTable('deployment_sources', {
  id: text('id').primaryKey(),
  websiteId: text('website_id')
    .notNull()
    .references(() => websites.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), // vercel | github_actions | semaphore | kubernetes
  externalProjectId: text('external_project_id'),
  pipelineName: text('pipeline_name'),
  autoDeploy: integer('auto_deploy', { mode: 'boolean' }).default(false),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Incidents ───────────────────────────────────────────────────────────────
export const incidents = sqliteTable('incidents', {
  id: text('id').primaryKey(),
  websiteId: text('website_id')
    .notNull()
    .references(() => websites.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  severity: text('severity').notNull(), // critical | warning | info
  status: text('status').notNull().default('open'), // open | acknowledged | resolved
  detectedAt: text('detected_at').notNull(),
  acknowledgedAt: text('acknowledged_at'),
  resolvedAt: text('resolved_at'),
  acknowledgedBy: text('acknowledged_by'),
  resolvedBy: text('resolved_by'),
  rootCause: text('root_cause'),
  summary: text('summary'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Incident Events ─────────────────────────────────────────────────────────
export const incidentEvents = sqliteTable('incident_events', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id')
    .notNull()
    .references(() => incidents.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // detected | acknowledged | escalated | resolved | comment | diagnostic
  message: text('message').notNull(),
  source: text('source'), // system | user | ai
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull(),
});

// ─── Diagnostic Runs ─────────────────────────────────────────────────────────
export const diagnosticRuns = sqliteTable('diagnostic_runs', {
  id: text('id').primaryKey(),
  websiteId: text('website_id')
    .notNull()
    .references(() => websites.id, { onDelete: 'cascade' }),
  incidentId: text('incident_id').references(() => incidents.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('running'), // running | completed | failed
  trigger: text('trigger').notNull(), // manual | automatic | incident
  steps: text('steps', { mode: 'json' }).$type<DiagnosticStep[]>(),
  summary: text('summary'),
  recommendations: text('recommendations', { mode: 'json' }).$type<string[]>(),
  tokensUsed: integer('tokens_used'),
  durationMs: integer('duration_ms'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
});

export interface DiagnosticStep {
  tool: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  durationMs: number;
  timestamp: string;
}

// ─── Health Check Results ────────────────────────────────────────────────────
export const healthCheckResults = sqliteTable('health_check_results', {
  id: text('id').primaryKey(),
  websiteId: text('website_id')
    .notNull()
    .references(() => websites.id, { onDelete: 'cascade' }),
  monitoringTargetId: text('monitoring_target_id').references(() => monitoringTargets.id, {
    onDelete: 'set null',
  }),
  status: text('status').notNull(), // healthy | degraded | down | unknown
  statusCode: integer('status_code'),
  responseTimeMs: integer('response_time_ms'),
  errorMessage: text('error_message'),
  checkedAt: text('checked_at').notNull(),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull(),
});

// ─── Deployment Records ──────────────────────────────────────────────────────
export const deploymentRecords = sqliteTable('deployment_records', {
  id: text('id').primaryKey(),
  websiteId: text('website_id')
    .references(() => websites.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), // vercel | github_actions | semaphore | kubernetes
  externalId: text('external_id').notNull(),
  status: text('status').notNull(), // pending | building | deploying | success | failed | cancelled
  environment: text('environment'), // production | staging | preview
  branch: text('branch'),
  commitSha: text('commit_sha'),
  commitMessage: text('commit_message'),
  author: text('author'),
  url: text('url'),
  buildDurationMs: integer('build_duration_ms'),
  deployDurationMs: integer('deploy_duration_ms'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Remote Agents ───────────────────────────────────────────────────────────
export const remoteAgents = sqliteTable('remote_agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: integer('port').default(22),
  username: text('username').notNull(),
  status: text('status').notNull().default('unknown'), // online | offline | installing | error | unknown
  version: text('version'),
  lastHeartbeatAt: text('last_heartbeat_at'),
  installedAt: text('installed_at'),
  locationCity: text('location_city'),
  locationCountry: text('location_country'),
  publicKey: text('public_key'), // Ed25519 public key (base64)
  config: text('config', { mode: 'json' }).$type<Record<string, unknown>>(),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Status Pages ───────────────────────────────────────────────────────────
export const statusPages = sqliteTable('status_pages', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  domain: text('domain').notNull(),
  agentId: text('agent_id').references(() => remoteAgents.id, { onDelete: 'cascade' }),
  theme: text('theme').notNull().default('dark'), // dark | light | minimal
  brandingLogo: text('branding_logo'),
  brandingColor: text('branding_color'),
  brandingCompany: text('branding_company'),
  config: text('config', { mode: 'json' }).$type<Record<string, unknown>>(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Integration Configs ─────────────────────────────────────────────────────
export const integrationConfigs = sqliteTable('integration_configs', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(), // github | vercel | digitalocean | kubernetes | slack | bitbucket | semaphore
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  config: text('config', { mode: 'json' }).$type<Record<string, unknown>>(),
  lastSyncAt: text('last_sync_at'),
  lastSyncStatus: text('last_sync_status'), // success | failed | partial
  lastSyncError: text('last_sync_error'),
  syncIntervalSeconds: integer('sync_interval_seconds').default(300),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── App Settings ─────────────────────────────────────────────────────────────
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Log View Configs ────────────────────────────────────────────────────────
export const logViewConfigs = sqliteTable('log_view_configs', {
  id: text('id').primaryKey(), // ULID
  name: text('name').notNull(),
  config: text('config', { mode: 'json' }).$type<LogViewConfigData>(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export interface LogViewConfigData {
  selectedServiceIds?: string[];
  sources?: string[];
  levels?: string[];
  since?: string;
  search?: string;
  columns?: string[];
}

// ─── Audit Log ───────────────────────────────────────────────────────────────
export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  action: text('action').notNull(), // e.g. customer.create, website.update, incident.resolve
  entityType: text('entity_type').notNull(), // customer | website | incident | ...
  entityId: text('entity_id').notNull(),
  actor: text('actor'), // user or system
  before: text('before', { mode: 'json' }).$type<Record<string, unknown>>(),
  after: text('after', { mode: 'json' }).$type<Record<string, unknown>>(),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull(),
});

// ─── Notification Rules ──────────────────────────────────────────────────────
export const notificationRules = sqliteTable('notification_rules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  eventType: text('event_type').notNull(), // incident.opened | incident.resolved | deployment.failed | health.down
  severity: text('severity'), // critical | warning | info | null for all
  channel: text('channel').notNull(), // slack | email | webhook
  channelConfig: text('channel_config', { mode: 'json' }).$type<Record<string, unknown>>(),
  cooldownMinutes: integer('cooldown_minutes').default(15),
  lastNotifiedAt: text('last_notified_at'),
  websiteFilter: text('website_filter', { mode: 'json' }).$type<string[]>(), // website IDs or null for all
  projectFilter: text('customer_filter', { mode: 'json' }).$type<string[]>(), // project IDs or null for all
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
