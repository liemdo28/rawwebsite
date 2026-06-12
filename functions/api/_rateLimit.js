/**
 * functions/api/_rateLimit.js — Rate limiting middleware for Cloudflare Workers.
 *
 * Configuration (from wrangler.toml or env):
 *   - Anonymous: 60 req/min
 *   - Authenticated: 300 req/min
 *   - Media upload: 20 req/min
 *   - Scheduler: service-token only (handled separately)
 *
 * This uses Cloudflare's built-in request limiting via KV or D1.
 * For production, configure Cloudflare Rate Limiting rules in the dashboard.
 */

const RATE_LIMITS = {
  anonymous: { requests: 60, window: 60 },
  authenticated: { requests: 300, window: 60 },
  media: { requests: 20, window: 60 },
  scheduler: { requests: 10, window: 60 },
};

/**
 * Get rate limit key based on request path and auth status.
 * @param {Request} request
 * @param {boolean} isAuthenticated
 */
export function getRateLimitKey(request, isAuthenticated) {
  const url = new URL(request.url);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const path = url.pathname;

  // Determine rate limit tier
  let tier = 'anonymous';
  if (path.includes('/api/media/upload')) {
    tier = 'media';
  } else if (path.includes('/api/scheduler')) {
    tier = 'scheduler';
  } else if (isAuthenticated) {
    tier = 'authenticated';
  }

  return {
    key: `ratelimit:${tier}:${ip}`,
    tier,
    limit: RATE_LIMITS[tier],
  };
}

/**
 * Check rate limit using KV.
 * Returns { allowed: boolean, remaining: number, reset: number }
 *
 * @param {KVNamespace} kv
 * @param {string} key
 * @param {{ requests: number, window: number }} limit
 */
export async function checkRateLimit(kv, key, limit) {
  if (!kv) {
    // No KV = no rate limiting (dev mode)
    return { allowed: true, remaining: limit.requests, reset: 0 };
  }

  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % limit.window);
  const windowKey = `${key}:${windowStart}`;

  let count = 0;
  try {
    const stored = await kv.get(windowKey);
    count = stored ? parseInt(stored, 10) : 0;
  } catch {
    // KV error = allow request
    return { allowed: true, remaining: limit.requests, reset: windowStart + limit.window };
  }

  if (count >= limit.requests) {
    return {
      allowed: false,
      remaining: 0,
      reset: windowStart + limit.window,
    };
  }

  // Increment counter
  try {
    await kv.put(windowKey, String(count + 1), {
      expirationTtl: limit.window * 2,
    });
  } catch {
    // Ignore write errors
  }

  return {
    allowed: true,
    remaining: limit.requests - count - 1,
    reset: windowStart + limit.window,
  };
}

/**
 * Build rate limit headers for response.
 */
export function rateLimitHeaders(result, limit) {
  return {
    'X-RateLimit-Limit': String(limit.requests),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.reset),
  };
}

/**
 * Rate limit error response.
 */
export function rateLimitError() {
  return new Response(JSON.stringify({
    ok: false,
    error: 'rate_limit_exceeded',
    message: 'Too many requests. Please slow down.',
  }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': '60',
    },
  });
}
