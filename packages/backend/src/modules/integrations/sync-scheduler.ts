import { createChildLogger } from '../../shared/logger.js';
import { eventBus, type DeploymentEventType, type ServiceEventType } from '../../shared/event-bus.js';
import type { DB } from '../../db/client.js';
import type { ProviderAdapter, SyncOptions, SyncResult } from '../../shared/provider-interface.js';
import type { SecretStore } from '../secrets/keychain.js';
import * as integrationService from './service.js';
import {
  projects,
  deploymentRecords,
  deploymentSources,
  infrastructureBindings,
  monitoringTargets,
  repositoryBindings,
  websites,
} from '../../db/schema.js';
import { ulid } from 'ulid';
import { eq, and, isNotNull } from 'drizzle-orm';
import type { SyncedDeployment } from '../../shared/provider-interface.js';

const log = createChildLogger('sync-scheduler');

/** Extract a YAML value from "key: value" (handles quoted strings) */
function yamlValue(line: string): string {
  const idx = line.indexOf(':');
  if (idx === -1) return '';
  return line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
}

/** Parse kubeconfig YAML content to extract apiServer, token, caCert, clientCert, clientKey.
 *  Respects current-context to select the correct cluster and user. */
function parseKubeconfig(content: string): {
  apiServer?: string;
  token?: string;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
} {
  const lines = content.split('\n');

  // Step 1: Find current-context
  let currentContext = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('current-context:')) {
      currentContext = yamlValue(trimmed);
      break;
    }
  }

  // Step 2: Parse contexts to find which cluster name and user name the current-context uses
  let targetCluster = '';
  let targetUser = '';
  {
    let inContexts = false;
    let inContextBlock = false;
    let contextName = '';
    let clusterName = '';
    let userName = '';

    for (const line of lines) {
      const trimmed = line.trim();
      // Top-level keys (no indentation)
      if (line.match(/^\S/) && trimmed.startsWith('contexts:')) {
        inContexts = true;
        inContextBlock = false;
        continue;
      }
      // Another top-level key ends the contexts section
      if (inContexts && line.match(/^\S/) && !trimmed.startsWith('-')) {
        inContexts = false;
        continue;
      }
      if (!inContexts) continue;

      // New list item in contexts
      if (trimmed.startsWith('- context:') || trimmed === '- context:') {
        // Save previous context if matched
        if (inContextBlock && contextName === currentContext) {
          targetCluster = clusterName;
          targetUser = userName;
        }
        inContextBlock = true;
        contextName = '';
        clusterName = '';
        userName = '';
        continue;
      }
      if (inContextBlock) {
        if (trimmed.startsWith('cluster:')) {
          clusterName = yamlValue(trimmed);
        } else if (trimmed.startsWith('user:')) {
          userName = yamlValue(trimmed);
        } else if (trimmed.startsWith('name:')) {
          contextName = yamlValue(trimmed);
        }
      }
    }
    // Check last context block
    if (inContextBlock && contextName === currentContext) {
      targetCluster = clusterName;
      targetUser = userName;
    }
  }

  // Step 3: Parse clusters to find the matching cluster's server, ca-cert
  let apiServer: string | undefined;
  let caCert: string | undefined;
  {
    let inClusters = false;
    let inClusterBlock = false;
    let clusterName = '';
    let server = '';
    let ca = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (line.match(/^\S/) && trimmed.startsWith('clusters:')) {
        inClusters = true;
        inClusterBlock = false;
        continue;
      }
      if (inClusters && line.match(/^\S/) && !trimmed.startsWith('-')) {
        inClusters = false;
        continue;
      }
      if (!inClusters) continue;

      if (trimmed.startsWith('- cluster:') || trimmed === '- cluster:') {
        // Save previous
        if (inClusterBlock && clusterName === targetCluster) {
          apiServer = server || undefined;
          caCert = ca || undefined;
        }
        inClusterBlock = true;
        clusterName = '';
        server = '';
        ca = '';
        continue;
      }
      if (inClusterBlock) {
        if (trimmed.startsWith('server:')) {
          server = yamlValue(trimmed);
        } else if (trimmed.startsWith('certificate-authority-data:')) {
          ca = yamlValue(trimmed);
        } else if (trimmed.startsWith('name:')) {
          clusterName = yamlValue(trimmed);
        }
      }
    }
    if (inClusterBlock && clusterName === targetCluster) {
      apiServer = server || undefined;
      caCert = ca || undefined;
    }
  }

  // Step 4: Parse users to find the matching user's token, client-cert, client-key
  let token: string | undefined;
  let clientCert: string | undefined;
  let clientKey: string | undefined;
  {
    let inUsers = false;
    let inUserBlock = false;
    let userName = '';
    let userToken = '';
    let cert = '';
    let key = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (line.match(/^\S/) && trimmed.startsWith('users:')) {
        inUsers = true;
        inUserBlock = false;
        continue;
      }
      if (inUsers && line.match(/^\S/) && !trimmed.startsWith('-')) {
        inUsers = false;
        continue;
      }
      if (!inUsers) continue;

      if (trimmed.startsWith('- name:')) {
        // Save previous
        if (inUserBlock && userName === targetUser) {
          token = userToken || undefined;
          clientCert = cert || undefined;
          clientKey = key || undefined;
        }
        inUserBlock = true;
        userName = yamlValue(trimmed);
        userToken = '';
        cert = '';
        key = '';
        continue;
      }
      if (inUserBlock) {
        if (trimmed.startsWith('token:')) {
          userToken = yamlValue(trimmed);
        } else if (trimmed.startsWith('client-certificate-data:')) {
          cert = yamlValue(trimmed);
        } else if (trimmed.startsWith('client-key-data:')) {
          key = yamlValue(trimmed);
        }
      }
    }
    if (inUserBlock && userName === targetUser) {
      token = userToken || undefined;
      clientCert = cert || undefined;
      clientKey = key || undefined;
    }
  }

  // Fallback: if no current-context matched, just grab the first server found
  if (!apiServer) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('server:')) {
        apiServer = yamlValue(trimmed);
        break;
      }
    }
  }

  return { apiServer, token, caCert, clientCert, clientKey };
}

/** Maps provider name to which secret keys become which config fields */
const SECRET_MAPPING: Record<string, Record<string, string>> = {
  github: { github_token: 'token' },
  vercel: { vercel_token: 'token' },
  kubernetes: { kubeconfig: 'kubeconfig' },
  digitalocean: { digitalocean_token: 'token' },
  semaphore: { semaphore_token: 'token', semaphore_org_url: 'orgUrl' },
};

