import type {
  ProviderAdapter,
  ConnectionTestResult,
  SyncOptions,
  SyncResult,
  SyncedDeployment,
} from '../../shared/provider-interface.js';
import { rateLimiter } from '../../shared/rate-limiter.js';
import { withRetry } from '../../shared/retry.js';
import { createChildLogger } from '../../shared/logger.js';
import { mapDeployment, vercelStateToDeploymentStatus } from './mapper.js';
import type { VercelConfig, VercelApiDeployment, VercelCronJob, VercelProjectDetails, VercelDeploymentSummary } from './types.js';

const log = createChildLogger('vercel-adapter');
const BASE_URL = 'https://api.vercel.com';

export class VercelAdapter implements ProviderAdapter {
  readonly name = 'vercel';
  readonly version = '1.0.0';

  private async request(config: VercelConfig, path: string): Promise<any> {
    await rateLimiter.acquireOrWait('vercel');

    const params = config.teamId ? `${path.includes('?') ? '&' : '?'}teamId=${config.teamId}` : '';
    const url = `${BASE_URL}${path}${params}`;

    return withRetry(
      async () => {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${config.token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const body = await response.text();

          // Detect CLI session token being used instead of an API token
          if (response.status === 403 && body.includes('invalidToken')) {
            throw new Error(
              'Vercel returned 403 "invalidToken". The stored token appears to be a Vercel CLI session token, ' +
              'which cannot be used with the Vercel API. Please provide a Vercel API token instead. ' +
              'You can create one at https://vercel.com/account/tokens'
            );
          }

          throw new Error(`Vercel API error ${response.status}: ${body}`);
        }

        return response.json();
      },
      {
        maxAttempts: 3,
        retryOn: (err: unknown) => {
          const msg = String(err);
          // Do not retry on 403/invalidToken - it will never succeed with the wrong token type
          if (msg.includes('invalidToken')) return false;
          return msg.includes('429') || msg.includes('502') || msg.includes('503');
        },
      }
    );
  }

