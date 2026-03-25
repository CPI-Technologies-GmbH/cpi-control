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
import { mapCommit, mapWorkflowRun, workflowRunToDeploymentStatus } from './mapper.js';
import type { GitHubApiCommit, GitHubApiWorkflowRun, GitHubApiRepo, GitHubConfig } from './types.js';

const log = createChildLogger('github-adapter');

export class GitHubAdapter implements ProviderAdapter {
  readonly name = 'github';
  readonly version = '1.0.0';

  private async request(
    config: GitHubConfig,
    path: string,
    options: RequestInit = {}
  ): Promise<any> {
    await rateLimiter.acquireOrWait('github');

    const baseUrl = config.baseUrl || 'https://api.github.com';
    const url = `${baseUrl}${path}`;

    return withRetry(
      async () => {
        const response = await fetch(url, {
          ...options,
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${config.token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            ...options.headers,
          },
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`GitHub API error ${response.status}: ${body}`);
        }

        return response.json();
      },
      {
        maxAttempts: 3,
        retryOn: (err: unknown) => {
          const msg = String(err);
          return msg.includes('429') || msg.includes('502') || msg.includes('503');
        },
      }
    );
  }

  async testConnection(config: Record<string, unknown>): Promise<ConnectionTestResult> {
    const ghConfig = config as unknown as GitHubConfig;
    if (!ghConfig.token) {
      return {
        success: false,
        message: 'Missing required config: token',
      };
    }

    const start = Date.now();
    try {
      if (ghConfig.owner && ghConfig.repo) {
        // Specific repo mode
        const repo = await this.request(
          ghConfig,
          `/repos/${ghConfig.owner}/${ghConfig.repo}`
        );

        return {
          success: true,
          message: `Connected to ${repo.full_name}`,
          latencyMs: Date.now() - start,
          metadata: {
            repoId: repo.id,
            defaultBranch: repo.default_branch,
            private: repo.private,
          },
        };
      } else {
        // User-level mode: verify token by fetching the authenticated user
        const user = await this.request(ghConfig, '/user');
        return {
          success: true,
          message: `Connected as ${user.login} (will sync recent repos)`,
          latencyMs: Date.now() - start,
          metadata: {
            login: user.login,
            mode: 'all-repos',
          },
        };
      }
    } catch (err: any) {
      return {
        success: false,
        message: err.message,
        latencyMs: Date.now() - start,
      };
    }
  }

  /** Sync a single repo's commits and workflow runs */
  private async syncRepo(
    ghConfig: GitHubConfig,
    owner: string,
    repo: string,
    options: SyncOptions
  ): Promise<{ itemsSynced: number; errors: SyncResult['errors']; deployments: SyncedDeployment[] }> {
    const errors: SyncResult['errors'] = [];
    const deployments: SyncedDeployment[] = [];
    let itemsSynced = 0;

    try {
      // Fetch recent commits
      const commitsPath = `/repos/${owner}/${repo}/commits?per_page=30${options.since ? `&since=${options.since}` : ''}`;
      const apiCommits: GitHubApiCommit[] = await this.request(ghConfig, commitsPath);
      const commits = apiCommits.map(mapCommit);
      itemsSynced += commits.length;
    } catch (err: any) {
      // Commits may fail on empty repos - continue to workflow runs
      errors.push({
        item: `${owner}/${repo}/commits`,
        error: err.message,
        retryable: true,
      });
    }

    try {
      // Fetch workflow runs
      const runsPath = `/repos/${owner}/${repo}/actions/runs?per_page=30${options.since ? `&created=>${options.since}` : ''}`;
      const runsResponse = await this.request(ghConfig, runsPath);
      const apiRuns: GitHubApiWorkflowRun[] = runsResponse.workflow_runs || [];
      const runs = apiRuns.map(mapWorkflowRun);
      itemsSynced += runs.length;

      // Map workflow runs to deployment records
      for (const run of runs) {
        deployments.push({
          externalId: String(run.id),
          provider: 'github_actions',
          status: workflowRunToDeploymentStatus(run.conclusion, run.status),
          branch: run.headBranch,
          commitSha: run.headSha,
          commitMessage: run.name,
          author: run.actor.login,
          url: run.htmlUrl,
          startedAt: run.runStartedAt || run.createdAt,
          completedAt: run.updatedAt,
          metadata: { workflowName: run.name, runNumber: run.id, repo: `${owner}/${repo}` },
        });
      }
    } catch (err: any) {
      errors.push({
        item: `${owner}/${repo}/actions`,
        error: err.message,
        retryable: true,
      });
    }

    return { itemsSynced, errors, deployments };
  }

  async sync(
    config: Record<string, unknown>,
    options: SyncOptions
  ): Promise<SyncResult> {
    const ghConfig = config as unknown as GitHubConfig;
    const start = Date.now();
    const allErrors: SyncResult['errors'] = [];
    const allDeployments: SyncedDeployment[] = [];
    let totalItemsSynced = 0;

    if (ghConfig.owner && ghConfig.repo) {
      // Specific repo mode (existing behavior)
      const { itemsSynced, errors, deployments } = await this.syncRepo(ghConfig, ghConfig.owner, ghConfig.repo, options);
      totalItemsSynced += itemsSynced;
      allErrors.push(...errors);
      allDeployments.push(...deployments);

      log.info(
        { owner: ghConfig.owner, repo: ghConfig.repo, itemsSynced, deployments: deployments.length },
        'GitHub sync completed (single repo)'
      );
    } else {
      // User-level mode: list recently updated repos and sync each
      try {
        const repos: GitHubApiRepo[] = await this.request(
          ghConfig,
          '/user/repos?sort=updated&per_page=30'
        );

        for (const repo of repos) {
          const { itemsSynced, errors, deployments } = await this.syncRepo(
            ghConfig,
            repo.owner.login,
            repo.name,
            options
          );
          totalItemsSynced += itemsSynced;
          allErrors.push(...errors);
          allDeployments.push(...deployments);
        }

        log.info(
          { repoCount: repos.length, totalItemsSynced, deployments: allDeployments.length },
          'GitHub sync completed (all user repos)'
        );
      } catch (err: any) {
        allErrors.push({
          item: 'user/repos',
          error: err.message,
          retryable: true,
        });
      }
    }

    return {
      success: allErrors.length === 0,
      itemsSynced: totalItemsSynced,
      errors: allErrors,
      durationMs: Date.now() - start,
      data: {
        deployments: allDeployments,
      },
    };
  }

  async getCommits(config: GitHubConfig, perPage = 30): Promise<ReturnType<typeof mapCommit>[]> {
    const apiCommits: GitHubApiCommit[] = await this.request(
      config,
      `/repos/${config.owner}/${config.repo}/commits?per_page=${perPage}`
    );
    return apiCommits.map(mapCommit);
  }

  async getWorkflowRuns(
    config: GitHubConfig,
    perPage = 30
  ): Promise<ReturnType<typeof mapWorkflowRun>[]> {
    const response = await this.request(
      config,
      `/repos/${config.owner}/${config.repo}/actions/runs?per_page=${perPage}`
    );
    const apiRuns: GitHubApiWorkflowRun[] = response.workflow_runs || [];
    return apiRuns.map(mapWorkflowRun);
  }
}
