/**
 * lib/config.js — Environment + path configuration for the Agent-coding bridge.
 *
 * This module is intentionally framework-agnostic so it can be loaded from:
 *   - Cloudflare Pages Functions (functions/api/**)
 *   - Node CLI scripts (scripts/**)
 *   - Tests (tests/**)
 *
 * Cloudflare Pages exposes:
 *   - `context.env` (production / preview bindings)
 *   - `process.env` (in local dev with wrangler)
 * We read both so the same code path works in every environment.
 *
 * Worker-compatibility: This module avoids static `import` of node:path and
 * node:url. It uses simple string concatenation for paths so it can be
 * bundled by Cloudflare Workers. Node.js scripts that need real filesystem
 * paths use the helper `nodePaths` (lazy-imported) for the few cases that
 * require them.
 */

/**
 * Read a secret from either a Cloudflare env binding or process.env.
 *
 * @param {Record<string, unknown> | undefined} env  Cloudflare env object.
 * @param {string} key  Environment variable name.
 * @returns {string|undefined}
 */
export function readSecret(env, key) {
  if (env && typeof env[key] === 'string' && env[key].length > 0) {
    return env[key];
  }
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  return undefined;
}

/**
 * Build a normalized config object. Falls back to safe defaults for local dev.
 *
 * @param {Record<string, unknown>} [env]  Cloudflare env bindings.
 */
export function loadConfig(env = {}) {
  const dataDir = readSecret(env, 'RAWWEBSITE_DATA_DIR') || './data';
  return {
    // String-only path hints (safe in any runtime)
    root: '.',
    publicDir: './public',
    contentDir: './content',
    contentPostsDir: './content/posts',
    dataDir,

    // Agent-coding bridge
    agentCoding: {
      apiBaseUrl: readSecret(env, 'AGENT_CODING_API_BASE_URL') || '',
      apiKey: readSecret(env, 'AGENT_CODING_API_KEY') || '',
      webhookSecret:
        readSecret(env, 'AGENT_CODING_WEBHOOK_SECRET') || 'dev-webhook-secret',
    },

    // Admin CMS auth
    admin: {
      secret:
        readSecret(env, 'RAWWEBSITE_ADMIN_SECRET') || 'dev-admin-secret',
    },

    // Content policy (lazy-loaded by lib/contentPolicy.js)
    policyPath: './config/content_policy.json',

    // Upload limits
    uploads: {
      maxImageBytes: 5 * 1024 * 1024, // 5 MB
      allowedImageTypes: new Set([
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'image/svg+xml',
      ]),
      mediaDir: './public/media',
    },

    // Cloudflare KV / R2 hint names (informational)
    cloudflare: {
      kvNamespace: 'RAWWEBSITE_KV',
      r2Bucket: 'MEDIA_BUCKET',
    },
  };
}

/**
 * Compare two strings in constant time to prevent timing attacks.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
