import type {
  ProviderAdapter,
  ConnectionTestResult,
  SyncOptions,
  SyncResult,
} from '../../shared/provider-interface.js';
import { rateLimiter } from '../../shared/rate-limiter.js';
import { withRetry } from '../../shared/retry.js';
import { createChildLogger } from '../../shared/logger.js';
import { mapDroplet } from './mapper.js';
import type { DOConfig } from './types.js';

const log = createChildLogger('digitalocean-adapter');
const BASE_URL = 'https://api.digitalocean.com/v2';

export class DigitalOceanAdapter implements ProviderAdapter {
  readonly name = 'digitalocean';
  readonly version = '1.0.0';

  private async request(config: DOConfig, path: string): Promise<any> {
    await rateLimiter.acquireOrWait('digitalocean');

    const url = `${BASE_URL}${path}`;

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
          throw new Error(`DigitalOcean API error ${response.status}: ${body}`);
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
    const doConfig = config as unknown as DOConfig;
    if (!doConfig.token) {
      return { success: false, message: 'Missing required config: token' };
    }

    const start = Date.now();
    try {
      const account = await this.request(doConfig, '/account');
      return {
        success: true,
        message: `Connected as ${account.account?.email || 'unknown'}`,
        latencyMs: Date.now() - start,
        metadata: {
          email: account.account?.email,
          dropletLimit: account.account?.droplet_limit,
          status: account.account?.status,
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
    const doConfig = config as unknown as DOConfig;
    const start = Date.now();
    const errors: SyncResult['errors'] = [];
    let itemsSynced = 0;

    try {
      // Fetch droplets
      const dropletsResponse = await this.request(doConfig, '/droplets?per_page=200');
      const droplets = (dropletsResponse.droplets || []).map(mapDroplet);
      itemsSynced += droplets.length;

      log.info({ droplets: droplets.length }, 'DigitalOcean sync completed');
    } catch (err: any) {
      errors.push({
        item: 'droplets',
        error: err.message,
        retryable: true,
      });
    }

    return {
      success: errors.length === 0,
      itemsSynced,
      errors,
      durationMs: Date.now() - start,
    };
  }

  async getDroplets(config: DOConfig) {
    const response = await this.request(config, '/droplets?per_page=200');
    return (response.droplets || []).map(mapDroplet);
  }

  async getDroplet(config: DOConfig, dropletId: number) {
    const response = await this.request(config, `/droplets/${dropletId}`);
    return response.droplet ? mapDroplet(response.droplet) : null;
  }

  async getDropletMetrics(config: DOConfig, dropletId: number, metric: string) {
    const end = new Date().toISOString();
    const start = new Date(Date.now() - 3600 * 1000).toISOString();
    const response = await this.request(
      config,
      `/monitoring/metrics/droplet/${metric}?host_id=${dropletId}&start=${start}&end=${end}`
    );
    return response;
  }
}
