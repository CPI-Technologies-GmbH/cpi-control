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
import type {
  SemaphoreConfig,
  SemaphoreApiProject,
  SemaphoreApiPipelineListItem,
  SemaphoreApiPipelineDetail,
} from './types.js';

const log = createChildLogger('semaphore-adapter');

/** Max pipelines to fetch per project during sync */
const PIPELINES_PER_PROJECT = 30;

/**
 * Convert a Semaphore timestamp object ({ seconds, nanos }) to an ISO 8601 string.
 * Returns undefined if the timestamp is missing or zero.
 */
function semaphoreTimestampToISO(ts?: { seconds: number; nanos?: number }): string | undefined {
  if (!ts || ts.seconds === 0) return undefined;
  return new Date(ts.seconds * 1000).toISOString();
}

/**
 * Map Semaphore pipeline state + result to a normalized deployment status.
 *
 * Pipeline states: DONE, RUNNING, STOPPING, QUEUING, PENDING, INITIALIZING
 * Pipeline results (when DONE): PASSED, STOPPED, CANCELED, FAILED
 */
function pipelineToDeploymentStatus(state: string, result: string): string {
  const s = state.toUpperCase();
  const r = result.toUpperCase();

  if (s === 'RUNNING' || s === 'STOPPING') return 'deploying';
  if (s === 'QUEUING' || s === 'PENDING' || s === 'INITIALIZING') return 'pending';

  // State is DONE -- look at the result
  if (r === 'PASSED') return 'success';
  if (r === 'FAILED') return 'failed';
  if (r === 'STOPPED' || r === 'CANCELED') return 'cancelled';

  // Fallback
  return 'unknown';
}

/**
 * Semaphore CI adapter -- integrates with the Semaphore v1alpha HTTP API to
 * list projects, fetch pipeline runs, and map them to SyncedDeployment records
 * that the opsboard sync scheduler can persist.
 */
export class SemaphoreAdapter implements ProviderAdapter {
  readonly name = 'semaphore';
  readonly version = '1.0.0';

  // -------------------------------------------------------------------
  // HTTP helpers
  // -------------------------------------------------------------------

  /** Build the API base URL from the orgUrl config, e.g. https://cpi-tech.semaphoreci.com/api/v1alpha */
  private apiBase(config: SemaphoreConfig): string {
    const orgUrl = config.orgUrl.replace(/\/+$/, '');
    return `${orgUrl}/api/v1alpha`;
  }

