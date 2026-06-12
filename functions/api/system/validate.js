/**
 * functions/api/system/validate.js — Validate backup integrity.
 *
 * POST /api/system/validate — Validate backup against current store (admin only)
 * Body: { ...backup data }
 */

import { loadConfig } from '../../../lib/config.js';
import { createStore } from '../../../lib/store.js';
import { validateIntegrity } from '../../../lib/disasterRecovery.js';
import { verifyPermission } from '../../../lib/permissions.js';
import { ok, err, readJson, withCors, handleOptions } from '../../../lib/auditLog.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);
  if (request.method !== 'POST') {
    return withCors(err('method_not_allowed', 'POST only', 405));
  }

  const perm = verifyPermission(request, env, 'system.export');
  if (!perm.allowed) {
    return withCors(err(perm.error, perm.error === 'forbidden' ? 'insufficient permissions' : 'authentication required', perm.status));
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return withCors(err(parsed.error, 'bad request body', 400));

  const config = loadConfig(env);
  const store = createStore(env, { dataDir: config.dataDir });
  const result = await validateIntegrity(store, parsed.data);

  return withCors(ok(result));
}
