/**
 * lib/posts.js — Post lifecycle, markdown serialization, and publish-to-disk.
 *
 * Posts flow through these states:
 *
 *   draft → pending_review → approved → scheduled → publishing → published
 *         ↘ rejected / failed
 *
 * The canonical store is `posts` in the Agent-coding management layer
 * (lib/store.js). For static-site publishing, we additionally serialize a
 * post to a markdown file in `content/posts/<slug>.md` and add it to
 * `content/index.json`. The build (`build.mjs`) copies `content/` into
 * `public/content/` so the existing `blog-posts.html` reader can display
 * it without any code change.
 *
 * If we are inside a Cloudflare Worker (no `node:fs`), the on-disk publish
 * step is skipped (the post still exists in the in-memory / KV store and
 * is accessible via the admin SPA and the public blog API).
 */

import { scorePost } from './contentPolicy.js';
import { record } from './auditLog.js';

export const POST_STATUSES = [
  'draft',
  'pending_review',
  'approved',
  'scheduled',
  'publishing',
  'published',
  'rejected',
  'failed',
];

const ALLOWED_TRANSITIONS = {
  draft: ['pending_review', 'rejected'],
  pending_review: ['approved', 'rejected', 'draft'],
  approved: ['scheduled', 'publishing', 'draft'],
  scheduled: ['publishing', 'approved', 'failed'],
  // 'scheduled' is included here so a failed publish attempt (e.g. git
  // publishing unavailable or unsuccessful) can revert to a retryable
  // state instead of being stuck in 'publishing' or wrongly marked
  // 'published' without a verified artifact.
  publishing: ['published', 'failed', 'scheduled'],
  published: [],
  rejected: ['draft'],
  failed: ['draft', 'pending_review'],
};

/**
 * Validate a post payload. Returns either { ok: true, value } or
 * { ok: false, errors }.
 *
 * @param {unknown} body
 */
