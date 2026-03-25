import type {
  ProviderAdapter,
  ConnectionTestResult,
  SyncOptions,
  SyncResult,
} from '../../shared/provider-interface.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('bitbucket-adapter');

/**
 * Bitbucket adapter - Phase 2 stub
 * Will implement Bitbucket Cloud/Server API integration for:
 * - Repository browsing
 * - Commit history
 * - Pull request status
 * - Pipeline/build status
 */
export class BitbucketAdapter implements ProviderAdapter {
  readonly name = 'bitbucket';
  readonly version = '0.1.0-stub';

  async testConnection(config: Record<string, unknown>): Promise<ConnectionTestResult> {
    return {
      success: false,
      message: 'Bitbucket integration is planned for Phase 2. Not yet implemented.',
    };
  }

  async sync(config: Record<string, unknown>, options: SyncOptions): Promise<SyncResult> {
    log.info('Bitbucket sync called - Phase 2 stub');
    return {
      success: false,
      itemsSynced: 0,
      errors: [
        {
          item: 'bitbucket',
          error: 'Bitbucket integration is planned for Phase 2.',
          retryable: false,
        },
      ],
      durationMs: 0,
    };
  }
}
