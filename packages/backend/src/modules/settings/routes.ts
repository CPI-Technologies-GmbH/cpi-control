import { FastifyInstance } from 'fastify';
import { SettingsService } from './service.js';
import {
  websites,
  deploymentRecords,
  healthCheckResults,
  incidents,
  incidentEvents,
  diagnosticRuns,
  logViewConfigs,
} from '../../db/schema.js';
import { createChildLogger } from '../../shared/logger.js';
import { KeychainSecretStore } from '../secrets/keychain.js';
import { FallbackEncryptedStore } from '../secrets/fallback-encrypted.js';
import type { SecretStore } from '../secrets/keychain.js';

const log = createChildLogger('settings-routes');

const GITHUB_REPO = 'CPI-Technologies-GmbH/cpi-control';

// Version injected at build time by tsup (from package.json)
const APP_VERSION = process.env.APP_VERSION || '0.1.0';

let secretStore: SecretStore;
async function getSecretStore(): Promise<SecretStore> {
  if (secretStore) return secretStore;
  const ks = new KeychainSecretStore();
  if (await ks.init()) {
    secretStore = ks;
  } else {
    secretStore = new FallbackEncryptedStore();
  }
  return secretStore;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  draft: boolean;
  prerelease: boolean;
  assets: Array<{
    name: string;
    size: number;
    browser_download_url: string;
  }>;
}

export default async function settingsRoutes(app: FastifyInstance) {
  const settingsService = new SettingsService(app.db);

  // GET /settings
  app.get('/settings', async (_request, reply) => {
    const settings = settingsService.getAll();
    return reply.send(settings);
  });

  // PUT /settings
  app.put<{
    Body: Record<string, string | number>;
  }>('/settings', async (request, reply) => {
    try {
      const updated = settingsService.update(request.body as Record<string, string | number>);

      // Notify LogCollector of potential buffer size change
      if (app.logCollector) {
        app.logCollector.refreshBufferSize();
      }

      return reply.send(updated);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // POST /settings/reset — Delete all service data and re-sync from providers
  app.post('/settings/reset', async (_request, reply) => {
    try {
      log.info('Starting full data reset...');

      // Delete all services (cascades: monitoring_targets, infrastructure_bindings,
      // repository_bindings, deployment_sources, incidents, incident_events,
      // diagnostic_runs, health_check_results, deployment_records)
      const serviceCount = app.db.select().from(websites).all().length;
      app.db.delete(websites).run();

      // Delete orphaned deployment records (those with null website_id)
      app.db.delete(deploymentRecords).run();

      // Delete health check results
      app.db.delete(healthCheckResults).run();

      // Delete diagnostic runs
      app.db.delete(diagnosticRuns).run();

      // Delete incidents and events
      app.db.delete(incidentEvents).run();
      app.db.delete(incidents).run();

      log.info({ deletedServices: serviceCount }, 'All service data deleted');

      // Stop and restart health checker so it doesn't check stale targets
      if (app.healthChecker) {
        app.healthChecker.stop();
      }

      // Stop log collector
      if (app.logCollector) {
        app.logCollector.stop();
      }

      // Trigger fresh sync for all integrations
      if (app.syncScheduler) {
        const result = await app.syncScheduler.resyncAll();
        log.info(result, 'Re-sync completed after reset');

        // Restart health checker after sync
        if (app.healthChecker) {
          app.healthChecker.start();
        }

        // Restart log collector after sync
        if (app.logCollector) {
          await app.logCollector.start();
        }

        return reply.send({
          success: true,
          deletedServices: serviceCount,
          syncResult: result,
        });
      }

      return reply.send({
        success: true,
        deletedServices: serviceCount,
        syncResult: null,
      });
    } catch (err: any) {
      log.error({ error: err.message }, 'Reset failed');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /updates/app — Check for app updates via GitHub Releases
  app.get('/updates/app', async (_request, reply) => {
    try {
      const store = await getSecretStore();
      const token = await store.get('github_token');
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'CPI-Control',
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/latest`,
        { headers }
      );
      if (!res.ok) {
        return reply.status(502).send({ error: `GitHub API error: ${res.status}` });
      }
      const release = (await res.json()) as GitHubRelease;

      // Extract version from asset filenames (e.g. CPI-Control_0.1.26_aarch64.dmg)
      let latestVersion: string | undefined;
      for (const a of release.assets) {
        const m = a.name.match(/CPI-Control[_-](\d+\.\d+\.\d+)/);
        if (m) { latestVersion = m[1]; break; }
      }

      return reply.send({
        currentVersion: APP_VERSION,
        latestVersion: latestVersion ?? null,
        latestTag: release.tag_name,
        latestName: release.name,
        body: release.body,
        publishedAt: release.published_at,
        draft: release.draft,
        prerelease: release.prerelease,
        assets: release.assets.map((a) => ({
          name: a.name,
          size: a.size,
          url: a.browser_download_url,
        })),
      });
    } catch (err: any) {
      log.error({ error: err.message }, 'App update check failed');
      const msg = err.message?.includes('fetch') || err.name === 'AbortError'
        ? 'GitHub API not reachable. Check your internet connection.'
        : err.message;
      return reply.status(502).send({ error: msg });
    }
  });

  // GET /updates/agent — Check for agent updates via GitHub Releases
  app.get('/updates/agent', async (_request, reply) => {
    try {
      const store = await getSecretStore();
      const token = await store.get('github_token');
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'CPI-Control',
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/agent-latest`,
        { headers, signal: controller.signal }
      );
      clearTimeout(timer);

      if (!res.ok) {
        return reply.status(502).send({ error: `GitHub API error: ${res.status}` });
      }
      const release = (await res.json()) as GitHubRelease;

      // Extract version from asset filename
      let latestVersion: string | undefined;
      for (const a of release.assets) {
        const m = a.name.match(/agent[_-]?(\d+\.\d+\.\d+)/);
        if (m) { latestVersion = m[1]; break; }
      }

      return reply.send({
        latestVersion: latestVersion ?? null,
        latestTag: release.tag_name,
        latestName: release.name,
        body: release.body,
        publishedAt: release.published_at,
        draft: release.draft,
        prerelease: release.prerelease,
        assets: release.assets.map((a) => ({
          name: a.name,
          size: a.size,
          url: a.browser_download_url,
        })),
      });
    } catch (err: any) {
      log.error({ error: err.message }, 'Agent update check failed');
      const msg = err.message?.includes('fetch') || err.name === 'AbortError'
        ? 'GitHub API not reachable. Check your internet connection.'
        : err.message;
      return reply.status(502).send({ error: msg });
    }
  });
}
