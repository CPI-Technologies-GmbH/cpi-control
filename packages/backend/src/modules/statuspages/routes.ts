import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { statusPages, remoteAgents } from '../../db/schema.js';

export default async function statusPageRoutes(app: FastifyInstance) {
  const db = app.db;

  // List all status pages
  app.get('/statuspages', async (_request, reply) => {
    const pages = db.select().from(statusPages).all();
    return reply.send(pages);
  });

  // Get single status page
  app.get<{ Params: { id: string } }>('/statuspages/:id', async (request, reply) => {
    const rows = db
      .select()
      .from(statusPages)
      .where(eq(statusPages.id, request.params.id))
      .all();
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Status page not found' });
    }
    return reply.send(rows[0]);
  });

  // Create status page
  app.post<{
    Body: {
      name: string;
      domain: string;
      agentId: string;
      theme?: string;
      brandingLogo?: string;
      brandingColor?: string;
      brandingCompany?: string;
      config?: Record<string, unknown>;
      isActive?: boolean;
    };
  }>('/statuspages', async (request, reply) => {
    const body = request.body;
    if (!body.name || !body.domain || !body.agentId) {
      return reply.status(400).send({ error: 'name, domain, and agentId are required' });
    }

    // Verify agent exists
    const agentRows = db.select().from(remoteAgents).where(eq(remoteAgents.id, body.agentId)).all();
    if (agentRows.length === 0) {
      return reply.status(400).send({ error: 'Agent not found' });
    }

    const now = new Date().toISOString();
    const id = ulid();

    db.insert(statusPages)
      .values({
        id,
        name: body.name,
        domain: body.domain,
        agentId: body.agentId,
        theme: body.theme || 'dark',
        brandingLogo: body.brandingLogo || null,
        brandingColor: body.brandingColor || null,
        brandingCompany: body.brandingCompany || null,
        config: body.config || null,
        isActive: body.isActive !== undefined ? body.isActive : true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const created = db.select().from(statusPages).where(eq(statusPages.id, id)).all()[0];
    return reply.status(201).send(created);
  });

  // Update status page
  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      domain?: string;
      agentId?: string;
      theme?: string;
      brandingLogo?: string | null;
      brandingColor?: string | null;
      brandingCompany?: string | null;
      config?: Record<string, unknown> | null;
      isActive?: boolean;
    };
  }>('/statuspages/:id', async (request, reply) => {
    const rows = db
      .select()
      .from(statusPages)
      .where(eq(statusPages.id, request.params.id))
      .all();
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Status page not found' });
    }

    const body = request.body;
    const now = new Date().toISOString();

    // Verify agent exists if changing agentId
    if (body.agentId) {
      const agentRows = db.select().from(remoteAgents).where(eq(remoteAgents.id, body.agentId)).all();
      if (agentRows.length === 0) {
        return reply.status(400).send({ error: 'Agent not found' });
      }
    }

    db.update(statusPages)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.domain !== undefined && { domain: body.domain }),
        ...(body.agentId !== undefined && { agentId: body.agentId }),
        ...(body.theme !== undefined && { theme: body.theme }),
        ...(body.brandingLogo !== undefined && { brandingLogo: body.brandingLogo }),
        ...(body.brandingColor !== undefined && { brandingColor: body.brandingColor }),
        ...(body.brandingCompany !== undefined && { brandingCompany: body.brandingCompany }),
        ...(body.config !== undefined && { config: body.config }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        updatedAt: now,
      })
      .where(eq(statusPages.id, request.params.id))
      .run();

    const updated = db.select().from(statusPages).where(eq(statusPages.id, request.params.id)).all()[0];
    return reply.send(updated);
  });

  // Delete status page
  app.delete<{ Params: { id: string } }>('/statuspages/:id', async (request, reply) => {
    const rows = db
      .select()
      .from(statusPages)
      .where(eq(statusPages.id, request.params.id))
      .all();
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Status page not found' });
    }

    db.delete(statusPages).where(eq(statusPages.id, request.params.id)).run();
    return reply.status(204).send();
  });

  // Deploy status page config to agent via SSH
  app.post<{ Params: { id: string } }>('/statuspages/:id/deploy', async (request, reply) => {
    const rows = db
      .select()
      .from(statusPages)
      .where(eq(statusPages.id, request.params.id))
      .all();
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Status page not found' });
    }

    const page = rows[0];
    if (!page.agentId) {
      return reply.status(400).send({ error: 'No agent assigned to this status page' });
    }

    const agentRows = db.select().from(remoteAgents).where(eq(remoteAgents.id, page.agentId)).all();
    if (agentRows.length === 0) {
      return reply.status(400).send({ error: 'Assigned agent not found' });
    }

    const agent = agentRows[0];
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
          const keyPath = (agentConfig.privateKeyPath as string).replace('~', process.env.HOME || '/root');
          connectOptions.privateKeyPath = keyPath;
          await ssh.connect(connectOptions);
          connected = true;
        } catch {
          // Key file auth failed
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

      // Build the full statuspage.json with all pages for this agent
      const allPages = db.select().from(statusPages)
        .where(eq(statusPages.agentId, page.agentId!))
        .all();

      const statusPageConfig = {
        pages: allPages.filter((p: any) => p.isActive).map((p: any) => {
          const cfg = (p.config || {}) as Record<string, unknown>;
          return {
            id: p.id,
            domain: p.domain,
            theme: p.theme,
            branding: {
              logo_url: p.brandingLogo || '',
              primary_color: p.brandingColor || '#3b82f6',
              company_name: p.brandingCompany || '',
            },
            projects: (cfg.projects as any[]) || [],
          };
        }),
      };

      const configJson = JSON.stringify(statusPageConfig, null, 2);

      await ssh.execCommand(`cat > /etc/opsboard-agent/statuspage.json << 'EOFCONFIG'\n${configJson}\nEOFCONFIG`);
      await ssh.execCommand('sudo systemctl restart opsboard-agent');

      ssh.dispose();

      return reply.send({ success: true });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
}
