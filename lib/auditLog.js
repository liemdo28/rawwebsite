/**
 * lib/auditLog.js — Append-only audit log + JSON response helpers.
 *
 * Every state-changing operation (create, update, delete, approve, schedule,
 * publish, upload, sync) is recorded so we can answer:
 *   - "Who created this post?"
 *   - "When was the menu last edited?"
 *   - "Did the Agent-coding webhook succeed last night?"
 *
 * Also contains small response helpers used by every API endpoint so the
 * wiring in functions/api/** is short and consistent.
 */

/**
 * @typedef {{
 *   list: (table: string) => Promise<unknown[]>,
 *   upsert: (table: string, row: Record<string, unknown>) => Promise<Record<string, unknown>>,
 * }} Store
 */

/**
 * Append a new audit log entry. Returns the saved row.
 * @param {Store} store
 * @param {{
 *   actor?: string,
 *   action: string,
 *   target_type: string,
 *   target_id?: string,
 *   meta?: Record<string, unknown>,
 * }} entry
 */
export async function record(store, entry) {
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'audit-' + Date.now();
  const row = {
    id,
    actor: entry.actor || 'system',
    action: entry.action,
    target_type: entry.target_type,
    target_id: entry.target_id || null,
    meta: entry.meta || {},
    created_at: new Date().toISOString(),
  };
  await store.upsert('audit_log', row);
  return row;
}

/**
 * Read the most recent N audit entries (newest first).
 * @param {Store} store
 * @param {number} [limit]
 */
export async function recent(store, limit = 50) {
  const rows = await store.list('audit_log');
  rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return rows.slice(0, limit);
}

/**
 * Verify the admin Bearer token. Returns the actor label on success, null on failure.
 * @param {Request} request
 * @param {string} expected
 * @returns {string|null}
 */
export function verifyAdmin(request, expected) {
  if (!expected) return null;
  const auth = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  if (!timingSafeStringEqual(token, expected)) return null;
  return 'admin';
}

function timingSafeStringEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Build a JSON Response with a few safe defaults.
 * @param {unknown} body
 * @param {number} [status]
 * @param {Record<string, string>} [headers]
 */
export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

/**
 * Standard error response.
 * @param {string} code
 * @param {string} message
 * @param {number} [status]
 * @param {Record<string, unknown>} [extra]
 */
export function err(code, message, status = 400, extra = {}) {
  return json({ ok: false, error: code, message, ...extra }, status);
}

/**
 * Standard success response.
 * @param {Record<string, unknown>} payload
 */
export function ok(payload) {
  return json({ ok: true, ...payload });
}

/**
 * Read a JSON body from a request. Returns { ok: true, data } or { ok: false, error }.
 * @param {Request} request
 */
export async function readJson(request) {
  const ct = request.headers.get('content-type') || '';
  if (!ct.toLowerCase().includes('application/json')) {
    return { ok: false, error: 'expected_application_json' };
  }
  let raw;
  try {
    raw = await request.text();
  } catch (e) {
    return { ok: false, error: 'cannot_read_body' };
  }
  try {
    return { ok: true, data: JSON.parse(raw), raw };
  } catch (e) {
    return { ok: false, error: 'invalid_json', raw };
  }
}

/**
 * Add CORS headers to a Response. Used by the API endpoints so the admin SPA
 * can call them from the same origin (and so external services can be
 * explicitly allowed via ALLOWED_ORIGIN).
 * @param {Response} res
 * @param {string} [origin]
 */
export function withCors(res, origin = '*') {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', origin);
  h.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Agent-Coding-Signature');
  h.set('Access-Control-Max-Age', '600');
  return new Response(res.body, { status: res.status, headers: h });
}

/**
 * Handle a CORS preflight request.
 * @param {Request} request
 */
export function handleOptions(request) {
  const origin = request.headers.get('origin') || '*';
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Agent-Coding-Signature',
      'Access-Control-Max-Age': '600',
    },
  });
}
