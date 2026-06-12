/**
 * functions/api/site/seo.js — SEO management API.
 *
 * GET    /api/site/seo            Get current SEO settings
 * PATCH  /api/site/seo            Update SEO settings (admin)
 */

import { loadConfig } from '../../../lib/config.js';
import { createStore } from '../../../lib/store.js';
import { getSeo, saveSeo, buildRestaurantSchema, buildRobotsTxt } from '../../../lib/seo.js';
import {
  ok, err, readJson, verifyAdmin, withCors, handleOptions,
} from '../../../lib/auditLog.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);

  const config = loadConfig(env);
  const store = createStore(env, { dataDir: config.dataDir });

  if (request.method === 'GET') {
    const seo = await getSeo(store);
    const schema = buildRestaurantSchema(seo);
    const robots = buildRobotsTxt(seo);
    return withCors(ok({ seo, schema, robots }));
  }

  const actor = verifyAdmin(request, config.admin.secret);
  if (!actor) return withCors(err('unauthorized', 'admin Bearer token required', 401));

  if (request.method === 'PATCH') {
    const parsed = await readJson(request);
    if (!parsed.ok) return withCors(err(parsed.error, 'bad request body', 400));
    const seo = await saveSeo(store, parsed.data, { actor });
    const schema = buildRestaurantSchema(seo);
    return withCors(ok({ seo, schema }));
  }

  return withCors(err('method_not_allowed', 'GET or PATCH only', 405));
}