interface SyncJob {
  integrationId: string;
  provider: string;
  intervalMs: number;
  timer?: ReturnType<typeof setInterval>;
  lastRun?: Date;
  isRunning: boolean;
}

export class SyncScheduler {
  private jobs = new Map<string, SyncJob>();
  private adapters = new Map<string, ProviderAdapter>();
  private db: DB;
  private secretStore?: SecretStore;

  constructor(db: DB, secretStore?: SecretStore) {
    this.db = db;
    this.secretStore = secretStore;
  }

  setSecretStore(store: SecretStore): void {
    this.secretStore = store;
  }

  /** Resolve secrets from store and inject into adapter config */
  private async resolveSecrets(provider: string, config: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.secretStore) return config;

    const mapping = SECRET_MAPPING[provider];
    if (!mapping) return config;

    const resolved = { ...config };
    for (const [secretKey, configField] of Object.entries(mapping)) {
      if (!resolved[configField]) {
        const value = await this.secretStore.get(secretKey);
        if (value) {
          resolved[configField] = value;
        }
      }
    }

    // Special handling for kubernetes: parse kubeconfig to extract apiServer, token, caCert, clientCert, clientKey
    if (provider === 'kubernetes' && typeof resolved.kubeconfig === 'string' && !resolved.apiServer) {
      const kubeconfigContent = resolved.kubeconfig;
      const parsed = parseKubeconfig(kubeconfigContent);
      if (parsed.apiServer) {
        resolved.apiServer = parsed.apiServer;
        log.info({ apiServer: parsed.apiServer }, 'Parsed apiServer from kubeconfig');
      }
      if (parsed.token && !resolved.token) {
        resolved.token = parsed.token;
        log.info('Parsed token from kubeconfig');
      }
      if (parsed.caCert && !resolved.caCert) {
        resolved.caCert = parsed.caCert;
        log.info('Parsed caCert from kubeconfig');
      }
      if (parsed.clientCert && !resolved.clientCert) {
        resolved.clientCert = parsed.clientCert;
        log.info('Parsed clientCert from kubeconfig');
      }
      if (parsed.clientKey && !resolved.clientKey) {
        resolved.clientKey = parsed.clientKey;
        log.info('Parsed clientKey from kubeconfig');
      }
    }

