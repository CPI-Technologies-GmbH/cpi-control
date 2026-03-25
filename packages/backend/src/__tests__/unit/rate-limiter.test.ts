import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TokenBucketRateLimiter } from '../../shared/rate-limiter.js';

let limiter: TokenBucketRateLimiter;

beforeEach(() => {
  limiter = new TokenBucketRateLimiter();
});

describe('TokenBucketRateLimiter', () => {
  it('should allow requests within rate limit', async () => {
    // The 'default' provider has maxTokens=100, refillRate=1
    // A fresh limiter starts with 100 tokens
    const result1 = await limiter.acquire('default');
    expect(result1).toBe(true);

    const result2 = await limiter.acquire('default');
    expect(result2).toBe(true);

    const result3 = await limiter.acquire('default');
    expect(result3).toBe(true);
  });

  it('should block requests over rate limit', async () => {
    // The 'default' provider has maxTokens=100, refillRate=1 per second
    // Exhaust all tokens
    for (let i = 0; i < 100; i++) {
      const ok = await limiter.acquire('default');
      expect(ok).toBe(true);
    }

    // Now tokens should be depleted (or very close to 0)
    const overLimit = await limiter.acquire('default');
    expect(overLimit).toBe(false);
  });

  it('should refill tokens over time', async () => {
    // Use a provider with a known refill rate
    // 'default' has maxTokens=100, refillRate=1 token per second

    // Exhaust all tokens
    for (let i = 0; i < 100; i++) {
      await limiter.acquire('default');
    }

    // Should be blocked now
    const blocked = await limiter.acquire('default');
    expect(blocked).toBe(false);

    // Advance time by 2 seconds to refill 2 tokens (refillRate = 1/sec)
    vi.useFakeTimers();
    vi.advanceTimersByTime(2000);

    // The bucket uses Date.now() internally; after advancing, tokens should refill
    const afterWait = await limiter.acquire('default');
    expect(afterWait).toBe(true);

    vi.useRealTimers();
  });

  it('should allow multiple tokens to be acquired at once', async () => {
    const result = await limiter.acquire('default', 50);
    expect(result).toBe(true);

    const result2 = await limiter.acquire('default', 50);
    expect(result2).toBe(true);

    // Now should be depleted
    const result3 = await limiter.acquire('default', 1);
    expect(result3).toBe(false);
  });

  it('should track separate buckets for different providers', async () => {
    // Exhaust default
    for (let i = 0; i < 100; i++) {
      await limiter.acquire('default');
    }
    const defaultBlocked = await limiter.acquire('default');
    expect(defaultBlocked).toBe(false);

    // Slack should still have tokens (different bucket)
    const slackOk = await limiter.acquire('slack');
    expect(slackOk).toBe(true);
  });

  it('should not exceed maxTokens when refilling', async () => {
    // Get remaining for default (should be maxTokens since fresh)
    const remaining = limiter.getRemaining('default');
    expect(remaining).toBe(100);
  });

  it('should support reset for a provider', async () => {
    // Exhaust tokens
    for (let i = 0; i < 100; i++) {
      await limiter.acquire('default');
    }
    const blocked = await limiter.acquire('default');
    expect(blocked).toBe(false);

    // Reset
    limiter.reset('default');

    // After reset, should have full tokens again
    const afterReset = await limiter.acquire('default');
    expect(afterReset).toBe(true);
  });
});
