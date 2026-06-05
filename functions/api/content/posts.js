/**
 * functions/api/content/posts.js — Direct CRUD for posts.
 *
 * GET    /api/content/posts           List posts (filterable by ?status=)
 * GET    /api/content/posts?id=...    Get a single post by id
 * POST   /api/content/posts           Create a draft post (admin)
 * PATCH  /api/content/posts?id=...    Update a post (admin)
 * DELETE /api/content/posts?id=...    Remove a post (admin)
 *
 * The same endpoints are mirrored on /api/content/posts/[id].js so that
 * the admin SPA can use either form.
 */

import { loadConfig } from '../../../lib/config.js';
import { createStore } from '../../../lib/store.js';
import {
  validatePost, transitionPost, scoreAgainstPolicy,
} from '../../../lib/posts.js';
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
      const post = await store.get('posts', id);
      if (!post) return withCors(err('not_found', 'post not found', 404));
      return withCors(ok({ post, score: policyScore(config, post) }));
    }
    const status = url.searchParams.get('status');
    let rows = await store.list('posts');
    if (status) rows = rows.filter(p => p.status === status);
    rows.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    return withCors(ok({ posts: rows, total: rows.length }));
  }

  // Mutations require admin auth.
  const actor = verifyAdmin(request, config.admin.secret);
  if (!actor) return withCors(err('unauthorized', 'admin Bearer token required', 401));

  if (request.method === 'POST') {
    const parsed = await readJson(request);
    if (!parsed.ok) return withCors(err(parsed.error, 'bad request body', 400));
    const v = validatePost(parsed.data);
    if (!v.ok) return withCors(err('validation_failed', 'post invalid', 400, { errors: v.errors }));
    const score = scoreAgainstPolicy(config.policyPath, v.value);
    if (score.hard_blocks && score.hard_blocks.length > 0) {
      return withCors(err('policy_hard_block', 'post blocked by content policy', 400, { score }));
    }
    const post = await store.upsert('posts', {
      ...v.value,
      status: v.value.status || 'draft',
      score: score.score,
      hard_blocks: score.hard_blocks,
      soft_failures: score.soft_failures,
      created_by: actor,
    });
    await record(store, {
      actor, action: 'post.create', target_type: 'post', target_id: post.id,
      meta: { score: score.score },
    });
    return withCors(ok({ post, score }), 201);
  }

  if (request.method === 'PATCH') {
    const id = url.searchParams.get('id');
    if (!id) return withCors(err('id_required', 'id query param required', 400));
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
    const id = url.searchParams.get('id');
    if (!id) return withCors(err('id_required', 'id query param required', 400));
    const removed = await store.remove('posts', id);
    if (!removed) return withCors(err('not_found', 'post not found', 404));
    await record(store, {
      actor, action: 'post.delete', target_type: 'post', target_id: id,
    });
    return withCors(ok({ deleted: id }));
  }

  return withCors(err('method_not_allowed', 'unsupported method', 405));
}

function policyScore(config, post) {
  if (!config.policyPath) return null;
  return scoreAgainstPolicy(config.policyPath, post);
}
