import { FastifyInstance } from 'fastify';
import { websites, remoteAgents, statusPages } from '../../db/schema.js';

export default async function licenseRoutes(app: FastifyInstance) {
  const db = app.db;

  // GET /license — current license info
  app.get('/license', async (_request, reply) => {
    const lm = app.licenseManager;
    if (!lm) {
      return reply.send({ plan: 'free', status: 'free', limits: { maxServices: 50, maxAgents: 1, maxStatusPages: 2 } });
    }

    const license = lm.getLicense();
    const status = lm.getStatus();
    const limits = lm.getLimits();

    // Get current usage
    const serviceCount = db.select().from(websites).all().length;
    const agentCount = db.select().from(remoteAgents).all().length;
    const statusPageCount = db.select().from(statusPages).all().length;

    return reply.send({
      plan: license?.plan || 'free',
      status,
      limits,
      usage: { services: serviceCount, agents: agentCount, statusPages: statusPageCount },
      expiresAt: license?.expiresAt || null,
      lastValidated: license?.lastValidated || null,
      offlineSince: license?.offlineSince || null,
    });
  });

  // POST /license/activate
  app.post<{ Body: { licenseKey: string; machineId: string } }>(
    '/license/activate',
    async (request, reply) => {
      const lm = app.licenseManager;
      if (!lm) {
        return reply.status(500).send({ error: 'LicenseManager not available' });
      }

      const { licenseKey, machineId } = request.body;
      if (!licenseKey || !machineId) {
        return reply.status(400).send({ error: 'licenseKey and machineId are required' });
      }

      try {
        const info = await lm.activate(licenseKey, machineId);
        return reply.send(info);
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );

  // POST /license/deactivate
  app.post('/license/deactivate', async (_request, reply) => {
    const lm = app.licenseManager;
    if (!lm) {
      return reply.status(500).send({ error: 'LicenseManager not available' });
    }

    await lm.deactivate();
    return reply.send({ success: true });
  });

  // POST /license/validate — force re-validation
  app.post('/license/validate', async (_request, reply) => {
    const lm = app.licenseManager;
    if (!lm) {
      return reply.status(500).send({ error: 'LicenseManager not available' });
    }

    const info = await lm.forceValidate();
    return reply.send(info || { plan: 'free', status: 'free' });
  });
}