  async testConnection(config: Record<string, unknown>): Promise<ConnectionTestResult> {
    const vConfig = config as unknown as VercelConfig;
    if (!vConfig.token) {
      return { success: false, message: 'Missing required config: token' };
    }

    const start = Date.now();
    try {
      const user = await this.request(vConfig, '/v2/user');
      return {
        success: true,
        message: `Connected as ${user.user?.username || 'unknown'}`,
        latencyMs: Date.now() - start,
        metadata: {
          username: user.user?.username,
          email: user.user?.email,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message,
        latencyMs: Date.now() - start,
      };
    }
  }

  async sync(config: Record<string, unknown>, options: SyncOptions): Promise<SyncResult> {
    const vConfig = config as unknown as VercelConfig;
    const start = Date.now();
    const errors: SyncResult['errors'] = [];
    const syncedDeployments: SyncedDeployment[] = [];
    const vercelProjects: Array<{ name: string; id: string; framework: string | null; productionUrl: string | null; domains: string[] }> = [];
    let itemsSynced = 0;

    try {
      // Fetch projects and their domains (single fetch, used for both deployments and auto-discovery)
      const projectsResponse = await this.request(vConfig, '/v9/projects?limit=100');
      const projects = projectsResponse.projects || [];
      itemsSynced += projects.length;

      // Fetch production domains for each project
      const projectDomains = new Map<string, string>();
      for (const project of projects) {
        const domains = await this.getProjectDomains(vConfig, project.id);
        const customDomain = domains.find((d: string) => !d.endsWith('.vercel.app'));
        const bestDomain = customDomain || domains[0];
        if (bestDomain) {
          projectDomains.set(project.name, `https://${bestDomain}`);
        }
        // Build vercelProjects for auto-discovery
        vercelProjects.push({
          name: project.name,
          id: project.id,
          framework: project.framework || null,
          productionUrl: bestDomain ? `https://${bestDomain}` : null,
          domains,
        });
      }

      // Fetch recent deployments
      let deploymentsPath = '/v6/deployments?limit=50';
      if (options.since) {
        deploymentsPath += `&since=${new Date(options.since).getTime()}`;
      }
      const deploymentsResponse = await this.request(vConfig, deploymentsPath);
      const apiDeployments: VercelApiDeployment[] = deploymentsResponse.deployments || [];
      const deployments = apiDeployments.map(mapDeployment);
      itemsSynced += deployments.length;

      // Map Vercel deployments to synced deployment records
      for (const d of deployments) {
        syncedDeployments.push({
          externalId: d.uid,
          provider: 'vercel',
          status: vercelStateToDeploymentStatus(d.state),
          environment: d.meta?.githubCommitRef === 'main' || d.meta?.githubCommitRef === 'master' ? 'production' : 'preview',
          url: d.url ? `https://${d.url}` : undefined,
          branch: d.meta?.githubCommitRef,
          commitSha: d.meta?.githubCommitSha,
          commitMessage: d.meta?.githubCommitMessage,
          author: d.creator.username,
          startedAt: d.created ? new Date(d.created).toISOString() : undefined,
          completedAt: d.ready ? new Date(d.ready).toISOString() : undefined,
          metadata: {
            projectName: d.name,
            githubOrg: d.meta?.githubOrg,
            githubRepo: d.meta?.githubRepo,
            productionUrl: projectDomains.get(d.name),
          },
        });
      }

      log.info(
        {
          projects: projects.length,
          deployments: deployments.length,
        },
        'Vercel sync completed'
      );
    } catch (err: any) {
      const isTokenError = err.message?.includes('invalidToken');
      if (isTokenError) {
        log.warn('Vercel sync failed due to invalid token. The token may be a CLI session token instead of an API token.');
      }
      errors.push({
        item: 'vercel-sync',
        error: err.message,
        retryable: !isTokenError,
      });
    }

    return {
      success: errors.length === 0,
      itemsSynced,
      errors,
      durationMs: Date.now() - start,
      data: {
        deployments: syncedDeployments,
        vercelProjects,
      },
    };
  }

  async getProjects(config: VercelConfig) {
    const response = await this.request(config, '/v9/projects?limit=100');
    return response.projects || [];
  }

  async getDeployments(config: VercelConfig, projectId?: string, limit = 20) {
    let path = `/v6/deployments?limit=${limit}`;
    if (projectId) {
      path += `&projectId=${projectId}`;
    }
    const response = await this.request(config, path);
    return (response.deployments || []).map(mapDeployment);
  }

  /** Fetch production domains for a project. Returns custom domains first, then .vercel.app */
  async getProjectDomains(config: VercelConfig, projectId: string): Promise<string[]> {
    try {
      const response = await this.request(config, `/v9/projects/${projectId}/domains`);
      const domains: string[] = (response.domains || [])
        .filter((d: any) => !d.redirect) // skip redirect domains
        .map((d: any) => d.name as string);
      return domains;
    } catch {
      return [];
    }
  }

  /** Fetch all projects with their production domains. Returns map of projectName → URL */
  async getProjectsWithDomains(config: VercelConfig): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    try {
      const projectsResponse = await this.request(config, '/v9/projects?limit=100');
      const projects = projectsResponse.projects || [];

      for (const project of projects) {
        const domains = await this.getProjectDomains(config, project.id);
        // Prefer custom domains over .vercel.app
        const customDomain = domains.find(d => !d.endsWith('.vercel.app'));
        const bestDomain = customDomain || domains[0];
        if (bestDomain) {
          result.set(project.name, `https://${bestDomain}`);
        }
      }
    } catch (err: any) {
      log.warn({ error: err.message }, 'Failed to fetch Vercel project domains');
    }
    return result;
  }

