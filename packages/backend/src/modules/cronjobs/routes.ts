import { FastifyInstance } from 'fastify';
import { createChildLogger } from '../../shared/logger.js';
import { KubernetesAdapter } from '../../providers/kubernetes/adapter.js';
import { VercelAdapter } from '../../providers/vercel/adapter.js';
import { KeychainSecretStore, type SecretStore } from '../secrets/keychain.js';
import { FallbackEncryptedStore } from '../secrets/fallback-encrypted.js';
import { integrationConfigs } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import type { K8sConfig } from '../../providers/kubernetes/types.js';
import type { VercelConfig } from '../../providers/vercel/types.js';

const log = createChildLogger('cronjobs');

/** Maps provider name to which secret keys become which config fields */
const SECRET_MAPPING: Record<string, Record<string, string>> = {
  kubernetes: { kubeconfig: 'kubeconfig' },
  vercel: { vercel_token: 'token' },
};

/** Extract a YAML value from "key: value" (handles quoted strings) */
function yamlValue(line: string): string {
  const idx = line.indexOf(':');
  if (idx === -1) return '';
  return line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
}

/** Parse kubeconfig YAML to extract connection details */
function parseKubeconfig(content: string): {
  apiServer?: string;
  token?: string;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
} {
  const lines = content.split('\n');

  let currentContext = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('current-context:')) {
      currentContext = yamlValue(trimmed);
      break;
    }
  }

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
      if (line.match(/^\S/) && trimmed.startsWith('contexts:')) {
        inContexts = true;
        inContextBlock = false;
        continue;
      }
      if (inContexts && line.match(/^\S/) && !trimmed.startsWith('-')) {
        inContexts = false;
        continue;
      }
      if (!inContexts) continue;

      if (trimmed.startsWith('- context:') || trimmed === '- context:') {
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
        if (trimmed.startsWith('cluster:')) clusterName = yamlValue(trimmed);
        else if (trimmed.startsWith('user:')) userName = yamlValue(trimmed);
        else if (trimmed.startsWith('name:')) contextName = yamlValue(trimmed);
      }
    }
    if (inContextBlock && contextName === currentContext) {
      targetCluster = clusterName;
      targetUser = userName;
    }
  }

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
        if (trimmed.startsWith('server:')) server = yamlValue(trimmed);
        else if (trimmed.startsWith('certificate-authority-data:')) ca = yamlValue(trimmed);
        else if (trimmed.startsWith('name:')) clusterName = yamlValue(trimmed);
      }
    }
    if (inClusterBlock && clusterName === targetCluster) {
      apiServer = server || undefined;
      caCert = ca || undefined;
    }
  }

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
        if (trimmed.startsWith('token:')) userToken = yamlValue(trimmed);
        else if (trimmed.startsWith('client-certificate-data:')) cert = yamlValue(trimmed);
        else if (trimmed.startsWith('client-key-data:')) key = yamlValue(trimmed);
      }
    }
    if (inUserBlock && userName === targetUser) {
      token = userToken || undefined;
      clientCert = cert || undefined;
      clientKey = key || undefined;
    }
  }

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

async function resolveSecrets(
  secretStore: SecretStore,
  provider: string,
  config: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const mapping = SECRET_MAPPING[provider];
  if (!mapping) return config;

  const resolved = { ...config };
  for (const [secretKey, configField] of Object.entries(mapping)) {
    if (!resolved[configField]) {
      const value = await secretStore.get(secretKey);
      if (value) {
        resolved[configField] = value;
      }
    }
  }

  if (provider === 'kubernetes' && typeof resolved.kubeconfig === 'string' && !resolved.apiServer) {
    const parsed = parseKubeconfig(resolved.kubeconfig);
    if (parsed.apiServer) resolved.apiServer = parsed.apiServer;
    if (parsed.token && !resolved.token) resolved.token = parsed.token;
    if (parsed.caCert && !resolved.caCert) resolved.caCert = parsed.caCert;
    if (parsed.clientCert && !resolved.clientCert) resolved.clientCert = parsed.clientCert;
    if (parsed.clientKey && !resolved.clientKey) resolved.clientKey = parsed.clientKey;
  }

  return resolved;
}

