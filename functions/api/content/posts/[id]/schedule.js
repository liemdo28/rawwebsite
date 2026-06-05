/**
 * functions/api/content/posts/[id]/schedule.js — Schedule a post.
 *
 * POST /api/content/posts/:id/schedule
 *   Body: { publish_at: "2026-06-15T18:00:00Z" }
 *   Admin auth required.
 *
 * Side effects:
 *   - Sets the post's `publish_at` field.
 *   - Transitions the post to `scheduled` status.
 *   - Records an audit_log entry.
 */

import { loadConfig } from '../../../../../lib/config.js';
import { createStore } from '../../../../../lib/store.js';
import { transitionPost } from '../../../../../lib/posts.js';
import {
  ok, err, readJson, verifyAdmin, withCors, handleOptions,
} from '../../../../../lib/auditLog.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);
  if (request.method !== 'POST') {
    return withCors(err('method_not_allowed', 'POST only', 405));
  }
  const config = loadConfig(env);
  const store = createStore(env, { dataDir: config.dataDir });
  const actor = verifyAdmin(request, config.admin.secret);
  if (!actor) return withCors(err('unauthorized', 'admin Bearer token required', 401));

  const id = params.id;
  const parsed = await readJson(request);
  if (!parsed.ok) return withCors(err(parsed.error, 'bad request body', 400));
  const publishAt = (parsed.data || {}).publish_at;
  if (!publishAt || Number.isNaN(Date.parse(String(publishAt)))) {
    return withCors(err('publish_at_invalid', 'publish_at must be ISO-8601', 400));
  }

  // Save publish_at, then transition to scheduled.
  const existing = await store.get('posts', id);
  if (!existing) return withCors(err('not_found', 'post not found', 404));
  await store.upsert('posts', { ...existing, publish_at: publishAt });

  try {
    const post = await transitionPost(store, id, 'scheduled', { actor });
    return withCors(ok({ post }));
  } catch (e) {
    const code = e.code || 'transition_failed';
    const status = code === 'not_found' ? 404 : code === 'invalid_transition' ? 409 : 400;
    return withCors(err(code, e.message, status, { from: e.from, to: e.to }));
  }
}
