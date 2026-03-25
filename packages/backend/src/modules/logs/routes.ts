import { FastifyInstance } from 'fastify';
import { LogService } from './service.js';
import type { LogFilter, LogSource, LogLevel } from './types.js';
import { KeychainSecretStore, type SecretStore } from '../secrets/keychain.js';
import { FallbackEncryptedStore } from '../secrets/fallback-encrypted.js';

let logService: LogService | null = null;

async function getSecretStore(): Promise<SecretStore> {
  const keychainStore = new KeychainSecretStore();
  if (await keychainStore.init()) return keychainStore;
  return new FallbackEncryptedStore();
}

export default async function logRoutes(app: FastifyInstance) {
  // Initialize LogService lazily
  if (!logService) {
    const secretStore = await getSecretStore();
    logService = new LogService(app.db, secretStore);
  }

  // Attach LogCollector if available (set up in index.ts)
  if (app.logCollector) {
    logService.setLogCollector(app.logCollector);
  }

  // GET /logs
  app.get<{
    Querystring: {
      source?: string | string[];
      level?: string | string[];
      since?: string;
      until?: string;
      search?: string;
      namespace?: string;
      pod?: string;
      limit?: string;
      serviceId?: string;
    };
  }>('/logs', async (request, reply) => {
    const q = request.query;
    const filter: LogFilter = {
      source: q.source as LogSource | LogSource[] | undefined,
      level: q.level as LogLevel | LogLevel[] | undefined,
      since: q.since || '1h',
      until: q.until,
      search: q.search,
      namespace: q.namespace,
      pod: q.pod,
      limit: q.limit ? parseInt(q.limit, 10) : 200,
      serviceId: q.serviceId,
    };
    const logs = await logService!.getLogs(filter);
    return reply.send(logs);
  });

  // GET /logs/stream - SSE endpoint for live log tailing
  app.get<{
    Querystring: {
      source?: string | string[];
      level?: string | string[];
      since?: string;
      search?: string;
      namespace?: string;
      pod?: string;
      serviceId?: string;
    };
  }>('/logs/stream', async (request, reply) => {
    const q = request.query;
    const filter: LogFilter = {
      source: q.source as LogSource | LogSource[] | undefined,
      level: q.level as LogLevel | LogLevel[] | undefined,
      since: q.since || '5m',
      search: q.search,
      namespace: q.namespace,
      pod: q.pod,
      serviceId: q.serviceId,
    };

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Keepalive ping every 15 seconds
    const keepalive = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, 15000);

    let closed = false;
    request.raw.on('close', () => {
      closed = true;
      clearInterval(keepalive);
    });

    try {
      for await (const entry of logService!.streamLogs(filter)) {
        if (closed) break;
        reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`);
      }
    } catch (err) {
      if (!closed) {
        reply.raw.write(
          `event: error\ndata: ${JSON.stringify({ error: (err as Error).message })}\n\n`
        );
      }
    } finally {
      clearInterval(keepalive);
      if (!closed) reply.raw.end();
    }
  });

  // GET /logs/sources - List available log sources
  app.get('/logs/sources', async (_request, reply) => {
    const sources = await logService!.getLogSources();
    return reply.send(sources);
  });

  // Cleanup on app close
  app.addHook('onClose', async () => {
    logService?.cleanup();
  });
}
