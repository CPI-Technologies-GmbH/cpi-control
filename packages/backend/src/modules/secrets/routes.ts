import { FastifyInstance } from 'fastify';
import { KeychainSecretStore, type SecretStore } from './keychain.js';
import { FallbackEncryptedStore } from './fallback-encrypted.js';
import { createChildLogger } from '../../shared/logger.js';
import { integrationConfigs } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';

const log = createChildLogger('secrets-routes');

let store: SecretStore;

async function getStore(): Promise<SecretStore> {
  if (store) return store;

  const keychainStore = new KeychainSecretStore();
  const available = await keychainStore.init();

  if (available) {
    store = keychainStore;
    log.info('Using keychain secret store');
  } else {
    store = new FallbackEncryptedStore();
    log.info('Using fallback encrypted secret store');
  }

  return store;
}

// Known secret providers
const PROVIDERS = [
  { id: 'github', name: 'GitHub', keys: ['github_token'] },
  { id: 'vercel', name: 'Vercel', keys: ['vercel_token'] },
  { id: 'digitalocean', name: 'DigitalOcean', keys: ['digitalocean_token'] },
  { id: 'kubernetes', name: 'Kubernetes', keys: ['kubeconfig'] },
  { id: 'slack', name: 'Slack', keys: ['slack_webhook_url', 'slack_bot_token'] },
  { id: 'openai', name: 'OpenAI', keys: ['openai_api_key'] },
  { id: 'bitbucket', name: 'Bitbucket', keys: ['bitbucket_token'] },
  { id: 'semaphore', name: 'Semaphore', keys: ['semaphore_token'] },
];

/** Map secret keys to the provider that should be auto-created */
const SECRET_TO_PROVIDER: Record<string, { provider: string; name: string }> = {
  github_token: { provider: 'github', name: 'GitHub' },
  vercel_token: { provider: 'vercel', name: 'Vercel' },
  digitalocean_token: { provider: 'digitalocean', name: 'DigitalOcean' },
  semaphore_token: { provider: 'semaphore', name: 'Semaphore' },
};

export default async function secretsRoutes(app: FastifyInstance) {
  /** Auto-create an IntegrationConfig if none exists for this provider */
  function ensureIntegration(provider: string, name: string) {
    const db = app.db;
    const existing = db.select().from(integrationConfigs)
      .where(eq(integrationConfigs.provider, provider)).all();
    if (existing.length > 0) return;

    const now = new Date().toISOString();
    db.insert(integrationConfigs).values({
      id: ulid(),
      provider,
      name,
      enabled: true,
      config: {},
      syncIntervalSeconds: 10,
      createdAt: now,
      updatedAt: now,
    }).run();
    log.info({ provider }, 'Auto-created integration after secret save');
  }
  // List secret providers and their status
  app.get('/secrets/providers', async (_request, reply) => {
    const s = await getStore();
    const existingKeys = await s.list();
    const keySet = new Set(existingKeys);

    // Check if any kubeconfig keys exist (kubeconfig or kubeconfig:*)
    const hasAnyKubeconfig = existingKeys.some(
      (k) => k === 'kubeconfig' || k.startsWith('kubeconfig:')
    );

    const result = PROVIDERS.map((p) => ({
      ...p,
      configured:
        p.id === 'kubernetes'
          ? hasAnyKubeconfig
          : p.keys.some((k) => keySet.has(k)),
      keys: p.keys.map((k) => ({
        key: k,
        hasValue: keySet.has(k),
      })),
    }));

    return reply.send(result);
  });

  // List all named kubeconfig secrets
  app.get('/secrets/kubernetes/configs', async (_request, reply) => {
    const s = await getStore();
    const allKeys = await s.list();
    const configs = allKeys
      .filter((k) => k === 'kubeconfig' || k.startsWith('kubeconfig:'))
      .map((k) => ({
        key: k,
        name: k === 'kubeconfig' ? 'default' : k.split(':')[1],
      }));
    return reply.send(configs);
  });

  // Save a named kubeconfig secret
  app.put<{ Params: { name: string }; Body: { value: string } }>(
    '/secrets/kubernetes/configs/:name',
    async (request, reply) => {
      const key =
        request.params.name === 'default'
          ? 'kubeconfig'
          : `kubeconfig:${request.params.name}`;
      const s = await getStore();
      await s.set(key, request.body.value);

      // Auto-create Kubernetes integration
      ensureIntegration('kubernetes', 'Kubernetes');

      return reply.send({ key, saved: true });
    }
  );

  // Delete a named kubeconfig secret
  app.delete<{ Params: { name: string } }>(
    '/secrets/kubernetes/configs/:name',
    async (request, reply) => {
      const key =
        request.params.name === 'default'
          ? 'kubeconfig'
          : `kubeconfig:${request.params.name}`;
      const s = await getStore();
      const deleted = await s.delete(key);
      if (!deleted) {
        return reply.status(404).send({ error: 'Kubeconfig not found' });
      }
      return reply.status(204).send();
    }
  );

  // Get status of secret store
  app.get('/secrets/status', async (_request, reply) => {
    const s = await getStore();
    const isKeychain = s instanceof KeychainSecretStore;
    return reply.send({
      backend: isKeychain ? 'keychain' : 'encrypted-file',
      available: await s.isAvailable(),
      secretCount: (await s.list()).length,
    });
  });

  // Save a secret
  app.put<{ Params: { key: string }; Body: { value: string } }>(
    '/secrets/:key',
    async (request, reply) => {
      const { key } = request.params;
      const { value } = request.body;

      if (!value) {
        return reply.status(400).send({ error: 'value is required' });
      }

      const s = await getStore();
      await s.set(key, value);

      // Auto-create integration if this secret maps to a provider
      const mapping = SECRET_TO_PROVIDER[key];
      if (mapping) {
        ensureIntegration(mapping.provider, mapping.name);
      }

      return reply.send({ key, saved: true });
    }
  );

  // Delete a secret
  app.delete<{ Params: { key: string } }>(
    '/secrets/:key',
    async (request, reply) => {
      const s = await getStore();
      const deleted = await s.delete(request.params.key);
      if (!deleted) {
        return reply.status(404).send({ error: 'Secret not found' });
      }
      return reply.status(204).send();
    }
  );

  // Check if a specific secret exists (never returns the actual value)
  app.get<{ Params: { key: string } }>(
    '/secrets/:key/exists',
    async (request, reply) => {
      const s = await getStore();
      const value = await s.get(request.params.key);
      return reply.send({ key: request.params.key, exists: value !== null });
    }
  );
}