export function validatePost(body) {
  if (!body || typeof body !== 'object') return { ok: false, errors: ['body_must_be_object'] };
  const e = [];
  const b = body;
  if (typeof b.title !== 'string' || b.title.trim().length < 3) e.push('title_required_min_3');
  if (typeof b.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{1,80}$/.test(b.slug)) e.push('slug_invalid');
  if (typeof b.body !== 'string' || b.body.length < 1) e.push('body_required');
  if (b.location && String(b.location) !== 'raw_stockton') e.push('location_invalid');
  if (b.status && !POST_STATUSES.includes(String(b.status))) e.push('status_invalid');
  if (b.cta_url && typeof b.cta_url === 'string' && !/^https?:\/\//.test(b.cta_url)) e.push('cta_url_invalid');
  if (b.publish_at && Number.isNaN(Date.parse(String(b.publish_at)))) e.push('publish_at_invalid');
  return e.length === 0 ? { ok: true, value: b } : { ok: false, errors: e };
}

/**
 * Apply a state transition to a post. Returns the updated row.
 *
 * @param {any} store
 * @param {string} postId
 * @param {string} newStatus
 * @param {{ actor?: string, meta?: Record<string, unknown> }} [opts]
 */
export async function transitionPost(store, postId, newStatus, opts = {}) {
  if (!POST_STATUSES.includes(newStatus)) {
    throw Object.assign(new Error('invalid_status'), { code: 'invalid_status' });
  }
  const post = await store.get('posts', postId);
  if (!post) throw Object.assign(new Error('not_found'), { code: 'not_found' });
  // Defensive default: an upserted post with no status is treated as 'draft'.
  const currentStatus = post.status || 'draft';
  const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
  if (currentStatus !== newStatus && !allowed.includes(newStatus)) {
    throw Object.assign(new Error(`invalid_transition:${currentStatus}->${newStatus}`), {
      code: 'invalid_transition',
      from: currentStatus,
      to: newStatus,
    });
  }
  const updated = { ...post, status: newStatus };
  if (newStatus === 'published' && !updated.published_at) {
    updated.published_at = new Date().toISOString();
  }
  // The posts-table write is the real state change and must propagate on
  // failure (callers rely on it for fail-closed correctness). The audit-log
  // entry is a secondary, best-effort record: a KV write-quota failure here
  // must never be mistaken for a failed transition — see the 2026-07-28 KV
  // daily write-quota incident, where an unprotected audit write elsewhere
  // in this same chain surfaced as an uncaught exception (error 1101).
  await store.upsert('posts', updated);
  try {
    await record(store, {
      actor: opts.actor || 'system',
      action: 'post.transition',
      target_type: 'post',
      target_id: postId,
      meta: { from: post.status, to: newStatus, ...(opts.meta || {}) },
    });
  } catch { /* best effort */ }
  return updated;
}

/**
 * Score a post against the content policy. If policyPath is null/undefined,
 * the score step is skipped and {score:null}.
 *
 * @param {string|null} policyPath
 * @param {Record<string, unknown>} post
 */
export function scoreAgainstPolicy(policyPath, post) {
  if (!policyPath) return { score: null, passed: null, hard_blocks: [], soft_failures: [], details: {} };
  return scorePost(policyPath, post);
}

/**
 * Build a markdown file body from a post.
 * @param {Record<string, unknown>} post
 */
export function postToMarkdown(post) {
  const fm = ['---'];
  fm.push(`title: "${escapeYaml(String(post.title || ''))}"`);
  if (post.slug) fm.push(`slug: ${post.slug}`);
  if (post.date || post.publish_at) fm.push(`date: ${(post.date || post.publish_at).toString().slice(0, 10)}`);
  if (post.excerpt) fm.push(`excerpt: "${escapeYaml(String(post.excerpt))}"`);
  if (post.meta_description) fm.push(`meta_description: "${escapeYaml(String(post.meta_description))}"`);
  if (post.image) fm.push(`image: ${post.image}`);
  if (post.cta) fm.push(`cta: "${escapeYaml(String(post.cta))}"`);
  if (post.cta_url) fm.push(`cta_url: ${post.cta_url}`);
  if (post.primary_keyword) fm.push(`primary_keyword: "${escapeYaml(String(post.primary_keyword))}"`);
  if (Array.isArray(post.secondary_keywords) && post.secondary_keywords.length) {
    fm.push(`secondary_keywords: [${post.secondary_keywords.map(s => escapeYaml(String(s))).join(', ')}]`);
  }
  if (post.post_type) fm.push(`post_type: ${post.post_type}`);
  if (post.target_audience) fm.push(`target_audience: "${escapeYaml(String(post.target_audience))}"`);
  if (post.location) fm.push(`location: ${post.location}`);
  fm.push(`status: ${post.status || 'draft'}`);
  fm.push(`published: ${post.status === 'published' ? 'true' : 'false'}`);
  fm.push('---');
  fm.push('');
  fm.push(String(post.body || ''));
  fm.push('');
  return fm.join('\n');
}

function escapeYaml(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Try to write the post to disk (content/posts/<slug>.md) and update
 * content/index.json. Returns { ok, path?, reason? }.
 *
 * This is a Node-only step. In Cloudflare Workers (no `fs` API), it returns
 * { ok: false, reason: 'filesystem_unavailable' } and the post remains
 * available in the store.
 *
 * @param {string} contentDir
 * @param {Record<string, unknown>} post
 */
export async function publishToDisk(contentDir, post) {
  try {
    const { promises: fs, existsSync, mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const postsDir = join(contentDir, 'posts');
    mkdirSync(postsDir, { recursive: true });
    const fp = join(postsDir, `${post.slug}.md`);
    await fs.writeFile(fp, postToMarkdown(post), 'utf8');

    // Update the canonical JSON index so blog-posts.html picks it up.
    const indexFp = join(contentDir, 'index.json');
    let idx = { posts: [] };
    if (existsSync(indexFp)) {
      try { idx = JSON.parse(await fs.readFile(indexFp, 'utf8')); } catch { idx = { posts: [] }; }
    }
    if (!Array.isArray(idx.posts)) idx.posts = [];
    const entry = {
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt || '',
      date: (post.date || post.publish_at || new Date().toISOString()).toString().slice(0, 10),
      post_type: post.post_type || 'blog',
      image: post.image || '',
      primary_keyword: post.primary_keyword || '',
      secondary_keywords: post.secondary_keywords || [],
      published: post.status === 'published',
    };
    const existingIdx = idx.posts.findIndex(p => p.slug === post.slug);
    if (existingIdx === -1) idx.posts.unshift(entry);
    else idx.posts[existingIdx] = entry;
    await fs.writeFile(indexFp, JSON.stringify(idx, null, 2));

    return { ok: true, path: fp };
  } catch (err) {
    if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
      return { ok: false, reason: 'filesystem_unavailable' };
    }
    return { ok: false, reason: err && err.message ? err.message : String(err) };
  }
}
