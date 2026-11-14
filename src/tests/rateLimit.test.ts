import { describe, expect, it } from 'vitest';
// @ts-expect-error Server ESM exercised directly.
import { createRateLimiter, callerKey } from '../../server/rate-limit.mjs';

describe('rate limiter', () => {
  it('allows up to the limit and then refuses with a retry time', () => {
    let t = 1000;
    const limiter = createRateLimiter({ limit: 3, windowMs: 10_000, now: () => t });
    expect([1, 2, 3].map(() => limiter.take('a').allowed)).toEqual([true, true, true]);
    t += 4000;
    const refused = limiter.take('a');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(6);
  });
  it('keeps callers separate', () => {
    const limiter = createRateLimiter({ limit: 1 });
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);
    expect(limiter.take('b').allowed).toBe(true);
  });
  it('starts a new window after the old one ends', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);
    t = 1000;
    expect(limiter.take('a').allowed).toBe(true);
  });
  it('does not grow past the key cap and recovers once windows expire', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 5, windowMs: 1000, maxKeys: 2, now: () => t });
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('b').allowed).toBe(true);
    expect(limiter.take('c').allowed).toBe(false);
    expect(limiter.size()).toBe(2);
    t = 1000;
    expect(limiter.take('c').allowed).toBe(true);
  });
  it('ignores X-Forwarded-For unless a proxy is trusted, then uses the last hop', () => {
    const request = { headers: { 'x-forwarded-for': '6.6.6.6, 7.7.7.7' }, socket: { remoteAddress: '10.0.0.1' } };
    expect(callerKey(request)).toBe('10.0.0.1');
    expect(callerKey(request, { trustProxy: true })).toBe('7.7.7.7');
    expect(callerKey({ headers: {}, socket: {} }, { trustProxy: true })).toBe('unknown');
  });
});
