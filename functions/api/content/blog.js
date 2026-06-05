/**
 * functions/api/content/blog.js — Public-facing blog index.
 *
 * GET /api/content/blog
 *   Returns the canonical post list, newest first. Combines:
 *   - Posts in the store with status === 'published'.
 *   - Posts in content/index.json (the static-site canonical index).
 *
 * The function lets the new management layer and the existing static
 * marketing site both serve blog content without coordination.
 */

import { loadConfig } from '../../../lib/config.js';
import { createStore } from '../../../lib/store.js';
import { ok, withCors, handleOptions } from '../../../lib/auditLog.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);
  if (request.method !== 'GET') {
    return withCors(ok({ error: 'method_not_allowed' }, 405));
  }
  const config = loadConfig(env);
  const store = createStore(env, { dataDir: config.dataDir });

  let storeRows = await store.list('posts');
  storeRows = storeRows.filter(p => p.status === 'published');

  // Merge any items from the on-disk content/index.json.
  let diskRows = [];
  try {
    const { readFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    if (existsSync(config.contentDir)) {
      const idxPath = join(config.contentDir, 'index.json');
      if (existsSync(idxPath)) {
        const parsed = JSON.parse(readFileSync(idxPath, 'utf8'));
        diskRows = (parsed.posts || []).filter(p => p.published);
      }
    }
  } catch (_) {
    // In Workers (no fs) we silently fall back to store-only.
  }

  // Dedupe by slug, preferring store rows.
  const merged = new Map();
  for (const p of diskRows) {
    merged.set(p.slug, {
      slug: p.slug,
      title: p.title,
      excerpt: p.excerpt || '',
      date: p.date || '',
      post_type: p.post_type || 'blog',
      image: p.image || '',
      primary_keyword: p.primary_keyword || '',
      secondary_keywords: p.secondary_keywords || [],
      source: 'static_index',
    });
  }
  for (const p of storeRows) {
    merged.set(p.slug, {
      slug: p.slug,
      title: p.title,
      excerpt: p.excerpt || '',
      date: (p.publish_at || p.published_at || p.updated_at || '').toString().slice(0, 10),
      post_type: p.post_type || 'blog',
      image: p.image || '',
      primary_keyword: p.primary_keyword || '',
      secondary_keywords: p.secondary_keywords || [],
      source: 'agent_bridge',
      score: p.score,
    });
  }

  const list = Array.from(merged.values()).sort((a, b) =>
    (b.date || '').localeCompare(a.date || ''));

  return withCors(ok({ posts: list, total: list.length }));
}
