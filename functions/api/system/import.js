/**
 * functions/api/system/import.js — Import/restore endpoint.
 *
 * POST /api/system/import — Import from backup (admin only)
 * Body: { ...backup data, mode?: 'replace'|'merge' }
 */

import { loadConfig } from '../../../lib/config.js';
import { createStore } from '../../../lib/store.js';
import { importAll } from '../../../lib/disasterRecovery.js';
import { verifyPermission } from '../../../lib/permissions.js';
import { ok, err, readJson, withCors, handleOptions } from '../../../lib/auditLog.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);
  if (request.method !== 'POST') {
    return withCors(err('method_not_allowed', 'POST only', 405));
  }

  const perm = verifyPermission(request, env, 'system.import');
  if (!perm.allowed) {
    return withCors(err(perm.error, perm.error === 'forbidden' ? 'insufficient permissions' : 'authentication required', perm.status));
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return withCors(err(parsed.error, 'bad request body', 400));

  const config = loadConfig(env);
  const store = createStore(env, { dataDir: config.dataDir });
  const result = await importAll(store, parsed.data, {
    actor: perm.actor,
    mode: parsed.data.mode || 'replace',
  });

  if (result.errors.length > 0) {
    return withCors(ok({ ...result, warning: 'some_errors_occurred' }));
  }

  return withCors(ok(result));
}
