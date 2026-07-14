/**
 * functions/api/menu/categories.js — Menu category CRUD.
 *
 * GET    /api/menu/categories            List categories (?location=)
 * POST   /api/menu/categories            Create (admin)
 * PATCH  /api/menu/categories?id=...     Update (admin)
 * DELETE /api/menu/categories?id=...     Remove (admin)
 */

import { loadConfig } from '../../../lib/config.js';
import { createStore } from '../../../lib/store.js';
import { record } from '../../../lib/auditLog.js';
import {
  ok, err, readJson, verifyAdmin, withCors, handleOptions,
} from '../../../lib/auditLog.js';

function validateCategory(b) {
  const e = [];
  if (typeof b.name !== 'string' || b.name.trim().length < 1) e.push('name_required');
  if (b.location && String(b.location) !== 'raw_stockton') {
    e.push('location_invalid');
  }
  return e.length === 0 ? { ok: true, value: b } : { ok: false, errors: e };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);
  const config = loadConfig(env);
  const store = createStore(env, { dataDir: config.dataDir });
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const location = url.searchParams.get('location');
    let rows = await store.list('menu_categories');
    if (location) rows = rows.filter(r => r.location === location);
    rows.sort((a, b) => (a.sort_order || 999) - (b.sort_order || 999));
    return withCors(ok({ categories: rows, total: rows.length }));
  }

  const actor = verifyAdmin(request, config.admin.secret);
  if (!actor) return withCors(err('unauthorized', 'admin Bearer token required', 401));

  if (request.method === 'POST') {
    const parsed = await readJson(request);
    if (!parsed.ok) return withCors(err(parsed.error, 'bad request body', 400));
    const v = validateCategory(parsed.data);
    if (!v.ok) return withCors(err('validation_failed', 'category invalid', 400, { errors: v.errors }));
    const row = {
      ...v.value,
      id: v.value.id || ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'cat-' + Date.now()),
      active: v.value.active !== false,
    };
    const saved = await store.upsert('menu_categories', row);
    await record(store, {
      actor, action: 'menu.category.create', target_type: 'menu_category', target_id: saved.id,
    });
    return withCors(ok({ category: saved }), 201);
  }

  if (request.method === 'PATCH') {
    const id = url.searchParams.get('id');
    if (!id) return withCors(err('id_required', 'id required', 400));
    const existing = await store.get('menu_categories', id);
    if (!existing) return withCors(err('not_found', 'category not found', 404));
    const parsed = await readJson(request);
    if (!parsed.ok) return withCors(err(parsed.error, 'bad request body', 400));
    const merged = { ...existing, ...(parsed.data || {}), id };
    const v = validateCategory(merged);
    if (!v.ok) return withCors(err('validation_failed', 'category invalid', 400, { errors: v.errors }));
    const saved = await store.upsert('menu_categories', merged);
    await record(store, {
      actor, action: 'menu.category.update', target_type: 'menu_category', target_id: id,
    });
    return withCors(ok({ category: saved }));
  }

  if (request.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return withCors(err('id_required', 'id required', 400));
    const removed = await store.remove('menu_categories', id);
    if (!removed) return withCors(err('not_found', 'category not found', 404));
    await record(store, {
      actor, action: 'menu.category.delete', target_type: 'menu_category', target_id: id,
    });
    return withCors(ok({ deleted: id }));
  }

  return withCors(err('method_not_allowed', 'unsupported method', 405));
}