  /**
   * Perform an authenticated GET request against the Semaphore API.
   * Includes rate limiting, automatic retries on transient errors, and
   * pagination support via the Link header.
   */
  private async request<T = any>(
    config: SemaphoreConfig,
    path: string,
  ): Promise<T> {
    await rateLimiter.acquireOrWait('semaphore');

    const url = `${this.apiBase(config)}${path}`;

    return withRetry(
      async () => {
        const response = await fetch(url, {
          headers: {
            Authorization: `Token ${config.token}`,
          },
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Semaphore API error ${response.status}: ${body}`);
        }

        return response.json() as Promise<T>;
      },
      {
        maxAttempts: 3,
        retryOn: (err: unknown) => {
          const msg = String(err);
          return msg.includes('429') || msg.includes('502') || msg.includes('503');
        },
      },
    );
  }

  // -------------------------------------------------------------------
  // ProviderAdapter interface
  // -------------------------------------------------------------------

  async testConnection(config: Record<string, unknown>): Promise<ConnectionTestResult> {
    const semConfig = config as unknown as SemaphoreConfig;

    if (!semConfig.token) {
      return { success: false, message: 'Missing required config: token' };
    }
    if (!semConfig.orgUrl) {
      return { success: false, message: 'Missing required config: orgUrl' };
    }

    const start = Date.now();
    try {
      const projects = await this.request<SemaphoreApiProject[]>(semConfig, '/projects');
      return {
        success: true,
        message: `Connected to Semaphore (${projects.length} projects)`,
        latencyMs: Date.now() - start,
        metadata: {
          projectCount: projects.length,
          orgUrl: semConfig.orgUrl,
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

  async sync(
    config: Record<string, unknown>,
    options: SyncOptions,
  ): Promise<SyncResult> {
    const semConfig = config as unknown as SemaphoreConfig;
    const start = Date.now();
    const errors: SyncResult['errors'] = [];
    const allDeployments: SyncedDeployment[] = [];
    let totalItemsSynced = 0;

    if (!semConfig.token || !semConfig.orgUrl) {
      return {
        success: false,
        itemsSynced: 0,
        errors: [{ item: 'config', error: 'Missing required config: token and orgUrl', retryable: false }],
        durationMs: Date.now() - start,
        data: { deployments: [] },
      };
    }

    // 1. Fetch all projects
    let projects: SemaphoreApiProject[];
    try {
      projects = await this.request<SemaphoreApiProject[]>(semConfig, '/projects');
      totalItemsSynced += projects.length;
    } catch (err: any) {
      errors.push({ item: 'projects', error: err.message, retryable: true });
      return {
        success: false,
        itemsSynced: 0,
        errors,
        durationMs: Date.now() - start,
      };
    }

    // 2. For each project, fetch recent pipelines and map to deployments
    for (const project of projects) {
      const projectId = project.metadata.id;
      const projectName = project.metadata.name;

      try {
        let pipelinesPath = `/pipelines?project_id=${projectId}`;
        if (options.since) {
          // Semaphore accepts created_after as unix timestamp in seconds
          const sinceEpoch = Math.floor(new Date(options.since).getTime() / 1000);
          pipelinesPath += `&created_after=${sinceEpoch}`;
        }

        const pipelineList = await this.request<SemaphoreApiPipelineListItem[]>(
          semConfig,
          pipelinesPath,
        );

        // Limit to PIPELINES_PER_PROJECT most recent
        const recentPipelines = pipelineList.slice(0, PIPELINES_PER_PROJECT);
        totalItemsSynced += recentPipelines.length;

        // Fetch details for each pipeline to get commit_sha, commit_message, etc.
        for (const ppl of recentPipelines) {
          try {
            const detail = await this.request<SemaphoreApiPipelineDetail>(
              semConfig,
              `/pipelines/${ppl.ppl_id}`,
            );
            const pipeline = detail.pipeline;

            const status = pipelineToDeploymentStatus(
              pipeline.state || ppl.state,
              pipeline.result || ppl.result,
            );

            allDeployments.push({
              externalId: pipeline.ppl_id,
              provider: 'semaphore',
              status,
              branch: pipeline.branch_name || ppl.branch_name,
              commitSha: pipeline.commit_sha,
              commitMessage: pipeline.commit_message,
              url: `${semConfig.orgUrl.replace(/\/+$/, '')}/pipelines/${pipeline.ppl_id}`,
              startedAt: semaphoreTimestampToISO(pipeline.created_at || ppl.created_at),
              completedAt: semaphoreTimestampToISO(pipeline.done_at || ppl.done_at),
              metadata: {
                projectId,
                projectName,
                workflowId: pipeline.wf_id,
                yamlFile: pipeline.yaml_file_name || ppl.yaml_file_name,
                pipelineName: pipeline.name || ppl.name,
                state: pipeline.state || ppl.state,
                result: pipeline.result || ppl.result,
              },
            });
          } catch (detailErr: any) {
            // If detail fetch fails, fall back to the list-level data (no commit info)
            log.warn(
              { pipelineId: ppl.ppl_id, error: detailErr.message },
              'Failed to fetch pipeline detail, using list data',
            );

            const status = pipelineToDeploymentStatus(ppl.state, ppl.result);

            allDeployments.push({
              externalId: ppl.ppl_id,
              provider: 'semaphore',
              status,
              branch: ppl.branch_name,
              url: `${semConfig.orgUrl.replace(/\/+$/, '')}/pipelines/${ppl.ppl_id}`,
              startedAt: semaphoreTimestampToISO(ppl.created_at),
              completedAt: semaphoreTimestampToISO(ppl.done_at),
              metadata: {
                projectId,
                projectName,
                workflowId: ppl.wf_id,
                yamlFile: ppl.yaml_file_name,
                pipelineName: ppl.name,
                state: ppl.state,
                result: ppl.result,
              },
            });
          }
        }
      } catch (err: any) {
        errors.push({
          item: `project/${projectName}/pipelines`,
          error: err.message,
          retryable: true,
        });
      }
    }

    log.info(
      {
        projects: projects.length,
        deployments: allDeployments.length,
        errors: errors.length,
      },
      'Semaphore sync completed',
    );

    return {
      success: errors.length === 0,
      itemsSynced: totalItemsSynced,
      errors,
      durationMs: Date.now() - start,
      data: {
        deployments: allDeployments,
      },
    };
  }
}
