import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { createDatabase, runMigrations, type DB } from './db/client.js';
import { createChildLogger } from './shared/logger.js';
import { SyncScheduler } from './modules/integrations/sync-scheduler.js';
import { NotificationService } from './modules/notifications/service.js';
import { HeartbeatMonitor } from './modules/agent-lifecycle/heartbeat.js';
import { HealthChecker } from './modules/health-checker/index.js';
import { SlackAdapter } from './providers/slack/adapter.js';
import { GitHubAdapter } from './providers/github/adapter.js';
import { VercelAdapter } from './providers/vercel/adapter.js';
import { KubernetesAdapter } from './providers/kubernetes/adapter.js';
import { DigitalOceanAdapter } from './providers/digitalocean/adapter.js';
import { SemaphoreAdapter } from './providers/semaphore/adapter.js';
import { LogCollector } from './modules/logs/collector.js';
import { IncidentDetector } from './modules/incidents/service.js';

// Route imports
import inventoryRoutes from './modules/inventory/routes.js';
import integrationRoutes from './modules/integrations/routes.js';
import deploymentRoutes from './modules/deployments/routes.js';
import incidentRoutes from './modules/incidents/routes.js';
import notificationRoutes from './modules/notifications/routes.js';
import aiDiagnosticsRoutes from './modules/ai-diagnostics/routes.js';
import secretsRoutes from './modules/secrets/routes.js';
import agentLifecycleRoutes from './modules/agent-lifecycle/routes.js';
import logRoutes from './modules/logs/routes.js';
import logConfigRoutes from './modules/logs/config-routes.js';
import cronjobRoutes from './modules/cronjobs/routes.js';
import kubernetesRoutes from './modules/kubernetes/routes.js';
import vercelRoutes from './modules/vercel/routes.js';
import settingsRoutes from './modules/settings/routes.js';
import eventStreamRoutes from './modules/events/routes.js';
import healthEventReceiver from './webhooks/health-event-receiver.js';
import { dashboardRoutes } from './dashboard.js';
import { KeychainSecretStore, type SecretStore } from './modules/secrets/keychain.js';
import { FallbackEncryptedStore } from './modules/secrets/fallback-encrypted.js';
import { integrationConfigs } from './db/schema.js';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';

const log = createChildLogger('server');

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
    syncScheduler?: SyncScheduler;
    notificationService?: NotificationService;
    heartbeatMonitor?: HeartbeatMonitor;
    healthChecker?: HealthChecker;
    logCollector?: LogCollector;
  }
}

export interface ServerConfig {
  dbPath?: string;
  port?: number;
  host?: string;
}

