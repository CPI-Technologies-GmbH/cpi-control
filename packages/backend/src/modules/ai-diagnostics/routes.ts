import { FastifyInstance } from 'fastify';
import { DiagnosisOrchestrator } from './orchestrator.js';

export default async function aiDiagnosticsRoutes(app: FastifyInstance) {
  const db = app.db;
  const orchestrator = new DiagnosisOrchestrator(db);

  // Trigger a new diagnosis
  app.post<{
    Body: {
      serviceId: string;
      trigger?: 'manual' | 'automatic' | 'incident';
      incidentId?: string;
    };
  }>('/diagnostics', async (request, reply) => {
    const { serviceId, trigger, incidentId } = request.body;
    if (!serviceId) {
      return reply.status(400).send({ error: 'serviceId is required' });
    }

    const result = await orchestrator.startDiagnosis(
      serviceId,
      trigger || 'manual',
      incidentId
    );

    return reply.status(202).send(result);
  });

  // List diagnostic runs
  app.get<{ Querystring: { serviceId?: string; limit?: string } }>(
    '/diagnostics',
    async (request, reply) => {
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 20;
      const runs = await orchestrator.listRuns(request.query.serviceId, limit);
      return reply.send(runs);
    }
  );

  // Get diagnostic run detail
  app.get<{ Params: { id: string } }>('/diagnostics/:id', async (request, reply) => {
    const run = await orchestrator.getRun(request.params.id);
    if (!run) {
      return reply.status(404).send({ error: 'Diagnostic run not found' });
    }
    return reply.send(run);
  });
}
