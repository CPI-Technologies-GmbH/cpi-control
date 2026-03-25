import { FastifyInstance } from 'fastify';
import { VercelAdapter } from '../../providers/vercel/adapter.js';
import { createChildLogger } from '../../shared/logger.js';
import { KeychainSecretStore, type SecretStore } from '../secrets/keychain.js';
import { FallbackEncryptedStore } from '../secrets/fallback-encrypted.js';
import * as integrationService from '../integrations/service.js';
import type { VercelConfig } from '../../providers/vercel/types.js';

const log = createChildLogger('vercel-routes');
const adapter = new VercelAdapter();

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

async function resolveVercelConfig(db: any, integrationId: string): Promise<VercelConfig> {
  const integration = await integrationService.getIntegration(db, integrationId);
  if (!integration) {
    throw new Error('Integration not found');
  }
  if (integration.provider !== 'vercel') {
    throw new Error('Integration is not a Vercel integration');
  }

  const store = await getSecretStore();
  const config: Record<string, unknown> = { ...((integration.config as Record<string, unknown>) || {}) };

  // Resolve token from secret store
  if (!config.token) {
    const token = await store.get('vercel_token');
    if (token) {
      config.token = token;
    }
  }

  return config as unknown as VercelConfig;
}

export default async function vercelRoutes(app: FastifyInstance) {
  const db = app.db;

  // GET /vercel/projects?integrationId=X
  app.get<{ Querystring: { integrationId: string } }>(
    '/vercel/projects',
    async (request, reply) => {
      const { integrationId } = request.query;
      if (!integrationId) {
        return reply.status(400).send({ error: 'integrationId is required' });
      }
      try {
        const config = await resolveVercelConfig(db, integrationId);
        const projects = await adapter.getProjects(config);
        return reply.send(projects);
      } catch (err: any) {
        log.error({ error: err.message }, 'Failed to get Vercel projects');
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // GET /vercel/projects/:projectId?integrationId=X
  app.get<{ Params: { projectId: string }; Querystring: { integrationId: string } }>(
    '/vercel/projects/:projectId',
    async (request, reply) => {
      const { integrationId } = request.query;
      const { projectId } = request.params;
      if (!integrationId) {
        return reply.status(400).send({ error: 'integrationId is required' });
      }
      try {
        const config = await resolveVercelConfig(db, integrationId);
        const details = await adapter.getProjectDetails(config, projectId);
        return reply.send(details);
      } catch (err: any) {
        log.error({ error: err.message, projectId }, 'Failed to get Vercel project details');
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // GET /vercel/deployments?integrationId=X&projectId=Y&limit=Z
  app.get<{ Querystring: { integrationId: string; projectId?: string; limit?: string } }>(
    '/vercel/deployments',
    async (request, reply) => {
      const { integrationId, projectId, limit } = request.query;
      if (!integrationId) {
        return reply.status(400).send({ error: 'integrationId is required' });
      }
      try {
        const config = await resolveVercelConfig(db, integrationId);
        const deployments = await adapter.getDeployments(config, projectId, limit ? parseInt(limit, 10) : 20);
        return reply.send(deployments);
      } catch (err: any) {
        log.error({ error: err.message }, 'Failed to get Vercel deployments');
        return reply.status(500).send({ error: err.message });
      }
    }
  );
}
