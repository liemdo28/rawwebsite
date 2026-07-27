#!/usr/bin/env node
/**
 * scripts/seed-campaign-kv.mjs — Idempotently seed the 30-article SEO
 * campaign into Production Cloudflare KV (RAWWEBSITE_KV, table:posts).
 *
 * This talks to Cloudflare over `wrangler kv key get/put --remote`, i.e. the
 * exact same KV namespace the deployed Cloudflare Pages Function reads via
 * lib/store.js's KVStore — not a local/dev copy.
 *
 * Idempotent: re-running this script will not duplicate records. Each
 * campaign article gets a deterministic id (`campaign-<slug>`), and any
 * existing row with that id is updated in place rather than appended.
 *
 * Usage:
 *   node scripts/seed-campaign-kv.mjs --dry-run   # validate + show diff only
 *   node scripts/seed-campaign-kv.mjs             # actually write to KV
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePost, scoreAgainstPolicy } from '../lib/posts.js';
import { campaign } from '../content/campaign/seo-30-article-campaign.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const NAMESPACE_ID = '57a4e58e773445d590a658c7edecc853'; // RAWWEBSITE_KV, from wrangler.toml

/**
 * Map an editorial campaign article into the exact row shape lib/store.js's
 * KVStore persists under table:posts, validated by lib/posts.js.
 */
export function toKvRecord(article, { now = new Date().toISOString() } = {}) {
  const ctaUrl = /^https?:\/\//.test(article.cta_url || '') ? article.cta_url : undefined;
  const ctaHref = ctaUrl ? undefined : article.cta_url; // e.g. tel: links — kept, just not under the http(s)-validated field
  const record = {
    id: `campaign-${article.slug}`,
    slug: article.slug,
    title: article.title,
    body: article.body,
    excerpt: article.meta_description,
    meta_description: article.meta_description,
    image: article.image,
    image_alt: article.image_alt,
    primary_keyword: article.primary_keyword,
    secondary_keywords: article.secondary_keywords || [],
    cta: article.cta,
    ...(ctaUrl ? { cta_url: ctaUrl } : {}),
    ...(ctaHref ? { cta_href: ctaHref } : {}),
    location: 'raw_stockton',
    post_type: 'seo_campaign',
    schema_type: article.schema_type || 'Article',
    status: 'scheduled',
    publish_at: article.publish_at,
    created_by: 'ceo:campaign-seed',
    created_at: now,
    updated_at: now,
  };
  return record;
}

// `shell: true` is required for npx.cmd to spawn correctly on Windows.
// Safe here: every argument is a static, hardcoded string (namespace id,
// literal flags) — none of it is user- or network-controlled input.
function kv(args) {
  return execFileSync('npx', ['wrangler', 'kv', ...args, '--namespace-id', NAMESPACE_ID, '--remote'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 50, shell: true,
  });
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // 1. Validate every article against the project's own schema + policy
  //    before touching Production at all.
  const records = campaign.map(a => toKvRecord(a));
  const invalid = [];
  for (const r of records) {
    const v = validatePost(r);
    if (!v.ok) invalid.push({ slug: r.slug, errors: v.errors });
    const score = scoreAgainstPolicy(null, r);
    if (score.hard_blocks.length) invalid.push({ slug: r.slug, hard_blocks: score.hard_blocks });
  }
  if (invalid.length) {
    console.error('[seed-campaign-kv] Validation FAILED for', invalid.length, 'records:');
    console.error(JSON.stringify(invalid, null, 2));
    process.exit(1);
  }
  console.log(`[seed-campaign-kv] All ${records.length} records passed validatePost() + content-policy scoring.`);

  const slugs = records.map(r => r.slug);
  if (new Set(slugs).size !== slugs.length) {
    console.error('[seed-campaign-kv] FAILED: duplicate slugs within the campaign itself.');
    process.exit(1);
  }

  // 2. Backup the current table:posts row *before* writing anything.
  console.log('[seed-campaign-kv] Fetching current table:posts for backup + merge...');
  let currentRaw;
  try {
    currentRaw = kv(['key', 'get', 'table:posts']);
  } catch {
    currentRaw = '[]';
  }
  let current;
  try {
    current = JSON.parse(currentRaw);
    if (!Array.isArray(current)) current = [];
  } catch {
    current = [];
  }

  const backupDir = mkdtempSync(join(tmpdir(), 'rawwebsite-kv-backup-'));
  const backupPath = join(backupDir, `posts-backup-${Date.now()}.json`);
  writeFileSync(backupPath, JSON.stringify(current, null, 2));
  console.log(`[seed-campaign-kv] Backed up ${current.length} existing post(s) to ${backupPath}`);

  // 3. Merge: update-in-place by id (idempotent), otherwise append.
  const byId = new Map(current.map(p => [p.id, p]));
  let created = 0, updated = 0;
  for (const r of records) {
    if (byId.has(r.id)) {
      const existing = byId.get(r.id);
      // Never regress a post that has already progressed past 'scheduled'
      // (e.g. published, or manually edited) back to 'scheduled'.
      if (existing.status && existing.status !== 'scheduled' && existing.status !== 'draft') {
        console.log(`[seed-campaign-kv] SKIP ${r.slug}: already status=${existing.status}, not overwriting`);
        continue;
      }
      byId.set(r.id, { ...existing, ...r, created_at: existing.created_at || r.created_at });
      updated++;
    } else {
      byId.set(r.id, r);
      created++;
    }
  }
  const merged = Array.from(byId.values());

  const campaignSlugsInStore = merged.filter(p => p.id?.startsWith('campaign-'));
  console.log(`[seed-campaign-kv] Plan: ${created} new, ${updated} updated, ${merged.length} total rows (${campaignSlugsInStore.length} campaign rows) after merge.`);

  if (dryRun) {
    console.log('[seed-campaign-kv] --dry-run: not writing to KV. Exiting.');
    return;
  }

  // 4. Write back.
  const tmpFile = join(backupDir, 'merged-posts.json');
  writeFileSync(tmpFile, JSON.stringify(merged));
  kv(['key', 'put', 'table:posts', '--path', tmpFile]);
  console.log('[seed-campaign-kv] Wrote merged posts table to Production KV.');

  // 5. Verify by reading back.
  const verifyRaw = kv(['key', 'get', 'table:posts']);
  const verify = JSON.parse(verifyRaw);
  const verifyCampaign = verify.filter(p => p.id?.startsWith('campaign-'));
  console.log(`[seed-campaign-kv] Verified: ${verifyCampaign.length} campaign rows now present in Production KV.`);
  if (verifyCampaign.length !== 30) {
    console.error(`[seed-campaign-kv] WARNING: expected 30 campaign rows, found ${verifyCampaign.length}.`);
    process.exit(1);
  }
  rmSync(backupDir, { recursive: true, force: true });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('[seed-campaign-kv] FAILED:', e.message); process.exit(1); });
}
