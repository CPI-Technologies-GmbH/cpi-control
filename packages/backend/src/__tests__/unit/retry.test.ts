import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../../shared/retry.js';

describe('withRetry', () => {
  it('should succeed on first try', async () => {
    const fn = vi.fn().mockResolvedValueOnce('success');
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and succeed', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce('third time charm');

    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 10,
      jitterFactor: 0,
    });
    expect(result).toBe('third time charm');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should throw after max retries', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockRejectedValueOnce(new Error('fail 3'));

    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10, jitterFactor: 0 })
    ).rejects.toThrow('fail 3');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should stop retrying when retryOn returns false', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('non-retryable'))
      .mockResolvedValueOnce('should not reach');

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 1,
        retryOn: (err) => {
          return !(err instanceof Error && err.message === 'non-retryable');
        },
      })
    ).rejects.toThrow('non-retryable');

    // Should only have been called once because retryOn returned false
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should use default options when none provided', async () => {
    const fn = vi.fn().mockResolvedValueOnce(42);
    const result = await withRetry(fn);
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should pass through the resolved value type', async () => {
    const fn = vi.fn().mockResolvedValueOnce({ data: [1, 2, 3] });
    const result = await withRetry(fn, { maxAttempts: 1, baseDelayMs: 1 });
    expect(result).toEqual({ data: [1, 2, 3] });
  });
});
