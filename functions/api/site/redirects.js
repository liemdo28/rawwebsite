/**
 * functions/api/site/redirects.js — Redirects management API.
 *
 * GET    /api/site/redirects            List all redirects
 * POST   /api/site/redirects            Create a redirect (admin)
 * PATCH  /api/site/redirects?id=...     Update a redirect (admin)
 * DELETE /api/site/redirects?id=...     Delete a redirect (admin)
 * POST   /api/site/redirects/import     Bulk import from CSV (admin)
 * GET    /api/site/redirects/export     Export as CSV
 */

import { loadConfig } from '../../../lib/config.js';
import { createStore } from '../../../lib/store.js';
import {
  upsertRedirect, deleteRedirect, bulkImportCsv, exportCsv, generateNetlifyRedirects,
} from '../../../lib/redirects.js';
import {
  ok, err, readJson, verifyAdmin, withCors, handleOptions,
} from '../../../lib/auditLog.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);

  const config = loadConfig(env);
  const store = createStore(env, { dataDir: config.dataDir });
  const url = new URL(request.url);

  // Export endpoint
  if (url.pathname.endsWith('/export') && request.method === 'GET') {
    const csv = await exportCsv(store);
    return withCors(new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="redirects.csv"',
      },
    }));
  }

  // Bulk import endpoint
  if (url.pathname.endsWith('/import') && request.method === 'POST') {
    const actor = verifyAdmin(request, config.admin.secret);
    if (!actor) return withCors(err('unauthorized', 'admin Bearer token required', 401));
    const csv = await request.text();
    const result = await bulkImportCsv(store, csv, { actor });
    return withCors(ok(result));
  }

  if (request.method === 'GET') {
    const rows = await store.list('redirects');
    rows.sort((a, b) => String(a.from_path || '').localeCompare(String(b.from_path || '')));
    const netlify = await generateNetlifyRedirects(store);
    return withCors(ok({ redirects: rows, total: rows.length, netlify_format: netlify }));
  }

  const actor = verifyAdmin(request, config.admin.secret);
  if (!actor) return withCors(err('unauthorized', 'admin Bearer token required', 401));

  if (request.method === 'POST') {
    const parsed = await readJson(request);
    if (!parsed.ok) return withCors(err(parsed.error, 'bad request body', 400));
    try {
      const redirect = await upsertRedirect(store, parsed.data, { actor });
      return withCors(ok({ redirect }), 201);
    } catch (e) {
      return withCors(err('validation_failed', e.message, 400));
    }
  }

  if (request.method === 'PATCH') {
    const id = url.searchParams.get('id');
    if (!id) return withCors(err('id_required', 'id required', 400));
    const existing = await store.get('redirects', id);
    if (!existing) return withCors(err('not_found', 'redirect not found', 404));
    const parsed = await readJson(request);
    if (!parsed.ok) return withCors(err(parsed.error, 'bad request body', 400));
    try {
      const redirect = await upsertRedirect(store, { ...existing, ...parsed.data, id }, { actor });
      return withCors(ok({ redirect }));
    } catch (e) {
      return withCors(err('validation_failed', e.message, 400));
    }
  }

  if (request.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return withCors(err('id_required', 'id required', 400));
    const deleted = await deleteRedirect(store, id, { actor });
    if (!deleted) return withCors(err('not_found', 'redirect not found', 404));
    return withCors(ok({ deleted: id }));
  }

  return withCors(err('method_not_allowed', 'unsupported method', 405));
}
