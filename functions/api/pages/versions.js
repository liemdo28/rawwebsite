/**
 * functions/api/pages/versions.js — Page version history + rollback API.
 *
 * GET    /api/pages/versions?page_id=...   List versions for a page
 * POST   /api/pages/versions?page_id=...&version_id=...   Rollback to a version
 */

import { loadConfig } from '../../../lib/config.js';
import { createStore } from '../../../lib/store.js';
import { listPageVersions, rollbackPage } from '../../../lib/pages.js';
import { record } from '../../../lib/auditLog.js';
import {
  ok, err, readJson, verifyAdmin, withCors, handleOptions,
} from '../../../lib/auditLog.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);

  const config = loadConfig(env);
  const store = createStore(env, { dataDir: config.dataDir });
  const url = new URL(request.url);
  const pageId = url.searchParams.get('page_id');

  if (!pageId) return withCors(err('page_id_required', 'page_id query param required', 400));

  if (request.method === 'GET') {
    const versions = await listPageVersions(store, pageId);
    return withCors(ok({ versions, total: versions.length }));
  }

  const actor = verifyAdmin(request, config.admin.secret);
  if (!actor) return withCors(err('unauthorized', 'admin Bearer token required', 401));

  if (request.method === 'POST') {
    const versionId = url.searchParams.get('version_id');
    if (!versionId) return withCors(err('version_id_required', 'version_id required', 400));
    try {
      const page = await rollbackPage(store, pageId, versionId, { actor });
      return withCors(ok({ page, rolled_back_to: versionId }));
    } catch (e) {
      if (e.code === 'not_found') return withCors(err('not_found', 'page not found', 404));
      if (e.code === 'version_not_found') return withCors(err('version_not_found', 'version not found', 404));
      throw e;
    }
  }

  return withCors(err('method_not_allowed', 'GET or POST only', 405));
}
