import { createChildLogger } from './logger.js';

const log = createChildLogger('retry');

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterFactor?: number;
  retryOn?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.5,
  retryOn: () => true,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === opts.maxAttempts) {
        log.error({ attempt, error: String(error) }, 'All retry attempts exhausted');
        break;
      }

      if (!opts.retryOn(error)) {
        log.warn({ attempt, error: String(error) }, 'Error is not retryable');
        break;
      }

      // Exponential backoff with jitter
      const exponentialDelay = opts.baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = exponentialDelay * opts.jitterFactor * Math.random();
      const delay = Math.min(exponentialDelay + jitter, opts.maxDelayMs);

      log.warn({ attempt, delay, error: String(error) }, 'Retrying after delay');
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
