export interface RateLimiterConfig {
  maxTokens: number;
  refillRate: number; // tokens per second
}

const PROVIDER_LIMITS: Record<string, RateLimiterConfig> = {
  github: { maxTokens: 5000, refillRate: 5000 / 3600 }, // 5000/hour
  vercel: { maxTokens: 100, refillRate: 100 / 60 }, // 100/min
  digitalocean: { maxTokens: 5000, refillRate: 5000 / 3600 }, // 5000/hour
  kubernetes: { maxTokens: 1000, refillRate: 1000 / 60 }, // 1000/min
  semaphore: { maxTokens: 500, refillRate: 500 / 3600 }, // 500/hour (conservative)
  slack: { maxTokens: 60, refillRate: 1 }, // 1/sec
  default: { maxTokens: 100, refillRate: 1 },
};

export class TokenBucketRateLimiter {
  private buckets = new Map<
    string,
    { tokens: number; lastRefill: number; config: RateLimiterConfig }
  >();

  getConfig(provider: string): RateLimiterConfig {
    return PROVIDER_LIMITS[provider] || PROVIDER_LIMITS.default;
  }

  async acquire(provider: string, tokens = 1): Promise<boolean> {
    const config = this.getConfig(provider);
    let bucket = this.buckets.get(provider);

    if (!bucket) {
      bucket = { tokens: config.maxTokens, lastRefill: Date.now(), config };
      this.buckets.set(provider, bucket);
    }

    // Refill tokens based on elapsed time
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(config.maxTokens, bucket.tokens + elapsed * config.refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      return true;
    }

    return false;
  }

  async acquireOrWait(provider: string, tokens = 1, maxWaitMs = 30000): Promise<boolean> {
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      if (await this.acquire(provider, tokens)) {
        return true;
      }
      // Wait a bit before retrying
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return false;
  }

  getRemaining(provider: string): number {
    const bucket = this.buckets.get(provider);
    if (!bucket) {
      return this.getConfig(provider).maxTokens;
    }

    const elapsed = (Date.now() - bucket.lastRefill) / 1000;
    return Math.min(
      bucket.config.maxTokens,
      bucket.tokens + elapsed * bucket.config.refillRate
    );
  }

  reset(provider: string): void {
    this.buckets.delete(provider);
  }
}

// Singleton instance
export const rateLimiter = new TokenBucketRateLimiter();
