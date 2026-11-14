/**
 * Fixed-window request limiter keyed by caller, with a bounded key table.
 * The public API routes spend the operator's paid map quota, so each caller gets
 * a small budget per window and a hard cap on how many callers are tracked.
 */
export function createRateLimiter({ limit = 60, windowMs = 60_000, maxKeys = 5000, now = Date.now } = {}) {
  const hits = new Map();
  const sweep = at => {
    for (const [key, entry] of hits) if (entry.resetAt <= at) hits.delete(key);
  };
  return {
    /** Returns {allowed, retryAfterSeconds}. A full table rejects new callers instead of growing. */
    take(key) {
      const at = now();
      let entry = hits.get(key);
      if (entry && entry.resetAt <= at) { hits.delete(key); entry = undefined; }
      if (!entry) {
        if (hits.size >= maxKeys) {
          sweep(at);
          if (hits.size >= maxKeys) return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
        }
        entry = { count: 0, resetAt: at + windowMs };
        hits.set(key, entry);
      }
      if (entry.count >= limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - at) / 1000)) };
      entry.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
    size: () => hits.size,
  };
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
