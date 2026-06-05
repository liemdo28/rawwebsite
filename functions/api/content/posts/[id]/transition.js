/**
 * functions/api/content/posts/[id]/transition.js — Workflow transitions.
 *
 * POST /api/content/posts/:id/transition
 *   Body: { to: "approved" | "rejected" | "scheduled" | "publishing" | "published" | "failed" | "draft", publish_at?: string }
 *   Admin auth required.
 */

import { loadConfig } from '../../../../../lib/config.js';
import { createStore } from '../../../../../lib/store.js';
import { transitionPost, publishToDisk } from '../../../../../lib/posts.js';
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
  const to = String((parsed.data || {}).to || '');
  if (!to) return withCors(err('to_required', '"to" is required', 400));

  try {
    const patch = (parsed.data || {}).publish_at ? { publish_at: parsed.data.publish_at } : {};
    const post = await transitionPost(store, id, to, { actor, meta: patch });
    let written = null;
    if (to === 'published') {
      written = config.contentDir
        ? await publishToDisk(config.contentDir, post)
        : { ok: false, reason: 'no_content_dir' };
    }
    return withCors(ok({ post, written }));
  } catch (e) {
    const code = e.code || 'transition_failed';
    const status = code === 'not_found' ? 404 : code === 'invalid_transition' ? 409 : 400;
    return withCors(err(code, e.message, status, { from: e.from, to: e.to }));
  }
}
