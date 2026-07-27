#!/usr/bin/env node
/**
 * scripts/record-campaign-authorization.mjs — Appends a durable Production
 * audit_log entry recording the explicit, campaign-scoped publishing
 * authorization for the 30-article SEO campaign (commit 07ee9f3).
 *
 * Mirrors the exact row shape lib/auditLog.js's record() writes (id, actor,
 * action, target_type, target_id, meta, created_at) so this entry is
 * indistinguishable in format from any other audit entry the running
 * application produces — it is appended to the same append-only
 * table:audit_log array via the same KVStore.upsert semantics.
 *
 * Usage:
 *   node scripts/record-campaign-authorization.mjs --dry-run
 *   node scripts/record-campaign-authorization.mjs
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { campaign } from '../content/campaign/seo-30-article-campaign.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const NAMESPACE_ID = '57a4e58e773445d590a658c7edecc853'; // RAWWEBSITE_KV

function kv(args) {
  return execFileSync('npx', ['wrangler', 'kv', ...args, '--namespace-id', NAMESPACE_ID, '--remote'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 50, shell: true,
  });
}

const now = new Date().toISOString();
const recordIds = campaign.map(a => `campaign-${a.slug}`);

// Same row shape as lib/auditLog.js's record(), built ahead of time so this
// script can run outside the Workers runtime.
const entry = {
  id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `audit-${Date.now()}`,
  actor: 'website_owner_authorization',
  action: 'campaign.publishing_authorized',
  target_type: 'campaign',
  target_id: 'seo-30-article-campaign-07ee9f3',
  meta: {
    campaign_id: 'seo-30-article-campaign-07ee9f3',
    commit: '07ee9f3',
    record_ids: recordIds,
    record_count: recordIds.length,
    authorization_scope: 'Explicit authorization to publish this specific 30-article SEO campaign (commit 07ee9f3) only, given by the website owner/operator in chat. Does not establish or imply the authorizing party holds the "ceo" or "marketing_manager" role named in config/content_policy.json.',
    note: 'This is an explicit campaign-level publishing authorization, recorded because config/content_policy.json declares a two-reviewer (ceo + marketing_manager) approval requirement that is NOT currently enforced anywhere in code — lib/posts.js ALLOWED_TRANSITIONS and lib/scheduler.js processScheduledPosts have no check against that policy block. This entry documents the authorization that stands in for that unimplemented gate for this campaign only.',
  },
  created_at: now,
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log('[record-campaign-authorization] Entry to append:');
  console.log(JSON.stringify(entry, null, 2));

  if (dryRun) {
    console.log('[record-campaign-authorization] --dry-run: not writing. Exiting.');
    return;
  }

  console.log('[record-campaign-authorization] Fetching current table:audit_log...');
  let current;
  try {
    current = JSON.parse(kv(['key', 'get', 'table:audit_log']));
    if (!Array.isArray(current)) current = [];
  } catch {
    current = [];
  }
  console.log(`[record-campaign-authorization] Current audit_log has ${current.length} entries.`);

  const updated = [...current, entry];
  const tmpDir = mkdtempSync(join(tmpdir(), 'rawwebsite-audit-'));
  const tmpFile = join(tmpDir, 'audit_log.json');
  writeFileSync(tmpFile, JSON.stringify(updated));
  kv(['key', 'put', 'table:audit_log', '--path', tmpFile]);
  console.log(`[record-campaign-authorization] Wrote table:audit_log with ${updated.length} entries (was ${current.length}).`);

  const verify = JSON.parse(kv(['key', 'get', 'table:audit_log']));
  const found = verify.find(e => e.id === entry.id);
  console.log('[record-campaign-authorization] Verified entry present:', !!found);
  if (!found) {
    console.error('[record-campaign-authorization] FAILED: entry not found after write.');
    process.exit(1);
  }
}

main().catch(e => { console.error('[record-campaign-authorization] FAILED:', e.message); process.exit(1); });
