/**
 * functions/api/system/export.js — Full export endpoint.
 *
 * GET /api/system/export — Export all content (admin only)
 */

import { loadConfig } from '../../../lib/config.js';
import { createStore } from '../../../lib/store.js';
import { exportAll } from '../../../lib/disasterRecovery.js';
import { verifyPermission } from '../../../lib/permissions.js';
import { ok, err, withCors, handleOptions } from '../../../lib/auditLog.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);
  if (request.method !== 'GET') {
    return withCors(err('method_not_allowed', 'GET only', 405));
  }

  const perm = verifyPermission(request, env, 'system.export');
  if (!perm.allowed) {
    return withCors(err(perm.error, perm.error === 'forbidden' ? 'insufficient permissions' : 'authentication required', perm.status));
  }

  const config = loadConfig(env);
  const store = createStore(env, { dataDir: config.dataDir });
  const backup = await exportAll(store, { actor: perm.actor });

  return withCors(ok(backup));
}
