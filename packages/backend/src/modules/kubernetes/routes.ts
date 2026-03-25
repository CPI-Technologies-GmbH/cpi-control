import { FastifyInstance } from 'fastify';
import { KubernetesAdapter } from '../../providers/kubernetes/adapter.js';
import { createChildLogger } from '../../shared/logger.js';
import { KeychainSecretStore, type SecretStore } from '../secrets/keychain.js';
import { FallbackEncryptedStore } from '../secrets/fallback-encrypted.js';
import * as integrationService from '../integrations/service.js';
import type { K8sConfig } from '../../providers/kubernetes/types.js';

const log = createChildLogger('kubernetes-routes');
const adapter = new KubernetesAdapter();

let secretStore: SecretStore | null = null;

async function getSecretStore(): Promise<SecretStore> {
  if (secretStore) return secretStore;

  const keychainStore = new KeychainSecretStore();
  const available = await keychainStore.init();
  if (available) {
    secretStore = keychainStore;
  } else {
    secretStore = new FallbackEncryptedStore();
  }
  return secretStore;
}

/** Parse kubeconfig YAML to extract connection fields (simplified inline parser). */
function yamlValue(line: string): string {
  const idx = line.indexOf(':');
  if (idx === -1) return '';
  return line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
}

function parseKubeconfig(content: string): Partial<K8sConfig> {
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
      if (line.match(/^\S/) && trimmed.startsWith('contexts:')) { inContexts = true; inContextBlock = false; continue; }
      if (inContexts && line.match(/^\S/) && !trimmed.startsWith('-')) { inContexts = false; continue; }
      if (!inContexts) continue;
      if (trimmed.startsWith('- context:') || trimmed === '- context:') {
        if (inContextBlock && contextName === currentContext) { targetCluster = clusterName; targetUser = userName; }
        inContextBlock = true; contextName = ''; clusterName = ''; userName = ''; continue;
      }
      if (inContextBlock) {
        if (trimmed.startsWith('cluster:')) clusterName = yamlValue(trimmed);
        else if (trimmed.startsWith('user:')) userName = yamlValue(trimmed);
        else if (trimmed.startsWith('name:')) contextName = yamlValue(trimmed);
      }
    }
    if (inContextBlock && contextName === currentContext) { targetCluster = clusterName; targetUser = userName; }
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
      if (line.match(/^\S/) && trimmed.startsWith('clusters:')) { inClusters = true; inClusterBlock = false; continue; }
      if (inClusters && line.match(/^\S/) && !trimmed.startsWith('-')) { inClusters = false; continue; }
      if (!inClusters) continue;
      if (trimmed.startsWith('- cluster:') || trimmed === '- cluster:') {
        if (inClusterBlock && clusterName === targetCluster) { apiServer = server || undefined; caCert = ca || undefined; }
        inClusterBlock = true; clusterName = ''; server = ''; ca = ''; continue;
      }
      if (inClusterBlock) {
        if (trimmed.startsWith('server:')) server = yamlValue(trimmed);
        else if (trimmed.startsWith('certificate-authority-data:')) ca = yamlValue(trimmed);
        else if (trimmed.startsWith('name:')) clusterName = yamlValue(trimmed);
      }
    }
    if (inClusterBlock && clusterName === targetCluster) { apiServer = server || undefined; caCert = ca || undefined; }
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
      if (line.match(/^\S/) && trimmed.startsWith('users:')) { inUsers = true; inUserBlock = false; continue; }
      if (inUsers && line.match(/^\S/) && !trimmed.startsWith('-')) { inUsers = false; continue; }
      if (!inUsers) continue;
      if (trimmed.startsWith('- name:')) {
        if (inUserBlock && userName === targetUser) { token = userToken || undefined; clientCert = cert || undefined; clientKey = key || undefined; }
        inUserBlock = true; userName = yamlValue(trimmed); userToken = ''; cert = ''; key = ''; continue;
      }
      if (inUserBlock) {
        if (trimmed.startsWith('token:')) userToken = yamlValue(trimmed);
        else if (trimmed.startsWith('client-certificate-data:')) cert = yamlValue(trimmed);
        else if (trimmed.startsWith('client-key-data:')) key = yamlValue(trimmed);
      }
    }
    if (inUserBlock && userName === targetUser) { token = userToken || undefined; clientCert = cert || undefined; clientKey = key || undefined; }
  }

  if (!apiServer) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('server:')) { apiServer = yamlValue(trimmed); break; }
    }
  }

  return { apiServer, token, caCert, clientCert, clientKey };
}

async function resolveK8sConfig(db: any, integrationId: string): Promise<K8sConfig> {
  const integration = await integrationService.getIntegration(db, integrationId);
  if (!integration) {
    throw new Error('Integration not found');
  }
  if (integration.provider !== 'kubernetes') {
    throw new Error('Integration is not a Kubernetes integration');
  }

  const store = await getSecretStore();
  const config: Record<string, unknown> = { ...((integration.config as Record<string, unknown>) || {}) };

  // Resolve kubeconfig from secret store
  if (!config.kubeconfig) {
    const kubeconfig = await store.get('kubeconfig');
    if (kubeconfig) {
      config.kubeconfig = kubeconfig;
    }
  }

  // Parse kubeconfig to extract connection fields
  if (typeof config.kubeconfig === 'string' && !config.apiServer) {
    const parsed = parseKubeconfig(config.kubeconfig);
    if (parsed.apiServer) config.apiServer = parsed.apiServer;
    if (parsed.token && !config.token) config.token = parsed.token;
    if (parsed.caCert && !config.caCert) config.caCert = parsed.caCert;
    if (parsed.clientCert && !config.clientCert) config.clientCert = parsed.clientCert;
    if (parsed.clientKey && !config.clientKey) config.clientKey = parsed.clientKey;
  }

  return config as unknown as K8sConfig;
}