export interface CronJobEntry {
  id: string;
  name: string;
  provider: 'kubernetes' | 'vercel';
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

let secretStore: SecretStore | null = null;

async function getSecretStore(): Promise<SecretStore> {
  if (secretStore) return secretStore;
  const keychainStore = new KeychainSecretStore();
  if (await keychainStore.init()) {
    secretStore = keychainStore;
    return keychainStore;
  }
  secretStore = new FallbackEncryptedStore();
  return secretStore;
}

export default async function cronjobRoutes(app: FastifyInstance) {
  const db = app.db;
  const k8sAdapter = new KubernetesAdapter();
  const vercelAdapter = new VercelAdapter();

  // GET /cronjobs
  app.get<{
    Querystring: {
      provider?: string;
    };
  }>('/cronjobs', async (request, reply) => {
    const providerFilter = request.query.provider;
    const store = await getSecretStore();
    const entries: CronJobEntry[] = [];

    // Get all integrations
    const allIntegrations = db.select().from(integrationConfigs).all();

    // Fetch K8s CronJobs
    if (!providerFilter || providerFilter === 'kubernetes') {
      const k8sIntegrations = allIntegrations.filter(
        (i) => i.provider === 'kubernetes' && i.enabled
      );

      for (const integration of k8sIntegrations) {
        try {
          const resolvedConfig = await resolveSecrets(
            store,
            'kubernetes',
            (integration.config as Record<string, unknown>) || {}
          );
          const config = resolvedConfig as unknown as K8sConfig;

          if (!config.apiServer) {
            log.warn({ integrationId: integration.id }, 'Kubernetes integration missing apiServer, skipping');
            continue;
          }

          const cronJobs = await k8sAdapter.getCronJobs(config, config.namespace);

          for (const cj of cronJobs) {
            entries.push({
              id: `k8s:${cj.namespace}/${cj.name}`,
              name: cj.name,
              provider: 'kubernetes',
              schedule: cj.schedule,
              namespace: cj.namespace,
              suspended: cj.suspended,
              lastRun: cj.lastScheduleTime || undefined,
              lastRunStatus: undefined,
              activeJobs: cj.activeJobs,
              image: cj.image || undefined,
              metadata: {
                concurrencyPolicy: cj.concurrencyPolicy,
                createdAt: cj.createdAt,
                integrationId: integration.id,
              },
            });
          }
        } catch (err: any) {
          log.warn(
            { integrationId: integration.id, error: err.message },
            'Failed to fetch K8s CronJobs'
          );
        }
      }
    }

    // Fetch Vercel CronJobs
    if (!providerFilter || providerFilter === 'vercel') {
      const vercelIntegrations = allIntegrations.filter(
        (i) => i.provider === 'vercel' && i.enabled
      );

      for (const integration of vercelIntegrations) {
        try {
          const resolvedConfig = await resolveSecrets(
            store,
            'vercel',
            (integration.config as Record<string, unknown>) || {}
          );
          const config = resolvedConfig as unknown as VercelConfig;

          if (!config.token) {
            log.warn({ integrationId: integration.id }, 'Vercel integration missing token, skipping');
            continue;
          }

          const cronJobs = await vercelAdapter.getCronJobs(config);

          for (const cj of cronJobs) {
            entries.push({
              id: `vercel:${cj.projectId}/${cj.path}`,
              name: `${cj.projectName} - ${cj.path}`,
              provider: 'vercel',
              schedule: cj.schedule,
              projectName: cj.projectName,
              path: cj.path,
              suspended: false,
              lastRun: cj.lastRunAt,
              lastRunStatus: cj.lastRunStatus,
              metadata: {
                projectId: cj.projectId,
                integrationId: integration.id,
              },
            });
          }
        } catch (err: any) {
          log.warn(
            { integrationId: integration.id, error: err.message },
            'Failed to fetch Vercel CronJobs'
          );
        }
      }
    }

    return reply.send(entries);
  });
}
