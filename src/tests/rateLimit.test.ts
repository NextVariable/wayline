import { describe, expect, it } from 'vitest';
// @ts-expect-error Server ESM exercised directly.
import { createRateLimiter, admit, callerKey } from '../../server/rate-limit.mjs';

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
  it('peek reports room without charging', () => {
    const limiter = createRateLimiter({ limit: 1 });
    expect(limiter.peek('a').allowed).toBe(true);
    expect(limiter.peek('a').allowed).toBe(true);
    limiter.take('a');
    expect(limiter.peek('a').allowed).toBe(false);
  });
  it('never turns a new caller away because the table is full', () => {
    const limiter = createRateLimiter({ limit: 5, maxKeys: 2 });
    limiter.take('a');
    limiter.take('b');
    expect(limiter.take('c').allowed).toBe(true);
    expect(limiter.size()).toBe(2);
  });
  it('lets 5000 spoofed sources fill the table without locking out a newcomer', () => {
    const limiter = createRateLimiter({ limit: 90, maxKeys: 5000 });
    for (let i = 0; i < 5000; i += 1) limiter.take(`spoof-${i}`);
    expect(limiter.take('newcomer').allowed).toBe(true);
    expect(limiter.size()).toBe(5000);
  });
  it('ignores X-Forwarded-For unless a proxy is trusted, then uses the last hop', () => {
    const request = { headers: { 'x-forwarded-for': '6.6.6.6, 7.7.7.7' }, socket: { remoteAddress: '10.0.0.1' } };
    expect(callerKey(request)).toBe('10.0.0.1');
    expect(callerKey(request, { trustProxy: true })).toBe('7.7.7.7');
    expect(callerKey({ headers: {}, socket: {} }, { trustProxy: true })).toBe('unknown');
  });
});

describe('admit', () => {
  it('refused requests do not use up the site budget, so one caller cannot lock everyone out', () => {
    const caller = createRateLimiter({ limit: 5 });
    const site = createRateLimiter({ limit: 20, maxKeys: 1 });
    const request = (who: string) => admit([[caller, who], [site, 'site']]);
    const allowedForAttacker = Array.from({ length: 200 }, () => request('attacker')).filter(r => r.allowed).length;
    expect(allowedForAttacker).toBe(5);
    expect(request('alice').allowed).toBe(true);
    expect(request('bob').allowed).toBe(true);
  });
  it('still enforces the site budget across many callers', () => {
    const caller = createRateLimiter({ limit: 5 });
    const site = createRateLimiter({ limit: 3, maxKeys: 1 });
    const outcomes = ['a', 'b', 'c', 'd'].map(who => admit([[caller, who], [site, 'site']]).allowed);
    expect(outcomes).toEqual([true, true, true, false]);
  });
  it('a request refused by one limiter is not charged to the others', () => {
    const first = createRateLimiter({ limit: 1 });
    const second = createRateLimiter({ limit: 1 });
    first.take('a');
    expect(admit([[second, 'a'], [first, 'a']]).allowed).toBe(false);
    expect(second.peek('a').allowed).toBe(true);
  });
  it('reports the refusing limiter retry time', () => {
    let t = 0;
    const slow = createRateLimiter({ limit: 1, windowMs: 30_000, now: () => t });
    slow.take('a');
    t = 10_000;
    expect(admit([[slow, 'a']]).retryAfterSeconds).toBe(20);
  });
});
