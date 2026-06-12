/**
 * functions/api/pages/pages.js — Page CRUD API.
 *
 * GET    /api/pages/pages           List pages (filter by ?status=)
 * GET    /api/pages/pages?id=...    Get a single page
 * POST   /api/pages/pages           Create a page (admin)
 * PATCH  /api/pages/pages?id=...    Update a page (admin)
 * DELETE /api/pages/pages?id=...    Delete a page (admin)
 */

import { loadConfig } from '../../../lib/config.js';
import { createStore } from '../../../lib/store.js';
import {
  validatePage, transitionPage, saveVersion,
} from '../../../lib/pages.js';
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

  if (request.method === 'GET') {
    const id = url.searchParams.get('id');
    if (id) {
      const page = await store.get('pages', id);
      if (!page) return withCors(err('not_found', 'page not found', 404));
      return withCors(ok({ page }));
    }
    const status = url.searchParams.get('status');
    let rows = await store.list('pages');
    if (status) rows = rows.filter(p => p.status === status);
    rows.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    return withCors(ok({ pages: rows, total: rows.length }));
  }

  const actor = verifyAdmin(request, config.admin.secret);
  if (!actor) return withCors(err('unauthorized', 'admin Bearer token required', 401));

  if (request.method === 'POST') {
    const parsed = await readJson(request);
    if (!parsed.ok) return withCors(err(parsed.error, 'bad request body', 400));
    const v = validatePage(parsed.data);
    if (!v.ok) return withCors(err('validation_failed', 'page invalid', 400, { errors: v.errors }));
    const page = await store.upsert('pages', {
      ...v.value,
      status: v.value.status || 'draft',
      created_by: actor,
    });
    await record(store, {
      actor, action: 'page.create', target_type: 'page', target_id: page.id,
    });
    return withCors(ok({ page }), 201);
  }

  if (request.method === 'PATCH') {
    const id = url.searchParams.get('id');
    if (!id) return withCors(err('id_required', 'id query param required', 400));
    const existing = await store.get('pages', id);
    if (!existing) return withCors(err('not_found', 'page not found', 404));

    // Save version before update
    await saveVersion(store, existing, { actor });

    const parsed = await readJson(request);
    if (!parsed.ok) return withCors(err(parsed.error, 'bad request body', 400));
    const merged = { ...existing, ...(parsed.data || {}), id };
    const v = validatePage(merged);
    if (!v.ok) return withCors(err('validation_failed', 'page invalid', 400, { errors: v.errors }));
    const page = await store.upsert('pages', merged);
    await record(store, {
      actor, action: 'page.update', target_type: 'page', target_id: id,
    });
    return withCors(ok({ page }));
  }

  if (request.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return withCors(err('id_required', 'id query param required', 400));
    const removed = await store.remove('pages', id);
    if (!removed) return withCors(err('not_found', 'page not found', 404));
    await record(store, {
      actor, action: 'page.delete', target_type: 'page', target_id: id,
    });
    return withCors(ok({ deleted: id }));
  }

  return withCors(err('method_not_allowed', 'unsupported method', 405));
}
