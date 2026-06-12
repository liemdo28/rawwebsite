/**
 * functions/api/site/theme.js — Theme management API.
 *
 * GET    /api/site/theme            Get current theme
 * PATCH  /api/site/theme            Update theme (admin)
 */

import { loadConfig } from '../../../lib/config.js';
import { createStore } from '../../../lib/store.js';
import { getTheme, saveTheme, themeToCSSVars } from '../../../lib/theme.js';
import {
  ok, err, readJson, verifyAdmin, withCors, handleOptions,
} from '../../../lib/auditLog.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);

  const config = loadConfig(env);
  const store = createStore(env, { dataDir: config.dataDir });

  if (request.method === 'GET') {
    const theme = await getTheme(store);
    const css = themeToCSSVars(theme);
    return withCors(ok({ theme, css }));
  }

  const actor = verifyAdmin(request, config.admin.secret);
  if (!actor) return withCors(err('unauthorized', 'admin Bearer token required', 401));

  if (request.method === 'PATCH') {
    const parsed = await readJson(request);
    if (!parsed.ok) return withCors(err(parsed.error, 'bad request body', 400));
    const theme = await saveTheme(store, parsed.data, { actor });
    const css = themeToCSSVars(theme);
    return withCors(ok({ theme, css }));
  }

  return withCors(err('method_not_allowed', 'GET or PATCH only', 405));
}
