/**
 * functions/api/menu/publish.js — Publish menu changes to Git.
 *
 * POST /api/menu/publish?location=...
 *   Commits menu JSON to Git repository.
 *   Admin auth required.
 *
 * This endpoint:
 *   1. Gathers all menu categories + items for the location
 *   2. Commits JSON to Git (if GitHub credentials configured)
 *   3. Records audit log with commit hash
 */

import { loadConfig } from '../../../lib/config.js';
import { createStore } from '../../../lib/store.js';
import { commitMenuToGit, buildGitAuditEntry } from '../../../lib/gitPublish.js';
import { record } from '../../../lib/auditLog.js';
import {
  ok, err, verifyAdmin, withCors, handleOptions,
} from '../../../lib/auditLog.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);

  if (request.method !== 'POST') {
    return withCors(err('method_not_allowed', 'POST only', 405));
  }

  const config = loadConfig(env);
  const store = createStore(env, { dataDir: config.dataDir });

  const actor = verifyAdmin(request, config.admin.secret);
  if (!actor) return withCors(err('unauthorized', 'admin Bearer token required', 401));

  const url = new URL(request.url);
  const location = url.searchParams.get('location');
  if (!location) return withCors(err('location_required', 'location query param required', 400));

  // Map API location to file location
  const locationMap = {
    'raw_stockton': 'stockton',
    'raw_modesto': 'modesto',
    'stockton': 'stockton',
    'modesto': 'modesto',
  };

  const fileLocation = locationMap[location];
  if (!fileLocation) {
    return withCors(err('location_invalid', 'location must be stockton or modesto', 400));
  }

  try {
    // Gather menu data
    const allCategories = await store.list('menu_categories');
    const allItems = await store.list('menu_items');

    const categories = allCategories.filter(c => 
      c.location === location || c.location === `raw_${fileLocation}`
    );
    const items = allItems.filter(i => 
      i.location === location || i.location === `raw_${fileLocation}`
    );

    const menuData = {
      location: fileLocation,
      updated_at: new Date().toISOString(),
      categories: categories.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
      items: items.filter(i => i.active !== false).sort((a, b) => 
        String(a.name || '').localeCompare(String(b.name || ''))
      ),
    };

    // Attempt Git commit if credentials available
    let gitResult = null;
    if (env.GITHUB_TOKEN && env.GITHUB_OWNER && env.GITHUB_REPO) {
      gitResult = await commitMenuToGit(env, menuData, fileLocation, { actor });

      // Record git commit in audit log
      await record(store, buildGitAuditEntry(gitResult, {
        actor,
        targetType: 'menu',
        targetId: fileLocation,
      }));
    }

    await record(store, {
      actor,
      action: 'menu.publish',
      target_type: 'menu',
      target_id: fileLocation,
      meta: {
        categories_count: categories.length,
        items_count: items.length,
        git_commit: gitResult?.commit,
        git_ok: gitResult?.ok,
      },
    });

    return withCors(ok({
      menu: menuData,
      git: gitResult,
    }));
  } catch (e) {
    await record(store, {
      actor,
      action: 'menu.publish_failed',
      target_type: 'menu',
      target_id: fileLocation,
      meta: { error: e.message },
    });

    return withCors(err('publish_failed', e.message, 500));
  }
}
