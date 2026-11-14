/**
 * Fixed-window request limiter keyed by caller, with a bounded key table.
 * The public API routes spend the operator's paid map quota, so each caller gets
 * a small budget per window and the table of tracked callers cannot grow without bound.
 *
 * Use admit() to apply several limiters to one request: it checks all of them first
 * and charges them only when every one has room, so a refused request costs nothing.
 */
export function createRateLimiter({ limit = 60, windowMs = 60_000, maxKeys = 5000, now = Date.now } = {}) {
  // Windows have equal length and start when first seen, so insertion order is also expiry order.
  const hits = new Map();
  const live = (entry, at) => entry && entry.resetAt > at;
  const refusal = (entry, at) => ({ allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - at) / 1000)) });
  return {
    /** Reports whether key has room, without charging it. */
    peek(key) {
      const at = now();
      const entry = hits.get(key);
      return live(entry, at) && entry.count >= limit ? refusal(entry, at) : { allowed: true, retryAfterSeconds: 0 };
    },
    /** Charges key once. A full table drops its oldest caller rather than turning new callers away. */
    take(key) {
      const at = now();
      let entry = hits.get(key);
      if (entry && !live(entry, at)) { hits.delete(key); entry = undefined; }
      if (!entry) {
        while (hits.size >= maxKeys) hits.delete(hits.keys().next().value);
        entry = { count: 0, resetAt: at + windowMs };
        hits.set(key, entry);
      }
      if (entry.count >= limit) return refusal(entry, at);
      entry.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
    size: () => hits.size,
  };
}

/**
 * Applies [limiter, key] pairs to one request. Returns the first refusal without charging
 * any of them, or charges all of them and returns {allowed: true}.
 */
export function admit(checks) {
  for (const [limiter, key] of checks) {
    const verdict = limiter.peek(key);
    if (!verdict.allowed) return verdict;
  }
  for (const [limiter, key] of checks) limiter.take(key);
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Picks the caller key. X-Forwarded-For is only read when the operator declares a
 * trusted proxy (TRUST_PROXY=1), and then only its last entry, which the proxy added.
 */
export function callerKey(request, { trustProxy = false } = {}) {
  if (trustProxy) {
    const forwarded = String(request.headers['x-forwarded-for'] || '').split(',').map(part => part.trim()).filter(Boolean);
    if (forwarded.length) return forwarded[forwarded.length - 1];
  }
  return request.socket?.remoteAddress || 'unknown';
}
