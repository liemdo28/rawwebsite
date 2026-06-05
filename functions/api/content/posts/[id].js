/**
 * functions/api/content/posts/[id].js — Path-param CRUD variant.
 * Mirrors /api/content/posts.js but uses the path instead of ?id=.
 */

import { loadConfig } from '../../../../lib/config.js';
import { createStore } from '../../../../lib/store.js';
import {
  validatePost, scoreAgainstPolicy, transitionPost,
} from '../../../../lib/posts.js';
import { record } from '../../../../lib/auditLog.js';
import {
  ok, err, readJson, verifyAdmin, withCors, handleOptions,
} from '../../../../lib/auditLog.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);
  const config = loadConfig(env);
  const store = createStore(env, { dataDir: config.dataDir });
  const id = params.id;

  if (request.method === 'GET') {
    const post = await store.get('posts', id);
    if (!post) return withCors(err('not_found', 'post not found', 404));
    return withCors(ok({ post, score: scoreAgainstPolicy(config.policyPath, post) }));
  }

  const actor = verifyAdmin(request, config.admin.secret);
  if (!actor) return withCors(err('unauthorized', 'admin Bearer token required', 401));

  if (request.method === 'PATCH') {
    const existing = await store.get('posts', id);
    if (!existing) return withCors(err('not_found', 'post not found', 404));
    const parsed = await readJson(request);
    if (!parsed.ok) return withCors(err(parsed.error, 'bad request body', 400));
    const merged = { ...existing, ...(parsed.data || {}), id };
    const v = validatePost(merged);
    if (!v.ok) return withCors(err('validation_failed', 'post invalid', 400, { errors: v.errors }));
    const score = scoreAgainstPolicy(config.policyPath, merged);
    const post = await store.upsert('posts', {
      ...merged,
      score: score.score,
      hard_blocks: score.hard_blocks,
      soft_failures: score.soft_failures,
    });
    await record(store, {
      actor, action: 'post.update', target_type: 'post', target_id: id,
      meta: { score: score.score },
    });
    return withCors(ok({ post, score }));
  }

  if (request.method === 'DELETE') {
    const removed = await store.remove('posts', id);
    if (!removed) return withCors(err('not_found', 'post not found', 404));
    await record(store, {
      actor, action: 'post.delete', target_type: 'post', target_id: id,
    });
    return withCors(ok({ deleted: id }));
  }

  return withCors(err('method_not_allowed', 'unsupported method', 405));
}
