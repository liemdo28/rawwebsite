/**
 * functions/api/menu/items/[id].js — Path-param CRUD for menu items.
 * Mirrors /api/menu/items.js.
 */

import { loadConfig } from '../../../../lib/config.js';
import { createStore } from '../../../../lib/store.js';
import { record } from '../../../../lib/auditLog.js';
import {
  ok, err, readJson, verifyAdmin, withCors, handleOptions,
} from '../../../../lib/auditLog.js';

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
  const { request, env, params } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);
  const config = loadConfig(env);
  const store = createStore(env, { dataDir: config.dataDir });
  const id = params.id;

  if (request.method === 'GET') {
    const item = await store.get('menu_items', id);
    if (!item) return withCors(err('not_found', 'menu item not found', 404));
    return withCors(ok({ item }));
  }

  const actor = verifyAdmin(request, config.admin.secret);
  if (!actor) return withCors(err('unauthorized', 'admin Bearer token required', 401));

  if (request.method === 'PATCH') {
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
    const removed = await store.remove('menu_items', id);
    if (!removed) return withCors(err('not_found', 'menu item not found', 404));
    await record(store, {
      actor, action: 'menu.item.delete', target_type: 'menu_item', target_id: id,
    });
    return withCors(ok({ deleted: id }));
  }

  return withCors(err('method_not_allowed', 'unsupported method', 405));
}
