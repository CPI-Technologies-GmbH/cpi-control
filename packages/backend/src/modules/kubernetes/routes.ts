import { FastifyInstance } from 'fastify';
import { KubernetesAdapter } from '../../providers/kubernetes/adapter.js';
import { createChildLogger } from '../../shared/logger.js';
import { parseKubeconfig } from '../../shared/kubeconfig-parser.js';
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

async function resolveK8sConfig(db: any, integrationId: string, clusterName?: string): Promise<K8sConfig> {
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
    // If a specific cluster name is requested, use that named kubeconfig
    if (clusterName) {
      const value = await store.get(`kubeconfig:${clusterName}`);
      if (value) {
        config.kubeconfig = value;
        log.info({ clusterName }, 'Using specific named kubeconfig for route');
      }
    }

    if (!config.kubeconfig) {
      // Try plain 'kubeconfig' first
      const kubeconfig = await store.get('kubeconfig');
      if (kubeconfig) {
        config.kubeconfig = kubeconfig;
      } else {
        // Fallback: try named kubeconfigs (kubeconfig:*)
        const allKeys = await store.list();
        const namedKey = allKeys.find((k: string) => k.startsWith('kubeconfig:'));
        if (namedKey) {
          const value = await store.get(namedKey);
          if (value) {
            config.kubeconfig = value;
            log.info({ key: namedKey }, 'Using named kubeconfig for route');
          }
        }
      }
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

  // GET /kubernetes/namespaces?integrationId=X&clusterName=Y
  app.get<{ Querystring: { integrationId: string; clusterName?: string } }>(
    '/kubernetes/namespaces',
    async (request, reply) => {
      const { integrationId, clusterName } = request.query;
      if (!integrationId) {
        return reply.status(400).send({ error: 'integrationId is required' });
      }
      try {
        const config = await resolveK8sConfig(db, integrationId, clusterName);
        const namespaces = await adapter.getNamespaces(config);
        return reply.send(namespaces);
      } catch (err: any) {
        log.error({ error: err.message }, 'Failed to get namespaces');
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // GET /kubernetes/cronjobs?integrationId=X&namespace=Y&clusterName=Z
  app.get<{ Querystring: { integrationId: string; namespace?: string; clusterName?: string } }>(
    '/kubernetes/cronjobs',
    async (request, reply) => {
      const { integrationId, namespace, clusterName } = request.query;
      if (!integrationId) {
        return reply.status(400).send({ error: 'integrationId is required' });
      }
      try {
        const config = await resolveK8sConfig(db, integrationId, clusterName);
        const cronJobs = await adapter.getCronJobs(config, namespace);
        return reply.send(cronJobs);
      } catch (err: any) {
        log.error({ error: err.message }, 'Failed to get cronjobs');
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // GET /kubernetes/cluster?integrationId=X&clusterName=Y
  app.get<{ Querystring: { integrationId: string; clusterName?: string } }>(
    '/kubernetes/cluster',
    async (request, reply) => {
      const { integrationId, clusterName } = request.query;
      if (!integrationId) {
        return reply.status(400).send({ error: 'integrationId is required' });
      }
      try {
        const config = await resolveK8sConfig(db, integrationId, clusterName);
        const clusterInfo = await adapter.getClusterInfo(config);
        return reply.send(clusterInfo);
      } catch (err: any) {
        log.error({ error: err.message }, 'Failed to get cluster info');
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // POST /kubernetes/deployments/:namespace/:name/restart?integrationId=X&clusterName=Y
  app.post<{ Params: { namespace: string; name: string }; Querystring: { integrationId: string; clusterName?: string } }>(
    '/kubernetes/deployments/:namespace/:name/restart',
    async (request, reply) => {
      const { integrationId, clusterName } = request.query;
      const { namespace, name } = request.params;
      if (!integrationId) {
        return reply.status(400).send({ error: 'integrationId is required' });
      }
      try {
        const config = await resolveK8sConfig(db, integrationId, clusterName);
        const result = await adapter.restartDeployment(config, namespace, name);
        log.info({ namespace, name }, 'Deployment restart triggered');
        return reply.send({ success: true, message: `Deployment ${namespace}/${name} restart triggered`, deployment: result });
      } catch (err: any) {
        log.error({ error: err.message, namespace, name }, 'Failed to restart deployment');
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // GET /kubernetes/pods?integrationId=X&namespace=Y&clusterName=Z
  app.get<{ Querystring: { integrationId: string; namespace?: string; clusterName?: string } }>(
    '/kubernetes/pods',
    async (request, reply) => {
      const { integrationId, namespace, clusterName } = request.query;
      if (!integrationId) {
        return reply.status(400).send({ error: 'integrationId is required' });
      }
      try {
        const config = await resolveK8sConfig(db, integrationId, clusterName);
        const pods = await adapter.getPods(config, namespace);
        return reply.send(pods);
      } catch (err: any) {
        log.error({ error: err.message }, 'Failed to get pods');
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // GET /kubernetes/deployments?integrationId=X&namespace=Y&clusterName=Z
  app.get<{ Querystring: { integrationId: string; namespace?: string; clusterName?: string } }>(
    '/kubernetes/deployments',
    async (request, reply) => {
      const { integrationId, namespace, clusterName } = request.query;
      if (!integrationId) {
        return reply.status(400).send({ error: 'integrationId is required' });
      }
      try {
        const config = await resolveK8sConfig(db, integrationId, clusterName);
        const deployments = await adapter.getDeployments(config, namespace);
        return reply.send(deployments);
      } catch (err: any) {
        log.error({ error: err.message }, 'Failed to get deployments');
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // GET /kubernetes/metrics?integrationId=X&namespace=Y&clusterName=Z
  app.get<{ Querystring: { integrationId: string; namespace?: string; clusterName?: string } }>(
    '/kubernetes/metrics',
    async (request, reply) => {
      const { integrationId, namespace, clusterName } = request.query;
      if (!integrationId) {
        return reply.status(400).send({ error: 'integrationId is required' });
      }
      try {
        const config = await resolveK8sConfig(db, integrationId, clusterName);
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

  // GET /kubernetes/events?integrationId=X&namespace=Y&name=Z&clusterName=W
  app.get<{ Querystring: { integrationId: string; namespace?: string; name?: string; clusterName?: string } }>(
    '/kubernetes/events',
    async (request, reply) => {
      const { integrationId, namespace, name, clusterName } = request.query;
      if (!integrationId) {
        return reply.status(400).send({ error: 'integrationId is required' });
      }
      try {
        const config = await resolveK8sConfig(db, integrationId, clusterName);
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