export default async function kubernetesRoutes(app: FastifyInstance) {
  const db = app.db;

  // GET /kubernetes/namespaces?integrationId=X
  app.get<{ Querystring: { integrationId: string } }>(
    '/kubernetes/namespaces',
    async (request, reply) => {
      const { integrationId } = request.query;
      if (!integrationId) {
        return reply.status(400).send({ error: 'integrationId is required' });
      }
      try {
        const config = await resolveK8sConfig(db, integrationId);
        const namespaces = await adapter.getNamespaces(config);
        return reply.send(namespaces);
      } catch (err: any) {
        log.error({ error: err.message }, 'Failed to get namespaces');
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // GET /kubernetes/cronjobs?integrationId=X&namespace=Y
  app.get<{ Querystring: { integrationId: string; namespace?: string } }>(
    '/kubernetes/cronjobs',
    async (request, reply) => {
      const { integrationId, namespace } = request.query;
      if (!integrationId) {
        return reply.status(400).send({ error: 'integrationId is required' });
      }
      try {
        const config = await resolveK8sConfig(db, integrationId);
        const cronJobs = await adapter.getCronJobs(config, namespace);
        return reply.send(cronJobs);
      } catch (err: any) {
        log.error({ error: err.message }, 'Failed to get cronjobs');
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // GET /kubernetes/cluster?integrationId=X
  app.get<{ Querystring: { integrationId: string } }>(
    '/kubernetes/cluster',
    async (request, reply) => {
      const { integrationId } = request.query;
      if (!integrationId) {
        return reply.status(400).send({ error: 'integrationId is required' });
      }
      try {
        const config = await resolveK8sConfig(db, integrationId);
        const clusterInfo = await adapter.getClusterInfo(config);
        return reply.send(clusterInfo);
      } catch (err: any) {
        log.error({ error: err.message }, 'Failed to get cluster info');
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // POST /kubernetes/deployments/:namespace/:name/restart?integrationId=X
  app.post<{ Params: { namespace: string; name: string }; Querystring: { integrationId: string } }>(
    '/kubernetes/deployments/:namespace/:name/restart',
    async (request, reply) => {
      const { integrationId } = request.query;
      const { namespace, name } = request.params;
      if (!integrationId) {
        return reply.status(400).send({ error: 'integrationId is required' });
      }
      try {
        const config = await resolveK8sConfig(db, integrationId);
        const result = await adapter.restartDeployment(config, namespace, name);
        log.info({ namespace, name }, 'Deployment restart triggered');
        return reply.send({ success: true, message: `Deployment ${namespace}/${name} restart triggered`, deployment: result });
      } catch (err: any) {
        log.error({ error: err.message, namespace, name }, 'Failed to restart deployment');
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // GET /kubernetes/pods?integrationId=X&namespace=Y
  app.get<{ Querystring: { integrationId: string; namespace?: string } }>(
    '/kubernetes/pods',
    async (request, reply) => {
      const { integrationId, namespace } = request.query;
      if (!integrationId) {
        return reply.status(400).send({ error: 'integrationId is required' });
      }
      try {
        const config = await resolveK8sConfig(db, integrationId);
        const pods = await adapter.getPods(config, namespace);
        return reply.send(pods);
      } catch (err: any) {
        log.error({ error: err.message }, 'Failed to get pods');
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // GET /kubernetes/deployments?integrationId=X&namespace=Y
  app.get<{ Querystring: { integrationId: string; namespace?: string } }>(
    '/kubernetes/deployments',
    async (request, reply) => {
      const { integrationId, namespace } = request.query;
      if (!integrationId) {
        return reply.status(400).send({ error: 'integrationId is required' });
      }
      try {
        const config = await resolveK8sConfig(db, integrationId);
        const deployments = await adapter.getDeployments(config, namespace);
        return reply.send(deployments);
      } catch (err: any) {
        log.error({ error: err.message }, 'Failed to get deployments');
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // GET /kubernetes/metrics?integrationId=X&namespace=Y
  app.get<{ Querystring: { integrationId: string; namespace?: string } }>(
    '/kubernetes/metrics',
    async (request, reply) => {
      const { integrationId, namespace } = request.query;
      if (!integrationId) {
        return reply.status(400).send({ error: 'integrationId is required' });
      }
      try {
        const config = await resolveK8sConfig(db, integrationId);
        const metrics = await adapter.getPodMetrics(config, namespace);
        if (metrics === null) {
          return reply.send({ available: false, pods: [] });
        }
        return reply.send({ available: true, pods: metrics });
      } catch (err: any) {
        log.error({ error: err.message }, 'Failed to get pod metrics');
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // GET /kubernetes/events?integrationId=X&namespace=Y&name=Z
  app.get<{ Querystring: { integrationId: string; namespace?: string; name?: string } }>(
    '/kubernetes/events',
    async (request, reply) => {
      const { integrationId, namespace, name } = request.query;
      if (!integrationId) {
        return reply.status(400).send({ error: 'integrationId is required' });
      }
      try {
        const config = await resolveK8sConfig(db, integrationId);
        let events;
        if (name) {
          events = await adapter.getEventsForPod(config, namespace || config.namespace || 'default', name);
        } else {
          events = await adapter.getEvents(config, namespace);
        }
        return reply.send(events);
      } catch (err: any) {
        log.error({ error: err.message }, 'Failed to get events');
        return reply.status(500).send({ error: err.message });
      }
    }
  );
}