    return resolved;
  }

  registerAdapter(provider: string, adapter: ProviderAdapter): void {
    this.adapters.set(provider, adapter);
    log.info({ provider }, 'Registered sync adapter');
  }

  async startAll(): Promise<void> {
    const integrations = await integrationService.listIntegrations(this.db);
    for (const integration of integrations) {
      if (integration.enabled) {
        this.scheduleJob(integration.id, integration.provider, (integration.syncIntervalSeconds || 300) * 1000);
      }
    }
    log.info({ jobCount: this.jobs.size }, 'Started all sync jobs');

    // Run initial sync in background (don't block server startup)
    const enabledIntegrations = integrations.filter(i => i.enabled);
    if (enabledIntegrations.length > 0) {
      this.runInitialSyncs(enabledIntegrations).catch(err => {
        log.error({ error: err.message }, 'Initial sync batch failed');
      });
    }
  }

  private async runInitialSyncs(integrations: Array<{ id: string; provider: string }>): Promise<void> {
    for (const integration of integrations) {
      try {
        log.info({ provider: integration.provider }, 'Running initial sync');
        await this.triggerSync(integration.id);
      } catch (err: any) {
        log.warn({ provider: integration.provider, error: err.message }, 'Initial sync failed');
      }
    }
    log.info({ count: integrations.length }, 'Initial syncs completed');
  }

  scheduleJob(integrationId: string, provider: string, intervalMs: number): void {
    // Remove existing job if any
    this.removeJob(integrationId);

    const job: SyncJob = {
      integrationId,
      provider,
      intervalMs,
      isRunning: false,
    };

    job.timer = setInterval(() => this.executeJob(job), intervalMs);
    this.jobs.set(integrationId, job);
    log.info({ integrationId, provider, intervalMs }, 'Scheduled sync job');
  }

  removeJob(integrationId: string): void {
    const job = this.jobs.get(integrationId);
    if (job?.timer) {
      clearInterval(job.timer);
    }
    this.jobs.delete(integrationId);
  }

  async triggerSync(integrationId: string, options?: SyncOptions): Promise<{ success: boolean; message: string }> {
    const integration = await integrationService.getIntegration(this.db, integrationId);
    if (!integration) {
      return { success: false, message: 'Integration not found' };
    }

    const adapter = this.adapters.get(integration.provider);
    if (!adapter) {
      return { success: false, message: `No adapter registered for provider: ${integration.provider}` };
    }

    try {
      await integrationService.updateSyncStatus(this.db, integrationId, 'running');
      const resolvedConfig = await this.resolveSecrets(
        integration.provider,
        (integration.config as Record<string, unknown>) || {}
      );
      const result = await adapter.sync(resolvedConfig, options || {});

      // Auto-discover services from synced deployments, then persist and update statuses
      if (result.data?.deployments?.length || result.data?.k8sServices?.length) {
        this.autoDiscoverServices(result.data.deployments || [], integration.provider, result);

        const persisted = this.persistDeployments(result);
        log.info(
          { integrationId, deploymentsStored: persisted },
          'Persisted deployment records from sync'
        );

        // Update service statuses based on provider data
        this.updateServiceStatuses(result, integration.provider);
      }

      // Ensure monitoring targets exist for all public services with URLs
      this.ensureMonitoringTargets();

      if (result.success) {
        await integrationService.updateSyncStatus(this.db, integrationId, 'success');
        return { success: true, message: `Synced ${result.itemsSynced} items in ${result.durationMs}ms` };
      } else {
        const errorMsg = result.errors.map((e) => e.error).join('; ');
        await integrationService.updateSyncStatus(this.db, integrationId, 'failed', errorMsg);
        return { success: false, message: errorMsg };
      }
    } catch (err: any) {
      await integrationService.updateSyncStatus(this.db, integrationId, 'failed', err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * Infer hosting type from workflow names and deployment metadata.
   * Priority: look at the main deploy workflow (DEV - ... Deploy to X) first.
   */
  private inferHostingType(workflowNames: string[], provider: string, _meta?: Record<string, unknown> | null): string {
    if (provider === 'kubernetes') return 'kubernetes';
    if (provider === 'vercel') return 'vercel';

    // Look at deploy-specific workflows first (prioritize the actual deploy target)
    const deployWorkflows = workflowNames.filter(w => {
      const l = w.toLowerCase();
      return l.includes('deploy') || l.includes('push');
    });
    const searchList = deployWorkflows.length > 0 ? deployWorkflows : workflowNames;
    const combined = searchList.join(' ').toLowerCase();

    // Priority order: explicit hosting/deployment target mentions
    if (combined.includes('vercel')) return 'vercel';
    if (combined.includes('ovh')) return 'ovh';
    if (combined.includes('doks')) return 'digitalocean';
    if (combined.includes('eks') || combined.includes('kubernetes') || combined.includes('k8s')) return 'kubernetes';
    // DOCR (DigitalOcean Container Registry) and ECR (AWS Elastic Container Registry)
    // are container registries, NOT hosting targets. Images pushed there are typically
    // deployed to Kubernetes. Only match explicit "digitalocean" mentions for DO hosting.
    if (combined.includes('digitalocean') && !combined.includes('docr')) return 'digitalocean';
    if (combined.includes('docr') || combined.includes('ecr')) return 'docker';

    // Fallback: check all workflows
    const allCombined = workflowNames.join(' ').toLowerCase();
    if (allCombined.includes('vercel')) return 'vercel';
    if (allCombined.includes('ovh')) return 'ovh';

    // Default based on provider
    if (provider === 'semaphore') return 'semaphore';

    // Docker-related workflows likely target a container platform
    if (allCombined.includes('docker')) return 'docker';

    // GitHub is a code host, not a deployment target. If we can't determine
    // the hosting from workflows, return 'other' rather than 'github'.
    return 'other';
  }

  /**
   * Infer whether a service is a website (Public) or internal service (Private).
   *
   * Services deployed to kubernetes/ovh/digitalocean with Ingress are externally
   * accessible (Public), except for truly internal-only components like KMS, engines,
   * proxies, themes, and keycloak.
   */
  private inferServiceType(name: string, url: string | undefined, hostingType: string, _workflowNames: string[]): 'website' | 'service' {
    // Only count actual app URLs, not CI/CD run URLs
    const hasAppUrl = url && !url.includes('github.com/') && !url.includes('/actions/runs/');
    if (hasAppUrl) return 'website';
    if (hostingType === 'vercel') return 'website';

    const lower = name.toLowerCase();

    // Explicitly frontend/web names are always public
    if (lower.includes('frontend') || lower.includes('website') || lower.includes('web-app') || lower.includes('admin-panel') || lower.includes('crossplatform')) return 'website';

    // Truly internal-only services (Private) regardless of hosting
    const internalKeywords = ['kms', 'engine', 'proxy', 'theme', 'keycloak'];
    if (internalKeywords.some(kw => lower.includes(kw))) return 'service';

    // Services on kubernetes/ovh/digitalocean are externally accessible (Public)
    // because they typically have Ingress / load balancer exposure
    const externalHosting = ['kubernetes', 'ovh', 'digitalocean'];
    if (externalHosting.includes(hostingType)) {
      const publicKeywords = ['backend', 'service', 'api', 'server', 'mailing', 'payment', 'profile', 'invoices', 'dining', 'flight', 'demo', 'mcp'];
      if (publicKeywords.some(kw => lower.includes(kw))) return 'website';
    }

    return 'service';
  }

  /**
   * Auto-discover services from synced deployments.
   * Groups deployments by project/app name and creates or updates service records.
   */
  private autoDiscoverServices(deployments: SyncedDeployment[], provider: string, result?: SyncResult): void {
    const now = new Date().toISOString();

    // Get a default project (first available, or null)
    const allProjects = this.db.select().from(projects).all();
    const defaultProjectId = allProjects.length > 0 ? allProjects[0].id : null;

    // Group deployments by project, collecting all workflow names and URLs
    interface ProjectInfo {
      name: string;
      environment: string;
      urls: string[];
      workflowNames: string[];
      repoFullName?: string;
      metadata: Record<string, unknown>;
      hasIngress?: boolean;
      ingressHosts?: string[];
    }
    const discoveredProjects = new Map<string, ProjectInfo>();

    // For Kubernetes: use k8sServices + k8sIngresses as primary discovery source when available
    if (provider === 'kubernetes' && result?.data?.k8sServices?.length) {
      const k8sServices = result.data.k8sServices;
      const k8sIngresses = result.data.k8sIngresses || [];

      // Build ingress lookup map: serviceName -> { hosts }
      const ingressByService = new Map<string, { hosts: string[] }>();
      for (const ing of k8sIngresses) {
        for (const path of ing.paths) {
          if (!path.serviceName) continue;
          const existing = ingressByService.get(path.serviceName);
          if (existing) {
            if (path.host && !existing.hosts.includes(path.host)) {
              existing.hosts.push(path.host);
            }
          } else {
            ingressByService.set(path.serviceName, {
              hosts: path.host ? [path.host] : [],
            });
          }
        }
      }

      // Create service records from K8s Services (skip infrastructure)
      const infraPatterns = [
        // Databases & caches
        'redis', 'postgresql', 'postgres', 'mysql', 'mariadb', 'mongodb', 'meilisearch',
        'elasticsearch', 'cassandra', 'memcached',
        // Message queues
        'kafka', 'rabbitmq', 'nats', 'zookeeper',
        // Observability / monitoring infrastructure
        'openobserve', 'o2c-', 'collector-agent', 'collector-gateway', 'targetallocator',
        'prometheus', 'grafana', 'jaeger', 'loki', 'tempo',
        // K8s internal / cert-manager / ingress
        'cm-acme-http-solver', 'dashboard-metrics', 'kubernetes-dashboard',
        // Admin tools
        'pgadmin', 'phpmyadmin', 'adminer',
      ];
      const infraSuffixes = ['-headless', '-hl', '-ha-haproxy'];
      const infraPrefixes = ['redis-release-'];

      for (const svc of k8sServices) {
        // Skip the default kubernetes service
        if (svc.name === 'kubernetes' && svc.namespace === 'default') continue;

        // Skip infrastructure services
        const nameLower = svc.name.toLowerCase();
        const isInfra = infraPatterns.some(p => nameLower.includes(p))
          || infraSuffixes.some(s => nameLower.endsWith(s))
          || infraPrefixes.some(p => nameLower.startsWith(p))
          || nameLower.includes('-announce-'); // Redis HA announce services
        if (isInfra) continue;

        const ingress = ingressByService.get(svc.name);
        const isPublic = !!ingress;
        const url = ingress?.hosts[0] ? `https://${ingress.hosts[0]}` : undefined;

        const projectKey = `k8s:${svc.namespace}/${svc.name}`;
        discoveredProjects.set(projectKey, {
          name: svc.name,
          environment: svc.namespace === 'production' ? 'production' : svc.namespace,
          urls: url ? [url] : [],
          workflowNames: [],
          metadata: {
            provider,
            projectKey,
            namespace: svc.namespace,
            k8sServiceType: svc.type,
            hasIngress: isPublic,
            ingressHosts: ingress?.hosts || [],
            isPublic,
          },
          hasIngress: isPublic,
          ingressHosts: ingress?.hosts || [],
        });
      }
    } else if (provider === 'vercel' && result?.data?.vercelProjects?.length) {
      // Vercel: use vercelProjects as primary discovery source (covers all projects, not just those with recent deployments)
      for (const vp of result.data.vercelProjects) {
        const projectKey = `vercel:${vp.name}`;
        discoveredProjects.set(projectKey, {
          name: vp.name,
          environment: 'production',
          urls: vp.productionUrl ? [vp.productionUrl] : [],
          workflowNames: [],
          metadata: {
            provider,
            projectKey,
            vercelProjectId: vp.id,
            framework: vp.framework,
            domains: vp.domains,
          },
        });
      }
      // Also process deployments for additional metadata (workflow names, repo info)
      for (const dep of deployments) {
        const meta = dep.metadata as Record<string, unknown> | null | undefined;
        const pName = (meta?.projectName as string) || dep.externalId;
        const projectKey = `vercel:${pName}`;
        const proj = discoveredProjects.get(projectKey);
        if (!proj) continue;
        const org = meta?.githubOrg as string | undefined;
        const repo = meta?.githubRepo as string | undefined;
        if (org && repo && !proj.repoFullName) {
          proj.repoFullName = `${org}/${repo}`;
        }
      }
    } else {
      // Non-Kubernetes/Vercel providers (or without rich data): use deployments
      for (const dep of deployments) {
        const meta = dep.metadata as Record<string, unknown> | null | undefined;
        let projectKey: string;
        let projectName: string;
        let repoFullName: string | undefined;

        if (provider === 'kubernetes') {
          const depName = (meta?.deploymentName as string) || dep.externalId;
          const namespace = (meta?.namespace as string) || 'default';
          projectKey = `k8s:${namespace}/${depName}`;
          projectName = depName;
        } else if (provider === 'vercel') {
          const pName = (meta?.projectName as string) || dep.externalId;
          projectKey = `vercel:${pName}`;
          projectName = pName;
          const org = meta?.githubOrg as string | undefined;
          const repo = meta?.githubRepo as string | undefined;
          if (org && repo) repoFullName = `${org}/${repo}`;
        } else if (provider === 'github' || provider === 'github_actions') {
          const repo = (meta?.repo as string) || dep.externalId;
          projectKey = `github:${repo}`;
          projectName = repo.includes('/') ? repo.split('/').pop()! : repo;
          repoFullName = repo;
        } else if (provider === 'semaphore') {
          const pName = (meta?.projectName as string) || dep.externalId;
          projectKey = `semaphore:${pName}`;
          projectName = pName;
        } else {
          continue;
        }

        if (!discoveredProjects.has(projectKey)) {
          discoveredProjects.set(projectKey, {
            name: projectName,
            environment: dep.environment || 'production',
            urls: [],
            workflowNames: [],
            repoFullName,
            metadata: { provider, projectKey, ...(meta || {}) },
          });
        }

        const proj = discoveredProjects.get(projectKey)!;
        const wfName = (meta?.workflowName as string) || dep.commitMessage || '';
        if (wfName && !proj.workflowNames.includes(wfName)) {
          proj.workflowNames.push(wfName);
        }
        // Use Vercel production domain URL (custom domain) when available
        const productionUrl = meta?.productionUrl as string | undefined;
        if (productionUrl && !proj.urls.includes(productionUrl)) {
          // Insert at beginning so custom domain takes precedence
          proj.urls.unshift(productionUrl);
        }
        // Only collect actual app URLs, not CI/CD run links
        if (dep.url && !dep.url.includes('github.com/') && !dep.url.includes('/actions/runs/') && !dep.url.includes('semaphoreci.com/') && !proj.urls.includes(dep.url)) {
          proj.urls.push(dep.url);
        }
      }
    }

    let created = 0;
    let updated = 0;
    for (const [projectKey, proj] of discoveredProjects) {
      try {
        const hostingType = this.inferHostingType(proj.workflowNames, provider, proj.metadata);

        // For Kubernetes with ingress data, use ingress presence to determine type
        let serviceType: 'website' | 'service';
        if (provider === 'kubernetes' && proj.hasIngress !== undefined) {
          serviceType = proj.hasIngress ? 'website' : 'service';
        } else {
          serviceType = this.inferServiceType(proj.name, proj.urls[0], hostingType, proj.workflowNames);
        }

        // Check if service already exists
        const existing = this.db
          .select({ id: websites.id, hostingType: websites.hostingType, type: websites.type, url: websites.url })
          .from(websites)
          .where(eq(websites.name, proj.name))
          .all();

        if (existing.length > 0) {
          // Update existing service if hosting info or URL has changed
          // NOTE: Never overwrite 'type' — it may have been manually corrected
          const svc = existing[0];
          const hostingChanged = svc.hostingType !== hostingType;
          const urlChanged = proj.urls[0] && svc.url !== proj.urls[0];

          // Fix A: Correct stale K8s infra binding namespace
          // When services were first discovered via GitHub, their K8s binding was created
          // with 'default' namespace. Now that K8s service discovery found the real namespace,
          // update the binding's externalId to use the correct namespace.
          if (provider === 'kubernetes' && proj.metadata.namespace) {
            const correctNamespace = proj.metadata.namespace as string;
            const correctExternalId = `${correctNamespace}/${proj.name}`;
            const existingBindings = this.db
              .select({ id: infrastructureBindings.id, externalId: infrastructureBindings.externalId })
              .from(infrastructureBindings)
              .where(
                and(
                  eq(infrastructureBindings.websiteId, svc.id),
                  eq(infrastructureBindings.provider, 'kubernetes'),
                  eq(infrastructureBindings.resourceType, 'deployment')
                )
              )
              .all();

            for (const binding of existingBindings) {
              if (binding.externalId !== correctExternalId) {
                this.db.update(infrastructureBindings)
                  .set({ externalId: correctExternalId, updatedAt: now })
                  .where(eq(infrastructureBindings.id, binding.id))
                  .run();
                log.info(
                  { serviceId: svc.id, name: proj.name, oldExternalId: binding.externalId, newExternalId: correctExternalId },
                  'Corrected K8s infra binding namespace'
                );
              }
            }

            // If no K8s binding exists yet for this service, create one
            if (existingBindings.length === 0) {
              this.db.insert(infrastructureBindings).values({
                id: ulid(),
                websiteId: svc.id,
                provider,
                externalId: correctExternalId,
                resourceType: 'deployment',
                region: null,
                metadata: null,
                createdAt: now,
                updatedAt: now,
              }).run();
              log.info({ serviceId: svc.id, name: proj.name, externalId: correctExternalId }, 'Created missing K8s infra binding');
            }
          }

          // Fix B: Update stale environment from the correct namespace
          const serviceUpdateFields: Record<string, unknown> = {};
          if (hostingChanged) serviceUpdateFields.hostingType = hostingType;
          if (urlChanged) serviceUpdateFields.url = proj.urls[0];
          if (provider === 'kubernetes' && proj.metadata.namespace) {
            const correctEnv = proj.metadata.namespace === 'production' ? 'production' : (proj.metadata.namespace as string);
            // Read current environment to check staleness
            const currentSvc = this.db
              .select({ environment: websites.environment })
              .from(websites)
              .where(eq(websites.id, svc.id))
              .all();
            if (currentSvc.length > 0 && currentSvc[0].environment !== correctEnv) {
              serviceUpdateFields.environment = correctEnv;
              log.info(
                { serviceId: svc.id, name: proj.name, oldEnv: currentSvc[0].environment, newEnv: correctEnv },
                'Corrected service environment from K8s namespace'
              );
            }
          }

          if (Object.keys(serviceUpdateFields).length > 0) {
            serviceUpdateFields.updatedAt = now;
            this.db.update(websites).set(serviceUpdateFields).where(eq(websites.id, svc.id)).run();
            updated++;
            log.info({ serviceId: svc.id, name: proj.name, hostingType, hasIngress: proj.hasIngress }, 'Updated service hosting info');
          }
          continue;
        }

        // For GitHub/Semaphore: check if K8s services already exist for this repo.
        // Repos like "vacabee-profile" deploy to K8s as "vacabee-profile-dev" / "vacabee-profile-main".
        // Instead of creating a ghost service, attach repo bindings to the K8s services.
        if ((provider === 'github' || provider === 'github_actions' || provider === 'semaphore') && proj.repoFullName) {
          const k8sVariants = this.db
            .select({ id: websites.id, name: websites.name })
            .from(websites)
            .all()
            .filter(s => {
              const n = s.name;
              // Match services named "{repoName}-dev", "{repoName}-main", "{repoName}-staging", etc.
              return n !== proj.name && n.startsWith(proj.name + '-');
            });

          if (k8sVariants.length > 0) {
            // Attach repo binding to each K8s variant instead of creating a standalone service
            const parts = proj.repoFullName.split('/');
            if (parts.length >= 2) {
              for (const variant of k8sVariants) {
                const existingRepoBinding = this.db
                  .select({ id: repositoryBindings.id })
                  .from(repositoryBindings)
                  .where(
                    and(
                      eq(repositoryBindings.websiteId, variant.id),
                      eq(repositoryBindings.provider, 'github'),
                      eq(repositoryBindings.owner, parts[parts.length - 2]),
                      eq(repositoryBindings.repo, parts[parts.length - 1])
                    )
                  )
                  .all();

                if (existingRepoBinding.length === 0) {
                  this.db.insert(repositoryBindings).values({
                    id: ulid(),
                    websiteId: variant.id,
                    provider: 'github',
                    owner: parts[parts.length - 2],
                    repo: parts[parts.length - 1],
                    defaultBranch: 'main',
                    metadata: null,
                    createdAt: now,
                    updatedAt: now,
                  }).run();
                  log.info({ repoName: proj.name, targetService: variant.name }, 'Attached repo binding to existing K8s service variant');
                }
              }
            }
            // Skip creating a standalone service for this repo
            continue;
          }
        }

        // Create new service
        const serviceId = ulid();
        this.db.insert(websites).values({
          id: serviceId,
          projectId: defaultProjectId,
          name: proj.name,
          type: serviceType,
          url: proj.urls[0] || null,
          environment: proj.environment,
          hostingType,
          status: 'unknown',
          metadata: proj.metadata,
          createdAt: now,
          updatedAt: now,
        }).run();

        // Create infrastructure binding for K8s/Vercel
        if (provider === 'kubernetes' || provider === 'vercel') {
          let bindingExternalId: string;
          if (provider === 'vercel') {
            // Use Vercel project ID from metadata (set by vercelProjects discovery)
            bindingExternalId = (proj.metadata.vercelProjectId as string) || proj.name;
          } else {
            // K8s: use namespace/deploymentName format
            const namespace = proj.metadata.namespace as string || 'default';
            bindingExternalId = `${namespace}/${proj.name}`;
          }
          this.db.insert(infrastructureBindings).values({
            id: ulid(),
            websiteId: serviceId,
            provider,
            externalId: bindingExternalId,
            resourceType: provider === 'kubernetes' ? 'deployment' : 'project',
            region: null,
            metadata: null,
            createdAt: now,
            updatedAt: now,
          }).run();
        }

        // Create repository binding for GitHub repos
        if (proj.repoFullName) {
          const parts = proj.repoFullName.split('/');
          if (parts.length >= 2) {
            this.db.insert(repositoryBindings).values({
              id: ulid(),
              websiteId: serviceId,
              provider: 'github',
              owner: parts[parts.length - 2],
              repo: parts[parts.length - 1],
              defaultBranch: 'main',
              metadata: null,
              createdAt: now,
              updatedAt: now,
            }).run();
          }
        }

        created++;
        log.info({ serviceId, name: proj.name, type: serviceType, hostingType, provider, hasIngress: proj.hasIngress }, 'Auto-discovered service from sync');
      } catch (err: any) {
        log.warn({ projectKey, error: err.message }, 'Failed to auto-create service');
      }
    }

    if (created > 0 || updated > 0) {
      log.info({ created, updated, provider }, 'Auto-discovery completed');
    }
  }

  /**
   * Resolve a service (website) ID for a deployment by checking known bindings.
   * Tries deployment_sources, infrastructure_bindings, then repository_bindings.
   * Returns the websiteId (service ID) or null if no match is found.
   */
  private resolveServiceId(dep: { provider: string; externalId: string; metadata?: Record<string, unknown> | null }): string | null {
    // Strategy 1: Match by deployment_sources (provider + externalProjectId)
    try {
      const sourceMatches = this.db
        .select({ websiteId: deploymentSources.websiteId })
        .from(deploymentSources)
        .where(
          and(
            eq(deploymentSources.provider, dep.provider),
            eq(deploymentSources.externalProjectId, dep.externalId)
          )
        )
        .all();

      if (sourceMatches.length > 0) {
        log.debug({ provider: dep.provider, externalId: dep.externalId, serviceId: sourceMatches[0].websiteId }, 'Resolved service via deployment_sources');
        return sourceMatches[0].websiteId;
      }
    } catch (err: any) {
      log.debug({ error: err.message }, 'Error checking deployment_sources');
    }

    // Strategy 2: Match by infrastructure_bindings (provider + externalId)
    try {
      const infraMatches = this.db
        .select({ websiteId: infrastructureBindings.websiteId })
        .from(infrastructureBindings)
        .where(
          and(
            eq(infrastructureBindings.provider, dep.provider),
            eq(infrastructureBindings.externalId, dep.externalId)
          )
        )
        .all();

      if (infraMatches.length > 0) {
        log.debug({ provider: dep.provider, externalId: dep.externalId, serviceId: infraMatches[0].websiteId }, 'Resolved service via infrastructure_bindings');
        return infraMatches[0].websiteId;
      }
    } catch (err: any) {
      log.debug({ error: err.message }, 'Error checking infrastructure_bindings');
    }

    // Strategy 2b: For K8s, fuzzy match infra bindings (deployment name may differ from service name, e.g. "vacabee-admin-panel-app-dev" vs "vacabee-admin-panel-dev")
    if (dep.provider === 'kubernetes') {
      const meta2 = dep.metadata as Record<string, unknown> | null | undefined;
      const depName = (meta2?.deploymentName as string) || dep.externalId.split('/').pop() || '';
      const namespace = (meta2?.namespace as string) || dep.externalId.split('/')[0] || 'default';
      if (depName) {
        try {
          const allK8sBindings = this.db
            .select({ websiteId: infrastructureBindings.websiteId, externalId: infrastructureBindings.externalId })
            .from(infrastructureBindings)
            .where(eq(infrastructureBindings.provider, 'kubernetes'))
            .all();

          // Normalize a K8s name by removing common mid-segments like -app-, -svc-, -service-
          const normalize = (n: string) => n.replace(/-(app|svc|service)-/g, '-');
          const depNorm = normalize(depName);
          for (const binding of allK8sBindings) {
            const bindingNs = binding.externalId.split('/')[0] || 'default';
            const bindingName = binding.externalId.split('/').pop() || '';
            const bindingNorm = normalize(bindingName);
            // Match if same namespace and normalized names match or one contains the other
            const sameNs = bindingNs === namespace;
            if (sameNs && (depNorm === bindingNorm || depNorm.includes(bindingNorm) || bindingNorm.includes(depNorm))) {
              log.debug({ depName, bindingName, serviceId: binding.websiteId }, 'Resolved service via fuzzy K8s infra binding');
              return binding.websiteId;
            }
          }
        } catch (err: any) {
          log.debug({ error: err.message }, 'Error checking fuzzy K8s infra bindings');
        }
      }
    }

    // Strategy 3: Match by service name (projectName from metadata or deployment name)
    // This is tried BEFORE repo matching because monorepo projects share the same repo but have different project names
    const meta = dep.metadata as Record<string, unknown> | null | undefined;
    const projectName = (meta?.projectName as string) || (meta?.deploymentName as string);
    if (projectName) {
      try {
        const nameMatches = this.db
          .select({ id: websites.id })
          .from(websites)
          .where(eq(websites.name, projectName))
          .all();

        if (nameMatches.length > 0) {
          log.debug({ projectName, serviceId: nameMatches[0].id }, 'Resolved service via name match');
          return nameMatches[0].id;
        }
      } catch (err: any) {
        log.debug({ error: err.message }, 'Error checking by service name');
      }
    }

    // Strategy 4: Match by repository_bindings (owner + repo from deployment metadata)
    // Only use when exactly 1 service matches (avoids ambiguity with monorepos)
    const owner = (meta?.owner as string) || (meta?.githubOrg as string) || undefined;
    const repo = (meta?.repo as string) || (meta?.githubRepo as string) || undefined;
    if (owner && repo) {
      try {
        const repoMatches = this.db
          .select({ websiteId: repositoryBindings.websiteId })
          .from(repositoryBindings)
          .where(
            and(
              eq(repositoryBindings.owner, owner),
              eq(repositoryBindings.repo, repo)
            )
          )
          .all();

        if (repoMatches.length === 1) {
          log.debug({ owner, repo, serviceId: repoMatches[0].websiteId }, 'Resolved service via repository_bindings');
          return repoMatches[0].websiteId;
        }
        // Multiple matches = monorepo, skip to next strategy
        if (repoMatches.length > 1) {
          log.debug({ owner, repo, matches: repoMatches.length }, 'Multiple repo matches (monorepo), skipping');
        }
      } catch (err: any) {
        log.debug({ error: err.message }, 'Error checking repository_bindings');
      }
    }

    // Strategy 5: For GitHub, match by repo name (last segment of repo path)
    const repoFullName = (meta?.repo as string);
    if (repoFullName && repoFullName.includes('/')) {
      const repoName = repoFullName.split('/').pop()!;
      try {
        const nameMatches = this.db
          .select({ id: websites.id })
          .from(websites)
          .where(eq(websites.name, repoName))
          .all();

        if (nameMatches.length > 0) {
          return nameMatches[0].id;
        }
      } catch (err: any) {
        log.debug({ error: err.message }, 'Error checking by repo name');
      }
    }

    // Fallback: no match found
    return null;
  }

  /**
   * Update service statuses based on provider sync data.
   * - type='service': always updates status from provider data (no health checks)
   * - type='website': only updates if current status is 'unknown' (health checks take priority)
   * - Kubernetes: maps pod health to service status (healthy/degraded/down)
   * - Vercel: maps latest deployment status to service status (healthy/degraded/deploying)
   */
  private updateServiceStatuses(result: SyncResult, provider: string): void {
    const deployments = result.data?.deployments;
    if (!deployments?.length) return;

    const now = new Date().toISOString();

    // Group deployments by their resolved service ID
    const serviceDeployments = new Map<string, typeof deployments>();
    for (const dep of deployments) {
      const serviceId = this.resolveServiceId(dep);
      if (!serviceId) continue;

      if (!serviceDeployments.has(serviceId)) {
        serviceDeployments.set(serviceId, []);
      }
      serviceDeployments.get(serviceId)!.push(dep);
    }

    for (const [serviceId, deps] of serviceDeployments) {
      try {
        // Fetch the service record regardless of type
        const serviceRecords = this.db
          .select({ id: websites.id, name: websites.name, type: websites.type, status: websites.status })
          .from(websites)
          .where(eq(websites.id, serviceId))
          .all();

        if (serviceRecords.length === 0) continue;

        const record = serviceRecords[0];

        // For type='website': only update if current status is 'unknown'
        // (let health checks take priority once they run)
        if (record.type === 'website' && record.status !== 'unknown') continue;

        let newStatus: string | null = null;

        if (provider === 'kubernetes') {
          // Kubernetes: check pod health status from deployment metadata
          // Look at the latest deployment's status/metadata
          const latestDep = deps[deps.length - 1];
          const meta = latestDep.metadata as Record<string, unknown> | null | undefined;
          const podStatus = (meta?.podStatus as string) || latestDep.status;

          if (podStatus === 'Running' || podStatus === 'success' || podStatus === 'ready') {
            newStatus = 'healthy';
          } else if (podStatus === 'Pending' || podStatus === 'deploying' || podStatus === 'building') {
            newStatus = 'degraded';
          } else if (podStatus === 'Failed' || podStatus === 'CrashLoopBackOff' || podStatus === 'failed' || podStatus === 'Error') {
            newStatus = 'down';
          }
        } else if (provider === 'vercel') {
          // Vercel: check latest deployment status
          const latestDep = deps[deps.length - 1];
          const status = latestDep.status?.toUpperCase();

          if (status === 'READY' || status === 'SUCCESS') {
            newStatus = 'healthy';
          } else if (status === 'ERROR' || status === 'FAILED' || status === 'CANCELLED') {
            newStatus = 'degraded';
          } else if (status === 'BUILDING' || status === 'DEPLOYING' || status === 'PENDING') {
            newStatus = 'deploying';
          }
        } else if (provider === 'semaphore') {
          // Semaphore: check latest pipeline status
          const latestDep = deps[deps.length - 1];
          const status = latestDep.status?.toLowerCase();

          if (status === 'success') {
            newStatus = 'healthy';
          } else if (status === 'failed') {
            newStatus = 'degraded';
          } else if (status === 'deploying' || status === 'pending') {
            newStatus = 'deploying';
          } else if (status === 'cancelled') {
            newStatus = 'degraded';
          }
        }

        if (newStatus) {
          const oldStatus = record.status;
          this.db
            .update(websites)
            .set({ status: newStatus, updatedAt: now })
            .where(eq(websites.id, serviceId))
            .run();

          log.info(
            { serviceId, provider, newStatus },
            'Updated service status from provider data'
          );

          // Emit service status event when transitioning between known states
          if (oldStatus !== 'unknown' && oldStatus !== newStatus) {
            const svcEventMap: Record<string, ServiceEventType> = {
              down: 'service.down',
              degraded: 'service.degraded',
              healthy: 'service.up',
            };
            const svcEventType = svcEventMap[newStatus];
            if (svcEventType) {
              eventBus.publish(svcEventType, {
                serviceName: record.name,
                serviceId,
                provider,
                details: {
                  oldStatus,
                  newStatus,
                },
              });
            }
          }
        }
      } catch (err: any) {
        log.warn(
          { serviceId, provider, error: err.message },
          'Failed to update service status'
        );
      }
    }

    // For K8s: mark private services (type='service', hosting_type='kubernetes') as 'down'
    // if they have an infra binding but no running pod was found in this sync
    if (provider === 'kubernetes') {
      const updatedServiceIds = new Set(serviceDeployments.keys());
      try {
        // Find all K8s-hosted private services still at 'unknown' — with or without infra bindings
        const k8sServices = this.db
          .select({
            id: websites.id,
            name: websites.name,
            status: websites.status,
          })
          .from(websites)
          .where(
            and(
              eq(websites.type, 'service'),
              eq(websites.hostingType, 'kubernetes'),
              eq(websites.status, 'unknown')
            )
          )
          .all();

        for (const svc of k8sServices) {
          if (updatedServiceIds.has(svc.id)) continue;
          // No matching deployment in sync → pod not running
          this.db
            .update(websites)
            .set({ status: 'down', updatedAt: now })
            .where(eq(websites.id, svc.id))
            .run();
          log.info({ serviceId: svc.id, name: svc.name }, 'K8s service marked down (no running pod)');
        }
      } catch (err: any) {
        log.warn({ error: err.message }, 'Failed to update K8s services with no running pods');
      }
    }
  }

  /** Persist deployment records returned by an adapter sync, using upsert semantics. */
  private persistDeployments(result: SyncResult): number {
    const deployments = result.data?.deployments;
    if (!deployments?.length) return 0;

    let count = 0;
    const now = new Date().toISOString();

    // Filter for K8s: skip infrastructure deployments that were excluded from auto-discovery
    const k8sInfraPatterns = [
      'redis', 'postgresql', 'postgres', 'mysql', 'mariadb', 'mongodb', 'meilisearch-',
      'elasticsearch', 'cassandra', 'memcached',
      'kafka', 'rabbitmq', 'nats', 'zookeeper',
      'openobserve', 'o2c-', 'collector-agent', 'collector-gateway', 'targetallocator',
      'prometheus', 'grafana', 'jaeger', 'loki', 'tempo',
      'cm-acme-http-solver', 'dashboard-metrics', 'kubernetes-dashboard',
      'pgadmin', 'phpmyadmin', 'adminer',
      'strimzi-cluster-operator',
    ];

    for (const dep of deployments) {
      try {
        // Skip K8s infrastructure deployments
        if (dep.provider === 'kubernetes') {
          const depName = ((dep.metadata as any)?.deploymentName as string || dep.externalId).toLowerCase();
          if (k8sInfraPatterns.some(p => depName.includes(p))) continue;
        }

        // Check if a deployment with this externalId+provider already exists
        const existing = this.db
          .select()
          .from(deploymentRecords)
          .where(
            and(
              eq(deploymentRecords.externalId, dep.externalId),
              eq(deploymentRecords.provider, dep.provider)
            )
          )
          .all();

        // Auto-resolve service ID for linking
        const resolvedServiceId = this.resolveServiceId(dep);

        // Resolve service name for event emission
        const meta = dep.metadata as Record<string, unknown> | null | undefined;
        const serviceName = (meta?.projectName as string) || (meta?.deploymentName as string) || dep.externalId;

        if (existing.length > 0) {
          const oldStatus = existing[0].status;

          // Update existing record; also link to service if previously unlinked
          const updateData: Record<string, unknown> = {
            status: dep.status,
            completedAt: dep.completedAt || null,
            updatedAt: now,
          };
          if (resolvedServiceId && !existing[0].websiteId) {
            updateData.websiteId = resolvedServiceId;
          }
          this.db
            .update(deploymentRecords)
            .set(updateData)
            .where(eq(deploymentRecords.id, existing[0].id))
            .run();

          // Emit deployment event if status changed
          if (oldStatus !== dep.status) {
            const depEventType = this.mapDeploymentStatusToEvent(dep.status);
            if (depEventType) {
              eventBus.publish(depEventType, {
                serviceName,
                serviceId: resolvedServiceId || existing[0].websiteId || undefined,
                provider: dep.provider,
                details: {
                  deploymentId: existing[0].id,
                  externalId: dep.externalId,
                  environment: dep.environment,
                  branch: dep.branch,
                  commitSha: dep.commitSha,
                  commitMessage: dep.commitMessage,
                  author: dep.author,
                  status: dep.status,
                  oldStatus,
                  url: dep.url,
                },
              });
            }
          }
        } else {
          const newId = ulid();
          // Insert new record with auto-resolved service ID (null if unlinked)
          this.db
            .insert(deploymentRecords)
            .values({
              id: newId,
              websiteId: resolvedServiceId,
              provider: dep.provider,
              externalId: dep.externalId,
              status: dep.status,
              environment: dep.environment || null,
              branch: dep.branch || null,
              commitSha: dep.commitSha || null,
              commitMessage: dep.commitMessage || null,
              author: dep.author || null,
              url: dep.url || null,
              startedAt: dep.startedAt || null,
              completedAt: dep.completedAt || null,
              metadata: dep.metadata || null,
              createdAt: now,
              updatedAt: now,
            })
            .run();

          // Emit deployment event for newly seen deployments
          const depEventType = this.mapDeploymentStatusToEvent(dep.status);
          if (depEventType) {
            eventBus.publish(depEventType, {
              serviceName,
              serviceId: resolvedServiceId || undefined,
              provider: dep.provider,
              details: {
                deploymentId: newId,
                externalId: dep.externalId,
                environment: dep.environment,
                branch: dep.branch,
                commitSha: dep.commitSha,
                commitMessage: dep.commitMessage,
                author: dep.author,
                status: dep.status,
                url: dep.url,
              },
            });
          }
        }
        count++;
      } catch (err: any) {
        log.warn(
          { externalId: dep.externalId, provider: dep.provider, error: err.message },
          'Failed to persist deployment record'
        );
      }
    }

    return count;
  }

  /**
   * Auto-create monitoring targets for all public services (type='website')
   * that have a URL but no existing monitoring target.
   */
  private ensureMonitoringTargets(): void {
    const now = new Date().toISOString();

    try {
      // Get all website-type services that have a URL
      const publicServices = this.db
        .select({ id: websites.id, url: websites.url, name: websites.name })
        .from(websites)
        .where(
          and(
            eq(websites.type, 'website'),
            isNotNull(websites.url)
          )
        )
        .all();

      // Get all existing monitoring target websiteIds
      const existingTargets = this.db
        .select({ websiteId: monitoringTargets.websiteId })
        .from(monitoringTargets)
        .all();

      const hasTarget = new Set(existingTargets.map(t => t.websiteId));

      let created = 0;
      for (const svc of publicServices) {
        if (!svc.url || hasTarget.has(svc.id)) continue;

        this.db.insert(monitoringTargets).values({
          id: ulid(),
          websiteId: svc.id,
          type: 'http',
          target: svc.url,
          checkIntervalSeconds: 60,
          timeoutMs: 10000,
          expectedStatusCode: 200,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        }).run();

        created++;
        log.info({ websiteId: svc.id, name: svc.name, url: svc.url }, 'Auto-created monitoring target');
      }

      if (created > 0) {
        log.info({ created }, 'Auto-created monitoring targets for public services');
      }
    } catch (err: any) {
      log.warn({ error: err.message }, 'Failed to ensure monitoring targets');
    }
  }

  /** Map a deployment status string to the appropriate event type. */
  private mapDeploymentStatusToEvent(status: string): DeploymentEventType | null {
    const s = status.toLowerCase();
    if (s === 'success' || s === 'ready') return 'deployment.completed';
    if (s === 'failed' || s === 'error' || s === 'cancelled') return 'deployment.failed';
    if (s === 'deploying' || s === 'building' || s === 'pending' || s === 'running') return 'deployment.started';
    return null;
  }

  private async executeJob(job: SyncJob): Promise<void> {
    if (job.isRunning) {
      log.warn({ integrationId: job.integrationId }, 'Sync already running, skipping');
      return;
    }

    job.isRunning = true;
    try {
      await this.triggerSync(job.integrationId);
      job.lastRun = new Date();
    } catch (err: any) {
      log.error({ integrationId: job.integrationId, error: err.message }, 'Sync job failed');
    } finally {
      job.isRunning = false;
    }
  }

  getStatus(): Array<{
    integrationId: string;
    provider: string;
    intervalMs: number;
    lastRun?: Date;
    isRunning: boolean;
  }> {
    return Array.from(this.jobs.values()).map((j) => ({
      integrationId: j.integrationId,
      provider: j.provider,
      intervalMs: j.intervalMs,
      lastRun: j.lastRun,
      isRunning: j.isRunning,
    }));
  }

  /** Re-sync all enabled integrations immediately (used after data reset). */
  async resyncAll(): Promise<{ synced: number; errors: string[] }> {
    const integrations = await integrationService.listIntegrations(this.db);
    const enabled = integrations.filter(i => i.enabled);
    let synced = 0;
    const errors: string[] = [];

    for (const integration of enabled) {
      try {
        log.info({ provider: integration.provider }, 'Re-syncing after reset');
        const result = await this.triggerSync(integration.id);
        if (result.success) {
          synced++;
        } else {
          errors.push(`${integration.provider}: ${result.message}`);
        }
      } catch (err: any) {
        errors.push(`${integration.provider}: ${err.message}`);
      }
    }

    return { synced, errors };
  }

  stopAll(): void {
    for (const [id] of this.jobs) {
      this.removeJob(id);
    }
    log.info('Stopped all sync jobs');
  }
}
