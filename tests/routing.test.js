/**
 * tests/routing.test.js — Static-routing structure checks.
 *
 * Cloudflare Pages defaults to SPA-fallback (serve index.html with HTTP 200
 * for any unmatched path) unless a public/404.html file exists at the site
 * root — see https://developers.cloudflare.com/pages/configuration/serving-pages/.
 * Before this fix, every unknown path — including not-yet-published campaign
 * article slugs — returned the homepage with a false HTTP 200 (a soft 404),
 * which is exactly the "internal link to unpublished content" failure mode
 * this campaign's link-validation tests guard against.
 *
 * The actual redirect/404 status-code behavior is Cloudflare Pages platform
 * behavior, not something this repo's code implements — it can't be
 * meaningfully unit-tested offline (no real network calls in this suite, by
 * existing convention). These tests check the structural precondition
 * (public/404.html exists, is a real page, is noindex) and document what
 * must be verified live after each deploy.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PUBLIC = join(ROOT, 'public');

test('routing: public/404.html exists at the site root (disables Cloudflare Pages SPA-fallback)', () => {
  assert.ok(existsSync(join(PUBLIC, '404.html')), 'public/404.html must exist so unknown paths return a real 404 instead of the homepage with HTTP 200');
});

test('routing: 404.html is a real, distinct page — not a copy of the homepage', () => {
  const notFound = readFileSync(join(PUBLIC, '404.html'), 'utf8');
  const homepage = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
  assert.notEqual(notFound, homepage);
  assert.match(notFound, /<title>[^<]*Not Found[^<]*<\/title>/i);
});

test('routing: 404.html is marked noindex so it is never indexed by search engines', () => {
  const notFound = readFileSync(join(PUBLIC, '404.html'), 'utf8');
  assert.match(notFound, /name="robots" content="[^"]*noindex/i);
});

test('routing: 404.html links back to the homepage so visitors are not stranded', () => {
  const notFound = readFileSync(join(PUBLIC, '404.html'), 'utf8');
  assert.match(notFound, /href="\/"/);
});

test('routing: no campaign article was left as a stray root-level duplicate (the 2026-07-28 root/public artifact incident)', async () => {
  // Scoped to campaign article slugs specifically — NOT the pre-existing,
  // separately-tracked root/public duplication covered by
  // scripts/check-duplicates.mjs (out of scope here; those predate this
  // campaign and are a known, already-flagged issue).
  const { campaign } = await import('../content/campaign/seo-30-article-campaign.mjs');
  const rootHtmlFiles = new Set(readdirSync(ROOT).filter(f => f.endsWith('.html')));
  const collisions = campaign
    .map(a => `${a.slug}.html`)
    .filter(f => rootHtmlFiles.has(f));
  assert.deepEqual(collisions, [], `Campaign article(s) found duplicated as a root-level file (never deployed, drift risk): ${collisions.join(', ')}`);
});
