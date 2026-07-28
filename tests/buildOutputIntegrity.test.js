/**
 * tests/buildOutputIntegrity.test.js — Deployment gate: fails the build
 * before it ever reaches Cloudflare if the actual deployed output
 * (dist/, matching this project's pages_build_output_dir) doesn't contain
 * what the campaign/publication source of truth says it should.
 *
 * 2026-07-28 deployment-routing incident: the Cloudflare Pages project had
 * an empty build command and a conflicting wrangler.jsonc, so Cloudflare
 * was silently deploying the raw repository root (350 loose files) instead
 * of running `npm run build` and deploying dist/ — meaning every campaign
 * article published via commitToGit() (which only ever wrote to
 * public/<slug>.html) was invisible in Production, serving the homepage
 * via Cloudflare's SPA-fallback instead. Separately, the soft-404 fix's
 * _validPaths.mjs manifest (see routing.test.js) only ever indexed .html
 * files, so _middleware.js was also silently 404ing every non-.html static
 * asset (JS, CSS, images, sitemap.xml, robots.txt) in Production.
 *
 * These tests run the real production build (npm run build) and check the
 * actual dist/ output — not public/ or KV — against the committed campaign
 * dataset, so a future regression in either the build pipeline or the
 * deployment configuration is caught locally before it ever reaches
 * Production. No live Production KV access is used or required.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');

before(() => {
  execFileSync(process.execPath, ['build.mjs'], { cwd: ROOT, stdio: 'pipe' });
});

test('build output: dist/ was actually produced', () => {
  assert.ok(existsSync(join(DIST, 'index.html')), 'expected npm run build to produce dist/index.html');
});

test('build output: no conflicting Wrangler configuration files exist (exactly one authoritative config)', () => {
  assert.ok(!existsSync(join(ROOT, 'wrangler.jsonc')), 'wrangler.jsonc must not exist — it silently overrides wrangler.toml\'s pages_build_output_dir and caused the 2026-07-28 deployment-routing incident (Cloudflare deployed repo root instead of dist/)');
  assert.ok(!existsSync(join(ROOT, 'wrangler.json')), 'wrangler.json must not exist for the same reason');
  const wranglerToml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
  assert.match(wranglerToml, /pages_build_output_dir\s*=\s*"dist"/, 'wrangler.toml must declare dist as the Pages build output directory');
});

test('build output: every already-published campaign article has real HTML in dist/', async () => {
  const { campaign } = await import('../content/campaign/seo-30-article-campaign.mjs');
  // "Already published" per the committed source of truth: a public/<slug>.html
  // file exists (this is what commitToGit() creates on real publish — see
  // lib/gitPublish.js). Not-yet-published articles correctly have no file yet.
  const published = campaign.filter(a => existsSync(join(ROOT, 'public', `${a.slug}.html`)));
  assert.ok(published.length > 0, 'sanity check: expected at least one published campaign article (article #1)');
  for (const a of published) {
    const distPath = join(DIST, `${a.slug}.html`);
    assert.ok(existsSync(distPath), `published article ${a.slug} is missing from dist/ — it would 404 or fall back to the homepage in Production`);
    const distHtml = readFileSync(distPath, 'utf8');
    assert.match(distHtml, new RegExp(`<title>${escapeRegExp(a.title)}`), `dist/${a.slug}.html does not contain the expected title for ${a.slug}`);
    assert.match(distHtml, new RegExp(`<link rel="canonical" href="https://www\\.rawsushibar\\.com/${escapeRegExp(a.slug)}\\.html">`), `dist/${a.slug}.html is missing its own correct canonical URL`);
  }
});

test('build output: every already-published campaign article\'s canonical URL is in dist/sitemap.xml exactly once', async () => {
  const { campaign } = await import('../content/campaign/seo-30-article-campaign.mjs');
  const published = campaign.filter(a => existsSync(join(ROOT, 'public', `${a.slug}.html`)));
  const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
  for (const a of published) {
    const url = `https://www.rawsushibar.com/${a.slug}.html`;
    const count = (sitemap.match(new RegExp(`<loc>${escapeRegExp(url)}</loc>`, 'g')) || []).length;
    assert.equal(count, 1, `expected exactly one sitemap entry for ${a.slug}, found ${count}`);
  }
});

test('build output: every campaign hero image referenced by an already-published article exists in dist/', async () => {
  const { campaign } = await import('../content/campaign/seo-30-article-campaign.mjs');
  const published = campaign.filter(a => existsSync(join(ROOT, 'public', `${a.slug}.html`)));
  for (const a of published) {
    const imgPath = join(DIST, 'images', a.image);
    assert.ok(existsSync(imgPath), `dist/images/${a.image} is missing for published article ${a.slug}`);
  }
});

test('build output: functions/_validPaths.mjs entries for published campaign articles actually exist in dist/', async () => {
  const { VALID_PATHS } = await import('../functions/_validPaths.mjs');
  const { campaign } = await import('../content/campaign/seo-30-article-campaign.mjs');
  const published = campaign.filter(a => existsSync(join(ROOT, 'public', `${a.slug}.html`)));
  for (const a of published) {
    assert.ok(VALID_PATHS.has(`/${a.slug}.html`), `${a.slug}.html is missing from the valid-paths manifest despite being published`);
    assert.ok(existsSync(join(DIST, `${a.slug}.html`)), `${a.slug}.html is in the valid-paths manifest but missing from dist/ — the manifest and the actual output have drifted`);
  }
});

test('build output: dist/ contains functions/_middleware.js and it only gates .html/extensionless page requests, not real static assets', () => {
  const middlewareSrc = readFileSync(join(DIST, 'functions', '_middleware.js'), 'utf8');
  assert.match(middlewareSrc, /isPageShapedRequest/, 'the deployed middleware must use the page-shaped-request check, not gate every path — gating every path 404s all non-.html static assets (JS/CSS/images/sitemap.xml/robots.txt), the 2026-07-28 asset-gating regression');
});

test('build output: dist/ contains the standard static assets that must never be gated by the page-routing manifest', () => {
  for (const asset of ['sitemap.xml', 'robots.txt', 'analytics.js']) {
    assert.ok(existsSync(join(DIST, asset)), `dist/${asset} must exist`);
  }
});

test('build output: no campaign article is duplicated as a root-level loose file (drift between root/public/dist)', async () => {
  const { campaign } = await import('../content/campaign/seo-30-article-campaign.mjs');
  const rootHtmlFiles = new Set(readdirSync(ROOT).filter(f => f.endsWith('.html')));
  const collisions = campaign.map(a => `${a.slug}.html`).filter(f => rootHtmlFiles.has(f));
  assert.deepEqual(collisions, [], `campaign article(s) found duplicated as a root-level file, which is not deployed by dist/ and risks drift: ${collisions.join(', ')}`);
});

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
