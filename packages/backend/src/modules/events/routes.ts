import { FastifyInstance } from 'fastify';
import { eventBus, type OpsEvent } from '../../shared/event-bus.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('events-sse');

export default async function eventStreamRoutes(app: FastifyInstance) {
  // GET /events/stream - SSE endpoint for real-time push notifications
  app.get('/events/stream', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial connection event
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ message: 'Connected to event stream' })}\n\n`);

    // Keepalive ping every 15 seconds
    const keepalive = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, 15000);

    let closed = false;

    // Listen for ops events
    const onEvent = (event: OpsEvent) => {
      if (closed) return;
      try {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      } catch (err: any) {
        log.warn({ error: err.message }, 'Failed to write SSE event');
      }
    };

    eventBus.on('ops-event', onEvent);

    // Cleanup on connection close
    request.raw.on('close', () => {
      closed = true;
      clearInterval(keepalive);
      eventBus.off('ops-event', onEvent);
      log.debug('SSE client disconnected');
    });

    log.debug('SSE client connected');
  });
}
