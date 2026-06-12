/**
 * lib/redirects.js — Redirect manager (301/302) with bulk import/export.
 *
 * Redirects are stored in the `redirects` table.
 * Each row: { id, from_path, to_url, type (301|302), active, note, created_at, updated_at }
 *
 * The module also provides helpers to generate _redirects (Netlify) and
 * wrangler.toml redirect rules for Cloudflare Pages.
 */

import { record } from './auditLog.js';

/**
 * Validate a redirect row.
 * @param {unknown} body
 */
export function validateRedirect(body) {
  if (!body || typeof body !== 'object') return { ok: false, errors: ['body_must_be_object'] };
  const e = [];
  const b = body;
  if (typeof b.from_path !== 'string' || !b.from_path.startsWith('/')) e.push('from_path_required_must_start_with_slash');
  if (typeof b.to_url !== 'string' || !/^https?:\/\/|^\//.test(b.to_url)) e.push('to_url_invalid');
  if (b.type && !['301', '302'].includes(String(b.type))) e.push('type_must_be_301_or_302');
  return e.length === 0 ? { ok: true, value: b } : { ok: false, errors: e };
}

/**
 * Create or update a redirect.
 * @param {any} store
 * @param {Record<string, unknown>} redirect
 * @param {{ actor?: string }} [opts]
 */
export async function upsertRedirect(store, redirect, opts = {}) {
  const v = validateRedirect(redirect);
  if (!v.ok) throw new Error('validation_failed: ' + v.errors.join(','));
  const row = {
    ...v.value,
    type: String(v.value.type || '301'),
    active: v.value.active !== false,
  };
  const saved = await store.upsert('redirects', row);
  await record(store, {
    actor: opts.actor || 'system',
    action: saved.id === v.value.id ? 'redirect.update' : 'redirect.create',
    target_type: 'redirect',
    target_id: saved.id,
    meta: { from: saved.from_path, to: saved.to_url, type: saved.type },
  });
  return saved;
}

/**
 * Delete a redirect.
 * @param {any} store
 * @param {string} id
 * @param {{ actor?: string }} [opts]
 */
export async function deleteRedirect(store, id, opts = {}) {
  const existing = await store.get('redirects', id);
  if (!existing) return false;
  await store.remove('redirects', id);
  await record(store, {
    actor: opts.actor || 'system',
    action: 'redirect.delete',
    target_type: 'redirect',
    target_id: id,
    meta: { from: existing.from_path },
  });
  return true;
}

/**
 * Get all active redirects, sorted by from_path.
 * @param {any} store
 */
export async function listActiveRedirects(store) {
  const rows = await store.list('redirects');
  return rows
    .filter(r => r.active)
    .sort((a, b) => String(a.from_path || '').localeCompare(String(b.from_path || '')));
}

/**
 * Generate a Netlify _redirects file content.
 * @param {any} store
 */
export async function generateNetlifyRedirects(store) {
  const rows = await listActiveRedirects(store);
  return rows
    .map(r => `${r.from_path}\t${r.to_url}\t${r.type}`)
    .join('\n') + '\n';
}

/**
 * Generate a Cloudflare Pages _redirects-compatible list.
 * @param {any} store
 */
export async function generateCloudflareRedirects(store) {
  const rows = await listActiveRedirects(store);
  return rows.map(r => ({
    from: r.from_path,
    to: r.to_url,
    status: parseInt(r.type, 10),
  }));
}

/**
 * Bulk import redirects from CSV string.
 * Expected format: from_path,to_url,type[,note]
 * @param {any} store
 * @param {string} csv
 * @param {{ actor?: string }} [opts]
 */
export async function bulkImportCsv(store, csv, opts = {}) {
  const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
  const results = { created: 0, updated: 0, errors: [] };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#') || line.startsWith('from_path')) continue;
    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 2) {
      results.errors.push({ line: i + 1, error: 'needs_at_least_from_and_to' });
      continue;
    }
    try {
      const existing = (await store.list('redirects')).find(r => r.from_path === parts[0]);
      const saved = await upsertRedirect(store, {
        from_path: parts[0],
        to_url: parts[1],
        type: parts[2] || '301',
        note: parts[3] || '',
        id: existing ? existing.id : undefined,
      }, opts);
      if (existing) results.updated++;
      else results.created++;
    } catch (e) {
      results.errors.push({ line: i + 1, error: e.message });
    }
  }

  await record(store, {
    actor: opts.actor || 'system',
    action: 'redirect.bulk_import',
    target_type: 'redirect',
    target_id: 'bulk',
    meta: { created: results.created, updated: results.updated, errors: results.errors.length },
  });

  return results;
}

/**
 * Export all redirects as CSV.
 * @param {any} store
 */
export async function exportCsv(store) {
  const rows = await store.list('redirects');
  rows.sort((a, b) => String(a.from_path || '').localeCompare(String(b.from_path || '')));
  const header = 'from_path,to_url,type,note,active,created_at';
  const lines = rows.map(r => [
    r.from_path,
    r.to_url,
    r.type || '301',
    r.note || '',
    r.active ? 'true' : 'false',
    r.created_at || '',
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  return [header, ...lines].join('\n') + '\n';
}