export async function buildApp(config: ServerConfig = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // We use our own pino logger
  });

  // Register CORS
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Create DB connection
  const dbPath = config.dbPath || process.env.OPSBOARD_DB_PATH || './data.db';
  const db = createDatabase(dbPath);
  runMigrations(db);

  // Decorate app with db
  app.decorate('db', db);

  // Set up secret store
  let secretStore: SecretStore;
  const keychainStore = new KeychainSecretStore();
  if (await keychainStore.init()) {
    secretStore = keychainStore;
  } else {
    secretStore = new FallbackEncryptedStore();
  }

  // Set up sync scheduler with secret store
  const syncScheduler = new SyncScheduler(db, secretStore);
  syncScheduler.registerAdapter('github', new GitHubAdapter());
  syncScheduler.registerAdapter('vercel', new VercelAdapter());
  syncScheduler.registerAdapter('kubernetes', new KubernetesAdapter());
  syncScheduler.registerAdapter('digitalocean', new DigitalOceanAdapter());
  syncScheduler.registerAdapter('semaphore', new SemaphoreAdapter());
  app.decorate('syncScheduler', syncScheduler);

  // Set up notification service
  const notificationService = new NotificationService(db);
  const slackAdapter = new SlackAdapter();

  // Register Slack notification sender
  notificationService.registerSender(
    'slack',
    async (channelConfig, message, details) => {
      const webhookUrl = channelConfig.webhookUrl as string | undefined;
      const botToken = channelConfig.botToken as string | undefined;
      const channel = channelConfig.channel as string | undefined;

      if (webhookUrl) {
        return slackAdapter.sendWebhookMessage(webhookUrl, message);
      }
      if (botToken && channel) {
        return slackAdapter.sendBotMessage(botToken, channel, message);
      }
      return false;
    }
  );

  // Register webhook notification sender
  notificationService.registerSender(
    'webhook',
    async (channelConfig, message, details) => {
      const url = channelConfig.url as string;
      if (!url) return false;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, ...details }),
        });
        return response.ok;
      } catch {
        return false;
      }
    }
  );

  app.decorate('notificationService', notificationService);

  // Set up heartbeat monitor
  const heartbeatMonitor = new HeartbeatMonitor(db);
  app.decorate('heartbeatMonitor', heartbeatMonitor);

  // Set up health checker with incident detection
  const incidentDetector = new IncidentDetector(db);
  const healthChecker = new HealthChecker(db, {
    incidentDetector,
    notificationService,
  });
  app.decorate('healthChecker', healthChecker);

  // Set up log collector for background K8s log collection
  const logCollector = new LogCollector(db, secretStore);
  app.decorate('logCollector', logCollector);

  // Register module routes with prefixes
  await app.register(inventoryRoutes, { prefix: '/api/inventory' });
  await app.register(integrationRoutes, { prefix: '/api' });
  await app.register(deploymentRoutes, { prefix: '/api' });
  await app.register(incidentRoutes, { prefix: '/api' });
  await app.register(notificationRoutes, { prefix: '/api' });
  await app.register(aiDiagnosticsRoutes, { prefix: '/api' });
  await app.register(secretsRoutes, { prefix: '/api' });
  await app.register(agentLifecycleRoutes, { prefix: '/api' });
  await app.register(logRoutes, { prefix: '/api' });
  await app.register(logConfigRoutes, { prefix: '/api' });
  await app.register(cronjobRoutes, { prefix: '/api' });
  await app.register(kubernetesRoutes, { prefix: '/api' });
  await app.register(vercelRoutes, { prefix: '/api' });
  await app.register(settingsRoutes, { prefix: '/api' });
  await app.register(eventStreamRoutes, { prefix: '/api' });

  // Register webhook receiver
  await app.register(healthEventReceiver, { prefix: '/api' });

  // Register dashboard routes
  await app.register(dashboardRoutes, { prefix: '/api' });

  // Health check endpoint
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Ready hook
  app.addHook('onReady', async () => {
    heartbeatMonitor.start();
    log.info('HeartbeatMonitor started');

    // Auto-create integrations for providers that have secrets configured
    const providerSecretMap: Record<string, { keys: string[]; name: string }> = {
      github: { keys: ['github_token'], name: 'GitHub' },
      vercel: { keys: ['vercel_token'], name: 'Vercel' },
      kubernetes: { keys: ['kubeconfig'], name: 'Kubernetes' },
      digitalocean: { keys: ['digitalocean_token'], name: 'DigitalOcean' },
      semaphore: { keys: ['semaphore_token', 'semaphore_org_url'], name: 'Semaphore' },
    };

    for (const [provider, info] of Object.entries(providerSecretMap)) {
      // Check if secrets exist for this provider
      let hasSecrets = false;
      for (const key of info.keys) {
        const value = await secretStore.get(key);
        if (value) { hasSecrets = true; break; }
      }
      if (!hasSecrets) continue;

      // Check if integration already exists
      const existing = db.select().from(integrationConfigs)
        .where(eq(integrationConfigs.provider, provider)).all();
      if (existing.length > 0) {
        log.info({ provider }, 'Integration already exists, skipping auto-create');
        continue;
      }

      // Auto-create integration
      const now = new Date().toISOString();
      db.insert(integrationConfigs).values({
        id: ulid(),
        provider,
        name: info.name,
        enabled: true,
        config: {},
        syncIntervalSeconds: 10,
        createdAt: now,
        updatedAt: now,
      }).run();
      log.info({ provider }, 'Auto-created integration from available secrets');
    }

    // Start sync scheduler (loads enabled integrations and runs initial sync)
    await syncScheduler.startAll();
    log.info('SyncScheduler started');

    // Start health checker AFTER sync so monitoring targets exist
    healthChecker.start();
    log.info('HealthChecker started');

    // Start log collector AFTER sync so infrastructure bindings with namespaces exist
    await logCollector.start();
    log.info('LogCollector started');
  });

  // Cleanup on close
  app.addHook('onClose', async () => {
    logCollector.stop();
    syncScheduler.stopAll();
    heartbeatMonitor.stop();
    healthChecker.stop();
    await notificationService.flushAll();
    log.info('Cleanup complete');
  });

  return app;
}

// Start server when run directly
const isMainModule = process.argv[1]?.includes('index');

if (isMainModule) {
  const port = parseInt(process.env.OPSBOARD_PORT || '19876', 10);
  const host = process.env.OPSBOARD_HOST || '127.0.0.1';

  buildApp()
    .then((app) => {
      app.listen({ port, host }, (err, address) => {
        if (err) {
          log.error({ error: err.message }, 'Failed to start server');
          process.exit(1);
        }
        log.info({ address }, 'OpsBoard backend listening');
      });
    })
    .catch((err) => {
      log.error({ error: err.message }, 'Failed to build app');
      process.exit(1);
    });
}
