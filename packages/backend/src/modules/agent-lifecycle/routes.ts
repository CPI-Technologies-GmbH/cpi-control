import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { remoteAgents } from '../../db/schema.js';
import { installAgent } from './installer.js';
import { uninstallAgent } from './uninstaller.js';
import { syncAgentConfig, generateAgentConfig } from './syncer.js';

function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return p.replace('~', process.env.HOME || '/root');
  }
  return p;
}

export default async function agentLifecycleRoutes(app: FastifyInstance) {
  const db = app.db;

  // List all agents
  app.get('/agents', async (_request, reply) => {
    const agents = db.select().from(remoteAgents).all();
    return reply.send(agents);
  });

  // Get single agent
  app.get<{ Params: { id: string } }>('/agents/:id', async (request, reply) => {
    const rows = db
      .select()
      .from(remoteAgents)
      .where(eq(remoteAgents.id, request.params.id))
      .all();
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Agent not found' });
    }
    return reply.send(rows[0]);
  });

  // Install a new agent
  app.post<{
    Body: {
      name: string;
      host: string;
      port?: number;
      username: string;
      privateKeyPath?: string;
      password?: string;
      agentVersion?: string;
      locationCity?: string;
      locationCountry?: string;
      config?: Record<string, unknown>;
    };
  }>('/agents/install', async (request, reply) => {
    const body = request.body;
    if (!body.name || !body.host || !body.username) {
      return reply.status(400).send({ error: 'name, host, and username are required' });
    }

    const now = new Date().toISOString();
    const agentId = ulid();

    // Create agent record with installing status
    db.insert(remoteAgents)
      .values({
        id: agentId,
        name: body.name,
        host: body.host,
        port: body.port || 22,
        username: body.username,
        status: 'installing',
        locationCity: body.locationCity || null,
        locationCountry: body.locationCountry || null,
        config: {
          ...(body.config || {}),
          ...(body.privateKeyPath && { privateKeyPath: body.privateKeyPath }),
        },
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Run installation asynchronously
    installAgent({
      host: body.host,
      port: body.port || 22,
      username: body.username,
      privateKeyPath: body.privateKeyPath,
      password: body.password,
      agentVersion: body.agentVersion,
      config: body.config,
    })
      .then((result) => {
        const updateNow = new Date().toISOString();
        db.update(remoteAgents)
          .set({
            status: result.success ? 'online' : 'error',
            version: result.version || null,
            installedAt: result.installedAt || null,
            metadata: { installResult: result },
            updatedAt: updateNow,
          })
          .where(eq(remoteAgents.id, agentId))
          .run();
      })
      .catch((err) => {
        db.update(remoteAgents)
          .set({
            status: 'error',
            metadata: { installError: err.message },
            updatedAt: new Date().toISOString(),
          })
          .where(eq(remoteAgents.id, agentId))
          .run();
      });

    return reply.status(202).send({
      id: agentId,
      status: 'installing',
      message: 'Installation started',
    });
  });

  // Sync agent config
  app.post<{ Params: { id: string } }>(
    '/agents/:id/sync',
    async (request, reply) => {
      const serverUrl =
        process.env.OPSBOARD_SERVER_URL || 'http://127.0.0.1:19876';
      const result = await syncAgentConfig(db, request.params.id, serverUrl);
      return reply.send(result);
    }
  );

  // Uninstall agent
  app.post<{ Params: { id: string } }>(
    '/agents/:id/uninstall',
    async (request, reply) => {
      const rows = db
        .select()
        .from(remoteAgents)
        .where(eq(remoteAgents.id, request.params.id))
        .all();
      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Agent not found' });
      }

      const agent = rows[0];
      const agentConfig = (agent.config as Record<string, unknown>) || {};

      const result = await uninstallAgent({
        host: agent.host,
        port: agent.port || 22,
        username: agent.username,
        privateKeyPath: agentConfig.privateKeyPath as string | undefined,
      });

      if (result.success) {
        db.delete(remoteAgents).where(eq(remoteAgents.id, request.params.id)).run();
      }

      return reply.send(result);
    }
  );

  // Restart agent
  app.post<{ Params: { id: string } }>(
    '/agents/:id/restart',
    async (request, reply) => {
      const rows = db
        .select()
        .from(remoteAgents)
        .where(eq(remoteAgents.id, request.params.id))
        .all();
      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Agent not found' });
      }

      const agent = rows[0];
      const agentConfig = (agent.config as Record<string, unknown>) || {};

      try {
        const { NodeSSH } = await import('node-ssh');
        const ssh = new NodeSSH();
        const connectOptions: any = {
          host: agent.host,
          port: agent.port || 22,
          username: agent.username,
        };

        let connected = false;
        if (agentConfig.privateKeyPath) {
          try {
            connectOptions.privateKeyPath = expandHome(agentConfig.privateKeyPath as string);
            await ssh.connect(connectOptions);
            connected = true;
          } catch {
            // Key file auth failed, try SSH agent below
          }
        }

        if (!connected && process.env.SSH_AUTH_SOCK) {
          try {
            await ssh.connect({
              host: agent.host,
              port: agent.port || 22,
              username: agent.username,
              agent: process.env.SSH_AUTH_SOCK,
            });
            connected = true;
          } catch {
            // SSH agent also failed
          }
        }

        if (!connected) {
          await ssh.connect(connectOptions);
        }

        await ssh.execCommand('sudo systemctl restart opsboard-agent');
        ssh.dispose();

        return reply.send({ success: true, message: 'Agent restart initiated' });
      } catch (err: any) {
        return reply.send({ success: false, message: err.message });
      }
    }
  );

  // Get agent status
  app.get<{ Params: { id: string } }>(
    '/agents/:id/status',
    async (request, reply) => {
      const rows = db
        .select()
        .from(remoteAgents)
        .where(eq(remoteAgents.id, request.params.id))
        .all();
      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Agent not found' });
      }

      const agent = rows[0];
      const lastHeartbeat = agent.lastHeartbeatAt
        ? new Date(agent.lastHeartbeatAt)
        : null;
      const staleMs = lastHeartbeat ? Date.now() - lastHeartbeat.getTime() : null;

      return reply.send({
        id: agent.id,
        name: agent.name,
        host: agent.host,
        status: agent.status,
        version: agent.version,
        lastHeartbeatAt: agent.lastHeartbeatAt,
        heartbeatAgeMs: staleMs,
        isStale: staleMs !== null && staleMs > 5 * 60 * 1000,
      });
    }
  );

  // Preview agent config (without deploying)
  app.get<{ Params: { id: string } }>(
    '/agents/:id/config-preview',
    async (request, reply) => {
      const serverUrl =
        process.env.OPSBOARD_SERVER_URL || 'http://127.0.0.1:19876';
      const config = await generateAgentConfig(
        db,
        request.params.id,
        serverUrl
      );
      if (!config) {
        return reply.status(404).send({ error: 'Agent not found' });
      }
      return reply.send(config);
    }
  );

  // Update agent settings
  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      host?: string;
      port?: number;
      username?: string;
      locationCity?: string | null;
      locationCountry?: string | null;
      publicKey?: string | null;
      config?: Record<string, unknown>;
    };
  }>('/agents/:id/settings', async (request, reply) => {
    const rows = db
      .select()
      .from(remoteAgents)
      .where(eq(remoteAgents.id, request.params.id))
      .all();
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    const body = request.body;
    const now = new Date().toISOString();

    db.update(remoteAgents)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.host !== undefined && { host: body.host }),
        ...(body.port !== undefined && { port: body.port }),
        ...(body.username !== undefined && { username: body.username }),
        ...(body.locationCity !== undefined && { locationCity: body.locationCity }),
        ...(body.locationCountry !== undefined && { locationCountry: body.locationCountry }),
        ...(body.publicKey !== undefined && { publicKey: body.publicKey }),
        ...(body.config !== undefined && { config: body.config }),
        updatedAt: now,
      })
      .where(eq(remoteAgents.id, request.params.id))
      .run();

    const updated = db
      .select()
      .from(remoteAgents)
      .where(eq(remoteAgents.id, request.params.id))
      .all()[0];

    return reply.send(updated);
  });

  // POST /agents/:id/poll — Trigger immediate agent poll
  app.post<{ Params: { id: string } }>('/agents/:id/poll', async (request, reply) => {
    const agent = db.select().from(remoteAgents).where(eq(remoteAgents.id, request.params.id)).all()[0];
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });

    const monitor = app.heartbeatMonitor;
    if (!monitor) return reply.status(500).send({ error: 'HeartbeatMonitor not available' });

    const result = await monitor.pollSingleAgent(agent);

    // Re-read agent after poll to get updated data
    const updated = db.select().from(remoteAgents).where(eq(remoteAgents.id, request.params.id)).all()[0];
    return reply.send({
      success: result.success,
      agent: updated,
      health: result.data || null,
    });
  });

  // Delete agent record (useful for cleaning up failed installs)
  app.delete<{ Params: { id: string } }>(
    '/agents/:id',
    async (request, reply) => {
      const rows = db
        .select()
        .from(remoteAgents)
        .where(eq(remoteAgents.id, request.params.id))
        .all();
      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Agent not found' });
      }

      db.delete(remoteAgents)
        .where(eq(remoteAgents.id, request.params.id))
        .run();

      return reply.send({ success: true, message: 'Agent record deleted' });
    }
  );

  // Retry installation for an existing agent (e.g. after a failed install)
  app.post<{
    Params: { id: string };
    Body: {
      privateKeyPath?: string;
      password?: string;
      agentVersion?: string;
    };
  }>('/agents/:id/retry-install', async (request, reply) => {
    const rows = db
      .select()
      .from(remoteAgents)
      .where(eq(remoteAgents.id, request.params.id))
      .all();
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    const agent = rows[0];
    const agentConfig = (agent.config as Record<string, unknown>) || {};
    const body = request.body || {};

    // Determine SSH credentials: prefer body overrides, fall back to stored config
    const privateKeyPath =
      body.privateKeyPath || (agentConfig.privateKeyPath as string | undefined);
    const password = body.password || undefined;

    // Update status to installing
    db.update(remoteAgents)
      .set({
        status: 'installing',
        metadata: { retryAt: new Date().toISOString() },
        updatedAt: new Date().toISOString(),
      })
      .where(eq(remoteAgents.id, agent.id))
      .run();

    // Run installation asynchronously
    installAgent({
      host: agent.host,
      port: agent.port || 22,
      username: agent.username,
      privateKeyPath,
      password,
      agentVersion: body.agentVersion,
      config: agentConfig,
    })
      .then((result) => {
        const updateNow = new Date().toISOString();
        db.update(remoteAgents)
          .set({
            status: result.success ? 'online' : 'error',
            version: result.version || null,
            installedAt: result.installedAt || null,
            metadata: { installResult: result },
            updatedAt: updateNow,
          })
          .where(eq(remoteAgents.id, agent.id))
          .run();
      })
      .catch((err) => {
        db.update(remoteAgents)
          .set({
            status: 'error',
            metadata: { installError: err.message },
            updatedAt: new Date().toISOString(),
          })
          .where(eq(remoteAgents.id, agent.id))
          .run();
      });

    return reply.status(202).send({
      id: agent.id,
      status: 'installing',
      message: 'Retry installation started',
    });
  });
}
