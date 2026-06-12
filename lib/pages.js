/**
 * lib/pages.js — Page lifecycle, version history, and rollback.
 *
 * Pages flow through the same state machine as posts:
 *   draft → pending_review → approved → scheduled → publishing → published
 *         ↘ rejected / failed
 *
 * Version history: every save creates a snapshot in `page_versions`.
 * Rollback: restore any version back to the page.
 *
 * Site pages (Home, About, Contact, etc.) are distinct from blog posts.
 * They represent static site pages managed via the CMS.
 */

import { record } from './auditLog.js';

export const PAGE_STATUSES = [
  'draft',
  'pending_review',
  'approved',
  'scheduled',
  'published',
  'rejected',
  'failed',
];

const ALLOWED_TRANSITIONS = {
  draft: ['pending_review', 'rejected'],
  pending_review: ['approved', 'rejected', 'draft'],
  approved: ['scheduled', 'publishing', 'draft'],
  scheduled: ['publishing', 'approved', 'failed'],
  publishing: ['published', 'failed'],
  published: [],
  rejected: ['draft'],
  failed: ['draft', 'pending_review'],
};

/**
 * Validate a page payload. Returns { ok: true, value } or { ok: false, errors }.
 * @param {unknown} body
 */
export function validatePage(body) {
  if (!body || typeof body !== 'object') return { ok: false, errors: ['body_must_be_object'] };
  const e = [];
  const b = body;
  if (typeof b.title !== 'string' || b.title.trim().length < 2) e.push('title_required_min_2');
  if (typeof b.slug !== 'string' || !/^\/[a-z0-9][a-z0-9-/_]*$/.test(b.slug)) e.push('slug_invalid_must_start_with_slash');
  if (typeof b.body !== 'string' || b.body.length < 1) e.push('body_required');
  if (b.status && !PAGE_STATUSES.includes(String(b.status))) e.push('status_invalid');
  if (b.publish_at && Number.isNaN(Date.parse(String(b.publish_at)))) e.push('publish_at_invalid');
  return e.length === 0 ? { ok: true, value: b } : { ok: false, errors: e };
}

/**
 * Apply a state transition to a page.
 * @param {any} store
 * @param {string} pageId
 * @param {string} newStatus
 * @param {{ actor?: string, meta?: Record<string, unknown> }} [opts]
 */
export async function transitionPage(store, pageId, newStatus, opts = {}) {
  if (!PAGE_STATUSES.includes(newStatus)) {
    throw Object.assign(new Error('invalid_status'), { code: 'invalid_status' });
  }
  const page = await store.get('pages', pageId);
  if (!page) throw Object.assign(new Error('not_found'), { code: 'not_found' });
  const currentStatus = page.status || 'draft';
  const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
  if (currentStatus !== newStatus && !allowed.includes(newStatus)) {
    throw Object.assign(new Error(`invalid_transition:${currentStatus}->${newStatus}`), {
      code: 'invalid_transition',
      from: currentStatus,
      to: newStatus,
    });
  }
  const updated = { ...page, status: newStatus };
  if (newStatus === 'published' && !updated.published_at) {
    updated.published_at = new Date().toISOString();
  }
  await store.upsert('pages', updated);
  await record(store, {
    actor: opts.actor || 'system',
    action: 'page.transition',
    target_type: 'page',
    target_id: pageId,
    meta: { from: page.status, to: newStatus, ...(opts.meta || {}) },
  });
  return updated;
}

/**
 * Save a page snapshot to version history before any update.
 * @param {any} store
 * @param {Record<string, unknown>} page
 * @param {{ actor?: string }} [opts]
 */
export async function saveVersion(store, page, opts = {}) {
  const version = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'ver-' + Date.now(),
    page_id: page.id,
    slug: page.slug,
    title: page.title,
    body: page.body,
    meta_title: page.meta_title || '',
    meta_description: page.meta_description || '',
    og_image: page.og_image || '',
    status: page.status || 'draft',
    created_by: opts.actor || 'system',
    created_at: new Date().toISOString(),
  };
  await store.upsert('page_versions', version);
  return version;
}

/**
 * Get all versions for a page (newest first).
 * @param {any} store
 * @param {string} pageId
 */
export async function listPageVersions(store, pageId) {
  const rows = await store.list('page_versions');
  return rows
    .filter(v => v.page_id === pageId)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

/**
 * Rollback a page to a specific version.
 * @param {any} store
 * @param {string} pageId
 * @param {string} versionId
 * @param {{ actor?: string }} [opts]
 */
export async function rollbackPage(store, pageId, versionId, opts = {}) {
  const page = await store.get('pages', pageId);
  if (!page) throw Object.assign(new Error('not_found'), { code: 'not_found' });
  const version = await store.get('page_versions', versionId);
  if (!version || version.page_id !== pageId) {
    throw Object.assign(new Error('version_not_found'), { code: 'version_not_found' });
  }

  // Save current state as a version before rolling back
  await saveVersion(store, page, opts);

  // Restore from version
  const restored = {
    ...page,
    title: version.title,
    body: version.body,
    meta_title: version.meta_title,
    meta_description: version.meta_description,
    og_image: version.og_image,
    status: version.status,
 };

  const updated = await store.upsert('pages', restored);
  await record(store, {
    actor: opts.actor || 'system',
    action: 'page.rollback',
    target_type: 'page',
    target_id: pageId,
    meta: { version_id: versionId, restored_title: version.title },
  });
  return updated;
}

/**
 * Publish a page to disk (Node only). Writes to public/<slug>.html.
 * @param {string} publicDir
 * @param {Record<string, unknown>} page
 */
export async function publishPageToDisk(publicDir, page) {
  try {
    const { promises: fs, existsSync, mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');

    // Normalize slug: /about → about.html, /contact → contact.html
    let filename = page.slug.replace(/^\//, '').replace(/\/$/, '');
    if (!filename.includes('.')) filename += '.html';
    const fp = join(publicDir, filename);

    // Build minimal HTML shell
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(String(page.title || ''))}</title>
  ${page.meta_description ? `<meta name="description" content="${escapeHtml(String(page.meta_description))}">` : ''}
  ${page.og_image ? `<meta property="og:image" content="${escapeHtml(String(page.og_image))}">` : ''}
  ${page.meta_title ? `<meta property="og:title" content="${escapeHtml(String(page.meta_title))}">` : ''}
</head>
<body>
${page.body || ''}
</body>
</html>`;

    await fs.writeFile(fp, html, 'utf8');
    return { ok: true, path: fp };
  } catch (err) {
    if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
      return { ok: false, reason: 'filesystem_unavailable' };
    }
    return { ok: false, reason: err && err.message ? err.message : String(err) };
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}
