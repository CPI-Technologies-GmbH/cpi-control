/**
 * CPI-Control Demo Data Seeder
 * Creates realistic-looking fake data for marketing screenshots & videos.
 *
 * Usage: node scripts/seed-demo-data.mjs [--db-path <path>]
 */

import { createRequire } from 'module';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../packages/backend/'));
const Database = require('better-sqlite3');

const dbPath = process.argv.includes('--db-path')
  ? process.argv[process.argv.indexOf('--db-path') + 1]
  : path.join(os.homedir(), 'Library/Application Support/com.cpi-technologies.cpi-control/data.db');

console.log(`Seeding demo data into: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Helpers ──────────────────────────────────────────────────────────────

let ulidCounter = 0;
function ulid() {
  const ts = Date.now().toString(36).toUpperCase().padStart(10, '0');
  const rand = (++ulidCounter).toString(36).toUpperCase().padStart(16, '0');
  return ts + rand;
}

function ago(hours) {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const now = new Date().toISOString();

// ─── Clear existing data ──────────────────────────────────────────────────

console.log('Clearing existing data...');
db.exec(`
  DELETE FROM incident_events;
  DELETE FROM incidents;
  DELETE FROM deployment_records;
  DELETE FROM health_check_results;
  DELETE FROM deployment_sources;
  DELETE FROM repository_bindings;
  DELETE FROM infrastructure_bindings;
  DELETE FROM monitoring_targets;
  DELETE FROM websites;
  DELETE FROM customers;
  DELETE FROM integration_configs;
  DELETE FROM notification_rules;
`);

// ─── Projects ─────────────────────────────────────────────────────────────

const projects = [
  { name: 'CloudStore', slug: 'cloudstore', icon: '🛒', email: 'team@cloudstore.io', notes: 'E-Commerce platform — 50K DAU, multi-region deployment' },
  { name: 'HealthPulse', slug: 'healthpulse', icon: '💊', email: 'ops@healthpulse.com', notes: 'Healthcare SaaS — HIPAA compliant, zero-downtime required' },
  { name: 'FinanceHub', slug: 'financehub', icon: '💰', email: 'sre@financehub.dev', notes: 'Fintech platform — PCI-DSS, real-time transaction processing' },
  { name: 'EduLearn', slug: 'edulearn', icon: '📚', email: 'dev@edulearn.app', notes: 'EdTech platform — 200K students, video streaming + LMS' },
  { name: 'TravelWise', slug: 'travelwise', icon: '✈️', email: 'platform@travelwise.co', notes: 'Travel booking platform — seasonal traffic spikes' },
  { name: 'DevForge', slug: 'devforge', icon: '🔧', email: 'infra@devforge.tools', notes: 'Internal developer tools & CI/CD infrastructure' },
];

const projectIds = {};
const insertProject = db.prepare(`
  INSERT INTO customers (id, name, slug, icon, contact_email, notes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const p of projects) {
  const id = ulid();
  projectIds[p.slug] = id;
  insertProject.run(id, p.name, p.slug, p.icon, p.email, p.notes, ago(720), now);
}
console.log(`Created ${projects.length} projects`);

// ─── Services ─────────────────────────────────────────────────────────────

const services = [
  // CloudStore
  { name: 'cloudstore-web', project: 'cloudstore', type: 'website', url: 'https://app.cloudstore.io', env: 'production', hosting: 'vercel', status: 'healthy' },
  { name: 'cloudstore-api', project: 'cloudstore', type: 'service', url: 'https://api.cloudstore.io', env: 'production', hosting: 'kubernetes', status: 'healthy' },
  { name: 'cloudstore-worker', project: 'cloudstore', type: 'service', url: null, env: 'production', hosting: 'kubernetes', status: 'healthy' },
  { name: 'cloudstore-staging', project: 'cloudstore', type: 'website', url: 'https://staging.cloudstore.io', env: 'staging', hosting: 'vercel', status: 'healthy' },
  { name: 'cloudstore-payments', project: 'cloudstore', type: 'service', url: null, env: 'production', hosting: 'kubernetes', status: 'healthy' },

  // HealthPulse
  { name: 'healthpulse-portal', project: 'healthpulse', type: 'website', url: 'https://portal.healthpulse.com', env: 'production', hosting: 'kubernetes', status: 'healthy' },
  { name: 'healthpulse-api', project: 'healthpulse', type: 'service', url: 'https://api.healthpulse.com', env: 'production', hosting: 'kubernetes', status: 'healthy' },
  { name: 'healthpulse-scheduler', project: 'healthpulse', type: 'service', url: null, env: 'production', hosting: 'kubernetes', status: 'degraded' },
  { name: 'healthpulse-notifications', project: 'healthpulse', type: 'service', url: null, env: 'production', hosting: 'kubernetes', status: 'healthy' },

  // FinanceHub
  { name: 'financehub-dashboard', project: 'financehub', type: 'website', url: 'https://app.financehub.dev', env: 'production', hosting: 'vercel', status: 'healthy' },
  { name: 'financehub-api', project: 'financehub', type: 'service', url: 'https://api.financehub.dev', env: 'production', hosting: 'kubernetes', status: 'healthy' },
  { name: 'financehub-ledger', project: 'financehub', type: 'service', url: null, env: 'production', hosting: 'kubernetes', status: 'healthy' },
  { name: 'financehub-fraud-detection', project: 'financehub', type: 'service', url: null, env: 'production', hosting: 'aws', status: 'healthy' },
  { name: 'financehub-staging', project: 'financehub', type: 'website', url: 'https://staging.financehub.dev', env: 'staging', hosting: 'vercel', status: 'down' },

  // EduLearn
  { name: 'edulearn-web', project: 'edulearn', type: 'website', url: 'https://learn.edulearn.app', env: 'production', hosting: 'vercel', status: 'healthy' },
  { name: 'edulearn-api', project: 'edulearn', type: 'service', url: 'https://api.edulearn.app', env: 'production', hosting: 'kubernetes', status: 'healthy' },
  { name: 'edulearn-video', project: 'edulearn', type: 'service', url: null, env: 'production', hosting: 'aws', status: 'healthy' },
  { name: 'edulearn-cdn', project: 'edulearn', type: 'service', url: 'https://cdn.edulearn.app', env: 'production', hosting: 'gcloud', status: 'healthy' },

  // TravelWise
  { name: 'travelwise-web', project: 'travelwise', type: 'website', url: 'https://www.travelwise.co', env: 'production', hosting: 'vercel', status: 'healthy' },
  { name: 'travelwise-api', project: 'travelwise', type: 'service', url: 'https://api.travelwise.co', env: 'production', hosting: 'kubernetes', status: 'healthy' },
  { name: 'travelwise-search', project: 'travelwise', type: 'service', url: null, env: 'production', hosting: 'kubernetes', status: 'healthy' },
  { name: 'travelwise-booking', project: 'travelwise', type: 'service', url: null, env: 'production', hosting: 'kubernetes', status: 'degraded' },

  // DevForge (internal)
  { name: 'devforge-ci', project: 'devforge', type: 'service', url: 'https://ci.devforge.tools', env: 'production', hosting: 'kubernetes', status: 'healthy' },
  { name: 'devforge-registry', project: 'devforge', type: 'service', url: null, env: 'production', hosting: 'kubernetes', status: 'healthy' },
  { name: 'devforge-docs', project: 'devforge', type: 'website', url: 'https://docs.devforge.tools', env: 'production', hosting: 'vercel', status: 'healthy' },

  // Unassigned
  { name: 'redis-cluster', project: null, type: 'service', url: null, env: 'production', hosting: 'kubernetes', status: 'healthy' },
  { name: 'postgresql-primary', project: null, type: 'service', url: null, env: 'production', hosting: 'kubernetes', status: 'healthy' },
  { name: 'monitoring-stack', project: null, type: 'service', url: null, env: 'production', hosting: 'kubernetes', status: 'healthy' },
];

const serviceIds = {};
const insertService = db.prepare(`
  INSERT INTO websites (id, customer_id, name, type, url, environment, hosting_type, status, expected_status_code, check_interval_seconds, metadata, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 200, 60, ?, ?, ?)
`);

for (const s of services) {
  const id = ulid();
  serviceIds[s.name] = id;
  const pid = s.project ? projectIds[s.project] : null;
  const meta = JSON.stringify({ provider: s.hosting, projectKey: `${s.hosting}:${s.name}` });
  insertService.run(id, pid, s.name, s.type, s.url, s.env, s.hosting, s.status, meta, ago(720), now);
}
console.log(`Created ${services.length} services`);

// ─── Health Check Results (last 7 days) ───────────────────────────────────

const insertHealthCheck = db.prepare(`
  INSERT INTO health_check_results (id, website_id, status, status_code, response_time_ms, checked_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

let healthCheckCount = 0;
const publicServices = services.filter(s => s.type === 'website' && s.url);

for (const svc of publicServices) {
  const sid = serviceIds[svc.name];
  // Generate health checks every hour for last 7 days
  for (let h = 168; h >= 0; h--) {
    const checkedAt = ago(h);
    const isDown = svc.status === 'down' && h < 3;
    const isDegraded = svc.status === 'degraded' && h < 12 && Math.random() > 0.5;
    const status = isDown ? 'down' : isDegraded ? 'degraded' : 'healthy';
    const statusCode = isDown ? 503 : isDegraded ? 429 : 200;
    const responseTime = isDown ? 15 : isDegraded ? randomBetween(2000, 5000) : randomBetween(50, 400);

    insertHealthCheck.run(ulid(), sid, status, statusCode, responseTime, checkedAt, checkedAt);
    healthCheckCount++;
  }
}
console.log(`Created ${healthCheckCount} health check results`);

// ─── Deployments ──────────────────────────────────────────────────────────

const insertDeployment = db.prepare(`
  INSERT INTO deployment_records (id, website_id, provider, external_id, status, environment, branch, commit_sha, commit_message, author, started_at, completed_at, build_duration_ms, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const commitMessages = [
  'feat: add real-time notifications',
  'fix: resolve memory leak in worker process',
  'chore: update dependencies to latest versions',
  'feat: implement two-factor authentication',
  'fix: correct timezone handling in scheduler',
  'refactor: migrate to new API client',
  'feat: add export functionality for reports',
  'fix: resolve race condition in payment flow',
  'perf: optimize database queries for dashboard',
  'feat: implement role-based access control',
  'fix: handle edge case in search indexing',
  'chore: upgrade Node.js to v22',
  'feat: add dark mode support',
  'fix: resolve CORS issue with CDN',
  'feat: implement webhook retry mechanism',
  'refactor: extract shared UI components',
  'fix: correct decimal precision in ledger',
  'feat: add batch import for users',
  'perf: implement Redis caching layer',
  'feat: add audit log for compliance',
];

const authors = ['Sarah Chen', 'Marcus Weber', 'Elena Rodriguez', 'James Park', 'Priya Sharma', 'Tom Fischer', 'Lisa Nguyen'];
const branches = ['main', 'develop', 'feature/auth', 'fix/payments', 'release/v2.1'];

let deploymentCount = 0;
for (const svc of services) {
  const sid = serviceIds[svc.name];
  const provider = svc.hosting === 'vercel' ? 'vercel' : svc.hosting === 'kubernetes' ? 'kubernetes' : 'github_actions';
  const numDeploys = randomBetween(3, 12);

  for (let i = 0; i < numDeploys; i++) {
    const hoursAgo = randomBetween(1, 168);
    const startedAt = ago(hoursAgo);
    const durationMs = randomBetween(30000, 300000);
    const completedAt = new Date(new Date(startedAt).getTime() + durationMs).toISOString();
    const status = Math.random() > 0.1 ? 'success' : Math.random() > 0.5 ? 'failed' : 'cancelled';
    const sha = [...Array(40)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

    insertDeployment.run(
      ulid(), sid, provider, `deploy-${ulid()}`, status,
      svc.env, pick(branches), sha, pick(commitMessages), pick(authors),
      startedAt, completedAt, durationMs, startedAt, completedAt
    );
    deploymentCount++;
  }
}
console.log(`Created ${deploymentCount} deployments`);

// ─── Incidents ────────────────────────────────────────────────────────────

const insertIncident = db.prepare(`
  INSERT INTO incidents (id, website_id, title, severity, status, detected_at, acknowledged_at, resolved_at, acknowledged_by, resolved_by, root_cause, summary, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertIncidentEvent = db.prepare(`
  INSERT INTO incident_events (id, incident_id, type, message, source, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const incidentData = [
  {
    service: 'financehub-staging', severity: 'critical', status: 'open',
    title: 'financehub-staging is down',
    hoursAgo: 2, summary: 'Staging environment returning HTTP 503 after latest deployment. Database connection pool exhausted.',
  },
  {
    service: 'healthpulse-scheduler', severity: 'warning', status: 'acknowledged',
    title: 'healthpulse-scheduler is degraded',
    hoursAgo: 6, ackHoursAgo: 5, acknowledgedBy: 'Priya Sharma',
    summary: 'Scheduler experiencing elevated latency. Background jobs completing 3x slower than normal.',
  },
  {
    service: 'travelwise-booking', severity: 'warning', status: 'acknowledged',
    title: 'travelwise-booking is degraded',
    hoursAgo: 4, ackHoursAgo: 3.5, acknowledgedBy: 'Marcus Weber',
    summary: 'Booking service showing intermittent 429 rate limit errors from upstream payment provider.',
  },
  {
    service: 'cloudstore-api', severity: 'critical', status: 'resolved',
    title: 'cloudstore-api is down',
    hoursAgo: 48, ackHoursAgo: 47.5, resolvedHoursAgo: 46, acknowledgedBy: 'Sarah Chen', resolvedBy: 'Sarah Chen',
    rootCause: 'Memory leak in order processing module caused OOM kills',
    summary: 'API pods crashed due to memory leak. Rolled back to previous version and deployed hotfix.',
  },
  {
    service: 'edulearn-api', severity: 'warning', status: 'resolved',
    title: 'edulearn-api is degraded',
    hoursAgo: 72, ackHoursAgo: 71, resolvedHoursAgo: 70, acknowledgedBy: 'James Park', resolvedBy: 'James Park',
    rootCause: 'Unoptimized database query on course enrollment endpoint',
    summary: 'Slow response times on enrollment API. Query optimization reduced p99 from 5s to 200ms.',
  },
  {
    service: 'cloudstore-web', severity: 'info', status: 'resolved',
    title: 'Elevated error rate on cloudstore-web',
    hoursAgo: 120, ackHoursAgo: 119, resolvedHoursAgo: 118, acknowledgedBy: 'Elena Rodriguez', resolvedBy: 'Elena Rodriguez',
    rootCause: 'CDN cache invalidation caused spike in origin requests',
    summary: 'Brief spike in 502 errors after CDN purge. Self-resolved after cache warm-up.',
  },
];

for (const inc of incidentData) {
  const id = ulid();
  const sid = serviceIds[inc.service];
  const detected = ago(inc.hoursAgo);
  const ack = inc.ackHoursAgo ? ago(inc.ackHoursAgo) : null;
  const resolved = inc.resolvedHoursAgo ? ago(inc.resolvedHoursAgo) : null;

  insertIncident.run(
    id, sid, inc.title, inc.severity, inc.status, detected,
    ack, resolved, inc.acknowledgedBy || null, inc.resolvedBy || null,
    inc.rootCause || null, inc.summary, detected, now
  );

  // Add timeline events
  insertIncidentEvent.run(ulid(), id, 'detected', `Service ${inc.service} detected as ${inc.severity === 'critical' ? 'down' : 'degraded'}`, 'system', detected);
  if (ack) {
    insertIncidentEvent.run(ulid(), id, 'acknowledged', `Acknowledged by ${inc.acknowledgedBy}`, 'user', ack);
  }
  if (resolved) {
    insertIncidentEvent.run(ulid(), id, 'resolved', `Resolved by ${inc.resolvedBy}. Root cause: ${inc.rootCause}`, 'user', resolved);
  }
}
console.log(`Created ${incidentData.length} incidents`);

// ─── Integration Configs ──────────────────────────────────────────────────

// Integrations disabled so the sync scheduler doesn't overwrite demo data with real data
const insertIntegration = db.prepare(`
  INSERT OR IGNORE INTO integration_configs (id, provider, name, enabled, config, sync_interval_seconds, last_sync_at, last_sync_status, created_at, updated_at)
  VALUES (?, ?, ?, 0, '{}', 300, ?, 'success', ?, ?)
`);

insertIntegration.run(ulid(), 'github', 'GitHub', ago(0.1), ago(720), now);
insertIntegration.run(ulid(), 'vercel', 'Vercel', ago(0.1), ago(720), now);
insertIntegration.run(ulid(), 'kubernetes', 'Kubernetes', ago(0.1), ago(720), now);
console.log('Created integration configs');

// ─── App Settings ─────────────────────────────────────────────────────────

db.prepare(`INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('onboardingCompleted', 'true', ?)`).run(now);
db.prepare(`INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('logBufferSize', '10000', ?)`).run(now);
console.log('Set app settings');

// ─── Done ─────────────────────────────────────────────────────────────────

db.close();
console.log('\nDemo data seeded successfully!');
console.log('Restart the app to see the changes.');
