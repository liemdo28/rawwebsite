/**
 * functions/api/menu/items.js — Menu item CRUD.
 *
 * GET    /api/menu/items            List items (filter by ?location=)
 * POST   /api/menu/items            Create an item (admin)
 * PATCH  /api/menu/items?id=...     Update an item (admin)
 * DELETE /api/menu/items?id=...     Remove an item (admin)
 */

import { loadConfig } from '../../../lib/config.js';
import { createStore } from '../../../lib/store.js';
import { record } from '../../../lib/auditLog.js';
import {
  ok, err, readJson, verifyAdmin, withCors, handleOptions,
} from '../../../lib/auditLog.js';

function validateItem(b) {
  const e = [];
  if (typeof b.name !== 'string' || b.name.trim().length < 1) e.push('name_required');
  if (b.location && !['raw_stockton', 'raw_modesto'].includes(String(b.location))) {
    e.push('location_invalid');
  }
  if (b.price !== undefined && b.price !== null && (typeof b.price !== 'number' || b.price < 0)) {
    e.push('price_invalid');
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
    let rows = await store.list('menu_items');
    if (location) rows = rows.filter(r => r.location === location);
    rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return withCors(ok({ items: rows, total: rows.length }));
  }

  const actor = verifyAdmin(request, config.admin.secret);
  if (!actor) return withCors(err('unauthorized', 'admin Bearer token required', 401));

  if (request.method === 'POST') {
    const parsed = await readJson(request);
    if (!parsed.ok) return withCors(err(parsed.error, 'bad request body', 400));
    const v = validateItem(parsed.data);
    if (!v.ok) return withCors(err('validation_failed', 'menu item invalid', 400, { errors: v.errors }));
    const row = {
      ...v.value,
      id: v.value.id || ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'menu-' + Date.now()),
      active: v.value.active !== false,
    };
    const saved = await store.upsert('menu_items', row);
    await record(store, {
      actor, action: 'menu.item.create', target_type: 'menu_item', target_id: saved.id,
    });
    return withCors(ok({ item: saved }), 201);
  }

  if (request.method === 'PATCH') {
    const id = url.searchParams.get('id');
    if (!id) return withCors(err('id_required', 'id required', 400));
    const existing = await store.get('menu_items', id);
    if (!existing) return withCors(err('not_found', 'menu item not found', 404));
    const parsed = await readJson(request);
    if (!parsed.ok) return withCors(err(parsed.error, 'bad request body', 400));
    const merged = { ...existing, ...(parsed.data || {}), id };
    const v = validateItem(merged);
    if (!v.ok) return withCors(err('validation_failed', 'menu item invalid', 400, { errors: v.errors }));
    const saved = await store.upsert('menu_items', merged);
    await record(store, {
      actor, action: 'menu.item.update', target_type: 'menu_item', target_id: id,
    });
    return withCors(ok({ item: saved }));
  }

  if (request.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return withCors(err('id_required', 'id required', 400));
    const removed = await store.remove('menu_items', id);
    if (!removed) return withCors(err('not_found', 'menu item not found', 404));
    await record(store, {
      actor, action: 'menu.item.delete', target_type: 'menu_item', target_id: id,
    });
    return withCors(ok({ deleted: id }));
  }

  return withCors(err('method_not_allowed', 'unsupported method', 405));
}
