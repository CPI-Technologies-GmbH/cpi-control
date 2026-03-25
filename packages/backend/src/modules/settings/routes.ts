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

const log = createChildLogger('settings-routes');

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
}
