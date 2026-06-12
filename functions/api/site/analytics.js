/**
 * functions/api/site/analytics.js — Analytics management API.
 *
 * GET    /api/site/analytics            Get current analytics settings
 * PATCH  /api/site/analytics            Update analytics settings (admin)
 */

import { loadConfig } from '../../../lib/config.js';
import { createStore } from '../../../lib/store.js';
import {
  getAnalytics, saveAnalytics, buildGAScript, buildGTMScript, buildCFAnalyticsScript,
} from '../../../lib/analytics.js';
import {
  ok, err, readJson, verifyAdmin, withCors, handleOptions,
} from '../../../lib/auditLog.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);

  const config = loadConfig(env);
  const store = createStore(env, { dataDir: config.dataDir });

  if (request.method === 'GET') {
    const analytics = await getAnalytics(store);
    const scripts = {
      ga: buildGAScript(analytics, 'production'),
      gtm: buildGTMScript(analytics),
      cf: buildCFAnalyticsScript(analytics),
    };
    return withCors(ok({ analytics, scripts }));
  }

  const actor = verifyAdmin(request, config.admin.secret);
  if (!actor) return withCors(err('unauthorized', 'admin Bearer token required', 401));

  if (request.method === 'PATCH') {
    const parsed = await readJson(request);
    if (!parsed.ok) return withCors(err(parsed.error, 'bad request body', 400));
    const analytics = await saveAnalytics(store, parsed.data, { actor });
    return withCors(ok({ analytics }));
  }

  return withCors(err('method_not_allowed', 'GET or PATCH only', 405));
}