  /** Fetch rich project details including framework, env vars, domains, recent deployments */
  async getProjectDetails(config: VercelConfig, projectId: string): Promise<VercelProjectDetails> {
    // Fetch project info
    const project = await this.request(config, `/v9/projects/${projectId}`);

    // Fetch domains
    const domains = await this.getProjectDomains(config, projectId);
    const customDomain = domains.find((d: string) => !d.endsWith('.vercel.app'));
    const productionDomain = customDomain || domains[0] || null;

    // Fetch environment variables count
    let envVarsCount = 0;
    try {
      const envResponse = await this.request(config, `/v9/projects/${projectId}/env?limit=100`);
      envVarsCount = envResponse.envs?.length || 0;
    } catch {
      // May not have permissions
    }

    // Fetch recent deployments (last 10)
    let recentDeployments: VercelDeploymentSummary[] = [];
    try {
      const depsResponse = await this.request(config, `/v6/deployments?projectId=${projectId}&limit=10`);
      recentDeployments = (depsResponse.deployments || []).map((d: any) => ({
        uid: d.uid,
        url: d.url ? `https://${d.url}` : '',
        state: d.state || d.readyState || 'UNKNOWN',
        created: d.created || d.createdAt,
        ready: d.ready || null,
        target: d.target || null,
        creator: d.creator?.username || 'unknown',
        branch: d.meta?.githubCommitRef || null,
        commitMessage: d.meta?.githubCommitMessage || null,
        commitSha: d.meta?.githubCommitSha || null,
      }));
    } catch {
      log.warn({ projectId }, 'Failed to fetch recent deployments for project details');
    }

    // Extract git repo info
    const gitLink = project.link;
    const gitRepo = gitLink ? {
      org: gitLink.org || gitLink.gitCredentialId || '',
      repo: gitLink.repo || '',
      type: gitLink.type || 'github',
    } : null;

    return {
      id: project.id,
      name: project.name,
      framework: project.framework || null,
      nodeVersion: project.nodeVersion || null,
      buildCommand: project.buildCommand || null,
      outputDirectory: project.outputDirectory || null,
      installCommand: project.installCommand || null,
      devCommand: project.devCommand || null,
      rootDirectory: project.rootDirectory || null,
      productionDomain: productionDomain ? `https://${productionDomain}` : null,
      domains,
      envVarsCount,
      analytics: {
        speedInsights: !!project.speedInsights?.id,
        webAnalytics: !!project.webAnalytics?.id,
      },
      gitRepo,
      createdAt: project.createdAt ? new Date(project.createdAt).toISOString() : '',
      updatedAt: project.updatedAt ? new Date(project.updatedAt).toISOString() : '',
      latestDeployments: recentDeployments,
    };
  }

  async getCronJobs(config: VercelConfig): Promise<VercelCronJob[]> {
    const cronJobs: VercelCronJob[] = [];

    try {
      const projectsResponse = await this.request(config, '/v9/projects?limit=100');
      const projects = projectsResponse.projects || [];

      for (const project of projects) {
        try {
          // Fetch project cron jobs via the cron monitoring API
          const cronsResponse = await this.request(config, `/v1/projects/${project.id}/crons`);
          const crons = cronsResponse.crons || [];

          for (const cron of crons) {
            cronJobs.push({
              projectId: project.id,
              projectName: project.name,
              path: cron.path || cron.url || '',
              schedule: cron.schedule || '',
              lastRunAt: cron.lastRun ? new Date(cron.lastRun).toISOString() : undefined,
              lastRunStatus: cron.lastRunStatus || undefined,
            });
          }
        } catch (err: any) {
          // Project may not have crons configured; skip silently
          log.debug({ projectId: project.id, error: err.message }, 'No cron jobs found for project');
        }
      }
    } catch (err: any) {
      log.warn({ error: err.message }, 'Failed to fetch Vercel cron jobs');
    }

    return cronJobs;
  }
}
