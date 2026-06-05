/**
 * functions/api/content/posts/preview.js — Score a draft without saving.
 *
 * POST /api/content/posts/preview
 *   Body: any post-shaped object.
 *   Admin auth required.
 *   Returns the policy score without writing to the store.
 */

import { loadConfig } from '../../../../lib/config.js';
import { createStore } from '../../../../lib/store.js';
import { scoreAgainstPolicy } from '../../../../lib/posts.js';
import {
  ok, err, readJson, verifyAdmin, withCors, handleOptions,
} from '../../../../lib/auditLog.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);
  if (request.method !== 'POST') {
    return withCors(err('method_not_allowed', 'POST only', 405));
  }
  const config = loadConfig(env);
  // createStore is called to keep the helper import surface uniform
  // even though preview does not read from the store.
  createStore(env, { dataDir: config.dataDir });

  const actor = verifyAdmin(request, config.admin.secret);
  if (!actor) return withCors(err('unauthorized', 'admin Bearer token required', 401));

  const parsed = await readJson(request);
  if (!parsed.ok) return withCors(err(parsed.error, 'bad request body', 400));

  const score = scoreAgainstPolicy(config.policyPath, parsed.data || {});
  return withCors(ok({ score }));
}
