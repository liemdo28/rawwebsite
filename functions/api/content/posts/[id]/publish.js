/**
 * functions/api/content/posts/[id]/publish.js — Publish a post.
 *
 * POST /api/content/posts/:id/publish
 *   Admin auth required.
 *
 * Behavior:
 *   1. Transitions post → publishing.
 *   2. Writes the markdown file to content/posts/<slug>.md (Node only;
 *      returns reason: 'filesystem_unavailable' in Workers).
 *   3. Transitions post → published (on write success) or → failed.
 *   4. Returns the post + write result.
 */

import { loadConfig } from '../../../../../lib/config.js';
import { createStore } from '../../../../../lib/store.js';
import { transitionPost, publishToDisk } from '../../../../../lib/posts.js';
import {
  ok, err, verifyAdmin, withCors, handleOptions,
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
  let post;
  try {
    post = await transitionPost(store, id, 'publishing', { actor });
  } catch (e) {
    const code = e.code || 'transition_failed';
    const status = code === 'not_found' ? 404 : code === 'invalid_transition' ? 409 : 400;
    return withCors(err(code, e.message, status));
  }

  const written = config.contentDir
    ? await publishToDisk(config.contentDir, post)
    : { ok: false, reason: 'no_content_dir' };

  try {
    const finalPost = await transitionPost(store, id, written.ok ? 'published' : 'failed', {
      actor,
      meta: { write: written },
    });
    return withCors(ok({ post: finalPost, written }));
  } catch (e) {
    return withCors(err(e.code || 'transition_failed', e.message, 409));
  }
}
