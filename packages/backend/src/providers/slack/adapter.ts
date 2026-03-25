import { createChildLogger } from '../../shared/logger.js';
import { rateLimiter } from '../../shared/rate-limiter.js';
import { withRetry } from '../../shared/retry.js';
import type { SlackBlock } from './templates.js';

const log = createChildLogger('slack-adapter');

export interface SlackConfig {
  webhookUrl?: string;
  botToken?: string;
  channel?: string;
}

export class SlackAdapter {
  readonly name = 'slack';
  readonly version = '1.0.0';

  async sendWebhookMessage(
    webhookUrl: string,
    text: string,
    blocks?: SlackBlock[]
  ): Promise<boolean> {
    await rateLimiter.acquireOrWait('slack');

    return withRetry(
      async () => {
        const body: Record<string, unknown> = { text };
        if (blocks && blocks.length > 0) {
          body.blocks = blocks;
        }

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const respBody = await response.text();
          throw new Error(`Slack webhook error ${response.status}: ${respBody}`);
        }

        return true;
      },
      {
        maxAttempts: 2,
        retryOn: (err: unknown) => {
          const msg = String(err);
          return msg.includes('429') || msg.includes('502') || msg.includes('503');
        },
      }
    );
  }

  async sendBotMessage(
    botToken: string,
    channel: string,
    text: string,
    blocks?: SlackBlock[]
  ): Promise<boolean> {
    await rateLimiter.acquireOrWait('slack');

    return withRetry(
      async () => {
        const body: Record<string, unknown> = {
          channel,
          text,
        };
        if (blocks && blocks.length > 0) {
          body.blocks = blocks;
        }

        const response = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${botToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const respBody = await response.text();
          throw new Error(`Slack API error ${response.status}: ${respBody}`);
        }

        const result = await response.json();
        if (!result.ok) {
          throw new Error(`Slack API error: ${result.error}`);
        }

        return true;
      },
      {
        maxAttempts: 2,
        retryOn: (err: unknown) => {
          const msg = String(err);
          return msg.includes('429') || msg.includes('502') || msg.includes('503');
        },
      }
    );
  }

  async send(config: SlackConfig, text: string, blocks?: SlackBlock[]): Promise<boolean> {
    if (config.webhookUrl) {
      return this.sendWebhookMessage(config.webhookUrl, text, blocks);
    }
    if (config.botToken && config.channel) {
      return this.sendBotMessage(config.botToken, config.channel, text, blocks);
    }
    log.error('No valid Slack configuration: need webhookUrl or botToken+channel');
    return false;
  }
}
