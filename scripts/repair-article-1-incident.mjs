#!/usr/bin/env node
/**
 * scripts/repair-article-1-incident.mjs — Targeted, idempotent incident
 * repair for campaign-stockton-sushi-visit-faq-parking-groups-reservations.
 *
 * Incident: GitHub Actions run 30319978244 (2026-07-28T01:20:46Z) called
 * /api/scheduler/run while Cloudflare Pages Production had no GITHUB_TOKEN/
 * GITHUB_OWNER/GITHUB_REPO configured. The pre-fix scheduler (lib/scheduler.js
 * before commit 1617d2c) transitioned the post to 'published' unconditionally,
 * even though gitPublish was null — no commit, no public/<slug>.html, and no
 * sitemap entry were ever created. Confirmed via the post's own audit trail
 * (meta.git: null) and via direct checks against GitHub and the live sitemap.
 *
 * This script:
 *   1. Confirms no HTML page or sitemap entry exists for the slug (safety
 *      check, read-only).
 *   2. Writes exactly one durable incident audit-log entry (idempotent —
 *      checked by a deterministic id before insert).
 *   3. Corrects ONLY this one post's status from the false 'published' back
 *      to 'scheduled' (a state transitionPost() cannot do, since
 *      ALLOWED_TRANSITIONS has published: [] by design — this is a targeted
 *      out-of-band repair, not a normal application transition). Clears the
 *      incorrect published_at. Leaves title/slug/body/excerpt/meta/image/
 *      image_alt/keywords/cta/location/publish_at/created_at untouched.
 *   4. Leaves every other post record (articles #2-30, the 2 pre-existing
 *      published posts) completely untouched.
 *
 * Usage:
 *   node scripts/repair-article-1-incident.mjs --dry-run
 *   node scripts/repair-article-1-incident.mjs
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const NAMESPACE_ID = '57a4e58e773445d590a658c7edecc853'; // RAWWEBSITE_KV

const SLUG = 'stockton-sushi-visit-faq-parking-groups-reservations';
const POST_ID = `campaign-${SLUG}`;
const INCIDENT_ID = 'audit-incident-repair-campaign-stockton-sushi-visit-faq-parking-groups-reservations-run-30319978244';

function kv(args) {
  return execFileSync('npx', ['wrangler', 'kv', ...args, '--namespace-id', NAMESPACE_ID, '--remote'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 50, shell: true,
  });
}

async function githubFileExists(path) {
  const res = await fetch(`https://api.github.com/repos/liemdo28/rawwebsite/contents/${path}?ref=main`);
  return res.status === 200;
}

async function sitemapHasEntry(slug) {
  const res = await fetch('https://www.rawsushibar.com/sitemap.xml');
  const text = await res.text();
  return text.includes(`${slug}.html`);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // 1. Safety check: confirm no artifact exists before "repairing" anything.
  const pageExists = await githubFileExists(`public/${SLUG}.html`);
  const inSitemap = await sitemapHasEntry(SLUG);
  console.log(`[repair] public/${SLUG}.html exists on GitHub main: ${pageExists}`);
  console.log(`[repair] sitemap.xml contains ${SLUG}.html: ${inSitemap}`);
  if (pageExists || inSitemap) {
    console.error('[repair] ABORT: a real artifact now exists for this slug. Do not repair — this would corrupt a legitimately published article. Investigate before proceeding.');
    process.exit(1);
  }

  // 2. Read current posts + audit_log.
  const posts = JSON.parse(kv(['key', 'get', 'table:posts']));
  const auditLog = JSON.parse(kv(['key', 'get', 'table:audit_log']));

  const post = posts.find(p => p.id === POST_ID);
  if (!post) {
    console.error(`[repair] ABORT: post ${POST_ID} not found in table:posts.`);
    process.exit(1);
  }

  const alreadyRepaired = post.status !== 'published';
  const existingIncidentEntry = auditLog.find(e => e.id === INCIDENT_ID);

  console.log(`[repair] Current post status: ${post.status} (already repaired: ${alreadyRepaired})`);
  console.log(`[repair] Existing incident audit entry: ${!!existingIncidentEntry}`);

  if (alreadyRepaired && existingIncidentEntry) {
    console.log('[repair] SKIP: repair already applied and audit entry already exists. Nothing to do (idempotent no-op).');
    return;
  }

  const now = new Date().toISOString();

  const incidentEntry = {
    id: INCIDENT_ID,
    actor: 'website_owner_authorization',
    action: 'campaign.incident_repair',
    target_type: 'post',
    target_id: POST_ID,
    meta: {
      github_run_id: '30319978244',
      incident: 'false_published_transition',
      description: 'Post was transitioned to status=published by the scheduler even though gitPublish was null (GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO were not yet configured in Cloudflare Pages Production). No GitHub publication commit, no public/<slug>.html, and no sitemap entry were ever created. Confirmed via the post transition audit trail (meta.git: null) and via direct read-only checks against the GitHub Contents API and the live sitemap.xml.',
      correction: 'Status corrected from the false "published" back to "scheduled" (published_at cleared) for a controlled retry under the fixed, fail-closed scheduler (commit 1617d2c), which now requires a verified Git artifact before any post can reach status=published.',
      fix_commit: '1617d2c',
      previous_status: 'published',
      corrected_status: 'scheduled',
    },
    created_at: now,
  };

  if (!existingIncidentEntry) {
    console.log('[repair] Incident audit entry to write:');
    console.log(JSON.stringify(incidentEntry, null, 2));
  } else {
    console.log('[repair] Incident audit entry already present — will not duplicate.');
  }

  if (!alreadyRepaired) {
    console.log('[repair] Post correction: status published -> scheduled, published_at cleared. All other fields (title, slug, body, excerpt, meta_description, image, image_alt, primary_keyword, secondary_keywords, cta, cta_url, location, publish_at, created_at, created_by) left untouched.');
  } else {
    console.log('[repair] Post already scheduled — no post correction needed.');
  }

  if (dryRun) {
    console.log('[repair] --dry-run: not writing. Exiting.');
    return;
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'rawwebsite-repair-'));

  // Write the audit entry first (append-only, idempotent).
  if (!existingIncidentEntry) {
    const updatedAudit = [...auditLog, incidentEntry];
    const auditFile = join(tmpDir, 'audit_log.json');
    writeFileSync(auditFile, JSON.stringify(updatedAudit));
    kv(['key', 'put', 'table:audit_log', '--path', auditFile]);
    console.log(`[repair] Wrote incident audit entry. table:audit_log ${auditLog.length} -> ${updatedAudit.length}.`);
  }

  // Correct only this one post record. Everything else in the array is
  // passed through completely unmodified.
  if (!alreadyRepaired) {
    const correctedPosts = posts.map(p => {
      if (p.id !== POST_ID) return p;
      const { published_at, ...rest } = p;
      return { ...rest, status: 'scheduled', updated_at: now };
    });
    const postsFile = join(tmpDir, 'posts.json');
    writeFileSync(postsFile, JSON.stringify(correctedPosts));
    kv(['key', 'put', 'table:posts', '--path', postsFile]);
    console.log('[repair] Corrected post status in table:posts.');
  }

  // 3. Verify.
  const verifyPosts = JSON.parse(kv(['key', 'get', 'table:posts']));
  const verifyAudit = JSON.parse(kv(['key', 'get', 'table:audit_log']));
  const verifyPost = verifyPosts.find(p => p.id === POST_ID);
  const verifyIncidentCount = verifyAudit.filter(e => e.id === INCIDENT_ID).length;

  console.log(`[repair] Verify: post status = ${verifyPost.status} (expect scheduled)`);
  console.log(`[repair] Verify: post publish_at unchanged = ${verifyPost.publish_at === post.publish_at}`);
  console.log(`[repair] Verify: incident audit entries = ${verifyIncidentCount} (expect exactly 1)`);
  console.log(`[repair] Verify: total posts still ${verifyPosts.length} (expect ${posts.length}, no rows added/removed)`);

  if (verifyPost.status !== 'scheduled' || verifyIncidentCount !== 1 || verifyPosts.length !== posts.length) {
    console.error('[repair] FAILED verification.');
    process.exit(1);
  }
  console.log('[repair] OK.');
}

main().catch(e => { console.error('[repair] FAILED:', e.message); process.exit(1); });
