/**
 * tests/phase2.test.js — Comprehensive tests for Phase 2 CMS modules.
 *
 * Covers:
 *   - Pages: CRUD, validation, state machine, version history, rollback
 *   - Theme: colors, fonts, navigation, CSS vars
 *   - SEO: meta, schema, robots.txt
 *   - Redirects: CRUD, validation, bulk import/export
 *   - Analytics: GA4, GTM, Cloudflare scripts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../lib/store.js';

// ============================================================================
// Pages
// ============================================================================

const { validatePage, transitionPage, saveVersion, listPageVersions, rollbackPage, PAGE_STATUSES } = await import('../lib/pages.js');

test('validatePage: rejects bad slug', () => {
  const r = validatePage({ title: 'About Us', slug: 'about', body: 'content' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('slug_invalid_must_start_with_slash'));
});

test('validatePage: accepts valid page', () => {
  const r = validatePage({ title: 'About Us', slug: '/about', body: 'Our story...' });
  assert.equal(r.ok, true);
});

test('transitionPage: enforces allowed transitions', async () => {
  const s = new MemoryStore();
  const row = await s.upsert('pages', { title: 'Home', slug: '/home', body: 'Welcome', status: 'draft' });
  const r1 = await transitionPage(s, row.id, 'pending_review', { actor: 'test' });
  assert.equal(r1.status, 'pending_review');
  await assert.rejects(
    () => transitionPage(s, row.id, 'published', { actor: 'test' }),
    /invalid_transition/
  );
});

test('saveVersion + listPageVersions: creates version history', async () => {
  const s = new MemoryStore();
  const page = await s.upsert('pages', { title: 'V1', slug: '/test', body: 'Body v1', status: 'draft' });
  await saveVersion(s, page, { actor: 'test' });
  // Small delay to ensure distinct timestamps
  await new Promise(r => setTimeout(r, 5));
  const page2 = await s.upsert('pages', { ...page, title: 'V2', body: 'Body v2' });
  await saveVersion(s, page2, { actor: 'test' });
  const versions = await listPageVersions(s, page.id);
  assert.equal(versions.length, 2);
  // Versions sorted by created_at descending (newest first)
  const titles = versions.map(v => v.title);
  assert.ok(titles.includes('V1'));
  assert.ok(titles.includes('V2'));
  assert.equal(versions[0].title, 'V2'); // Most recent
});

test('rollbackPage: restores previous version', async () => {
  const s = new MemoryStore();
  const page = await s.upsert('pages', { title: 'Original', slug: '/rollback-test', body: 'Original body', status: 'draft' });
  const ver1 = await saveVersion(s, page, { actor: 'test' });
  await s.upsert('pages', { ...page, title: 'Modified', body: 'Modified body' });
  const restored = await rollbackPage(s, page.id, ver1.id, { actor: 'admin' });
  assert.equal(restored.title, 'Original');
  assert.equal(restored.body, 'Original body');
});

test('PAGE_STATUSES: contains all expected states', () => {
  for (const s of ['draft', 'pending_review', 'approved', 'scheduled', 'published', 'rejected', 'failed']) {
    assert.ok(PAGE_STATUSES.includes(s));
  }
});

// ============================================================================
// Theme
// ============================================================================

const { getTheme, saveTheme, updateColors, updateNavigation, themeToCSSVars, DEFAULT_THEME } = await import('../lib/theme.js');

test('getTheme: returns default theme on empty store', async () => {
  const s = new MemoryStore();
  const theme = await getTheme(s);
  assert.equal(theme.colors.primary, DEFAULT_THEME.colors.primary);
});

test('saveTheme: persists and merges theme', async () => {
  const s = new MemoryStore();
  await saveTheme(s, { colors: { primary: '#ff0000' } }, { actor: 'test' });
  const theme = await getTheme(s);
  assert.equal(theme.colors.primary, '#ff0000');
  assert.equal(theme.colors.secondary, DEFAULT_THEME.colors.secondary); // Preserved
});

test('updateColors: updates only colors', async () => {
  const s = new MemoryStore();
  await updateColors(s, { accent: '#00ff00' }, { actor: 'test' });
  const theme = await getTheme(s);
  assert.equal(theme.colors.accent, '#00ff00');
});

test('updateNavigation: replaces navigation array', async () => {
  const s = new MemoryStore();
  const nav = [{ label: 'Home', href: '/', location: 'header', order: 0, active: true }];
  await updateNavigation(s, nav, { actor: 'test' });
  const theme = await getTheme(s);
  assert.equal(theme.navigation.length, 1);
  assert.equal(theme.navigation[0].label, 'Home');
});

test('themeToCSSVars: generates valid CSS', () => {
  const css = themeToCSSVars(DEFAULT_THEME);
  assert.ok(css.includes(':root'));
  assert.ok(css.includes('--color-primary'));
  assert.ok(css.includes('--font-heading'));
});

// ============================================================================
// SEO
// ============================================================================

const { getSeo, saveSeo, buildRestaurantSchema, buildRobotsTxt, DEFAULT_SEO } = await import('../lib/seo.js');

test('getSeo: returns default on empty store', async () => {
  const s = new MemoryStore();
  const seo = await getSeo(s);
  assert.equal(seo.site_name, DEFAULT_SEO.site_name);
});

test('saveSeo: persists and merges settings', async () => {
  const s = new MemoryStore();
  await saveSeo(s, { meta_title: 'Custom Title' }, { actor: 'test' });
  const seo = await getSeo(s);
  assert.equal(seo.meta_title, 'Custom Title');
  assert.equal(seo.site_name, DEFAULT_SEO.site_name); // Preserved
});

test('buildRestaurantSchema: produces valid JSON-LD', () => {
  const schema = buildRestaurantSchema(DEFAULT_SEO);
  assert.equal(schema['@context'], 'https://schema.org');
  assert.equal(schema['@type'], 'Restaurant');
  assert.equal(schema.name, 'Raw Sushi Bar');
});

test('buildRobotsTxt: produces valid robots.txt', () => {
  const robots = buildRobotsTxt(DEFAULT_SEO);
  assert.ok(robots.includes('User-agent: *'));
  assert.ok(robots.includes('Sitemap:'));
});

// ============================================================================
// Redirects
// ============================================================================

const { validateRedirect, upsertRedirect, bulkImportCsv, exportCsv, listActiveRedirects } = await import('../lib/redirects.js');

test('validateRedirect: rejects invalid from_path', () => {
  const r = validateRedirect({ from_path: 'no-slash', to_url: '/new' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('from_path')));
});

test('validateRedirect: accepts valid redirect', () => {
  const r = validateRedirect({ from_path: '/old', to_url: '/new', type: '301' });
  assert.equal(r.ok, true);
});

test('upsertRedirect: creates redirect', async () => {
  const s = new MemoryStore();
  const red = await upsertRedirect(s, { from_path: '/old-page', to_url: '/new-page' }, { actor: 'test' });
  assert.ok(red.id);
  assert.equal(red.type, '301');
  assert.equal(red.active, true);
});

test('bulkImportCsv: imports redirects from CSV', async () => {
  const s = new MemoryStore();
  const csv = `/a,/b,301
/c,/d,302,note here`;
  const result = await bulkImportCsv(s, csv, { actor: 'test' });
  assert.equal(result.created, 2);
  assert.equal(result.errors.length, 0);
  const rows = await s.list('redirects');
  assert.equal(rows.length, 2);
});

test('exportCsv: exports redirects to CSV', async () => {
  const s = new MemoryStore();
  await upsertRedirect(s, { from_path: '/export-test', to_url: '/target' }, { actor: 'test' });
  const csv = await exportCsv(s);
  assert.ok(csv.includes('from_path,to_url'));
  assert.ok(csv.includes('/export-test'));
});

test('listActiveRedirects: filters inactive', async () => {
  const s = new MemoryStore();
  await upsertRedirect(s, { from_path: '/active', to_url: '/a', active: true }, { actor: 'test' });
  await upsertRedirect(s, { from_path: '/inactive', to_url: '/b', active: false }, { actor: 'test' });
  const active = await listActiveRedirects(s);
  assert.equal(active.length, 1);
  assert.equal(active[0].from_path, '/active');
});

// ============================================================================
// Analytics
// ============================================================================

const { getAnalytics, saveAnalytics, buildGAScript, buildGTMScript, buildCFAnalyticsScript, DEFAULT_ANALYTICS } = await import('../lib/analytics.js');

test('getAnalytics: returns default on empty store', async () => {
  const s = new MemoryStore();
  const analytics = await getAnalytics(s);
  assert.equal(analytics.google_analytics.enabled, false);
});

test('saveAnalytics: persists and merges settings', async () => {
  const s = new MemoryStore();
  await saveAnalytics(s, { google_analytics: { enabled: true, measurement_id: 'G-TEST123' } }, { actor: 'test' });
  const analytics = await getAnalytics(s);
  assert.equal(analytics.google_analytics.enabled, true);
  assert.equal(analytics.google_analytics.measurement_id, 'G-TEST123');
});

test('buildGAScript: generates GA4 script when enabled', () => {
  const analytics = {
    ...DEFAULT_ANALYTICS,
    google_analytics: { enabled: true, measurement_id: 'G-ABCDEF', enabled_for: ['production'] },
  };
  const script = buildGAScript(analytics, 'production');
  assert.ok(script.includes('G-ABCDEF'));
  assert.ok(script.includes('googletagmanager.com/gtag'));
});

test('buildGAScript: returns empty when disabled', () => {
  const script = buildGAScript(DEFAULT_ANALYTICS, 'production');
  assert.equal(script, '');
});

test('buildGTMScript: generates GTM script when enabled', () => {
  const analytics = {
    ...DEFAULT_ANALYTICS,
    google_tag_manager: { enabled: true, container_id: 'GTM-TESTID' },
  };
  const script = buildGTMScript(analytics);
  assert.ok(script.includes('GTM-TESTID'));
});

test('buildCFAnalyticsScript: generates CF script when token provided', () => {
  const analytics = {
    ...DEFAULT_ANALYTICS,
    cloudflare_analytics: { enabled: true, token: 'cf-token-123' },
  };
  const script = buildCFAnalyticsScript(analytics);
  assert.ok(script.includes('cf-token-123'));
});

// ============================================================================
// Extended store tables
// ============================================================================

test('MemoryStore: supports new Phase 2 tables', async () => {
  const s = new MemoryStore();
  // Pages
  const page = await s.upsert('pages', { title: 'Test', slug: '/test', body: 'Body' });
  assert.ok(page.id);
  // Site settings
  const setting = await s.upsert('site_settings', { key: 'test', value: 'value' });
  assert.ok(setting.id);
  // Redirects
  const redirect = await s.upsert('redirects', { from_path: '/x', to_url: '/y' });
  assert.ok(redirect.id);
  // Page versions
  const version = await s.upsert('page_versions', { page_id: page.id, title: 'V1' });
  assert.ok(version.id);
});

// ============================================================================
// Updated JOB_COMMANDS
// ============================================================================

const { JOB_COMMANDS } = await import('../lib/jobs.js');

test('JOB_COMMANDS: includes Phase 2 commands', () => {
  const phase2Commands = [
    'page.create', 'page.update', 'page.approve', 'page.reject', 'page.publish', 'page.rollback',
    'theme.update', 'seo.update', 'redirect.create', 'redirect.bulk_import', 'analytics.update',
  ];
  for (const cmd of phase2Commands) {
    assert.ok(JOB_COMMANDS.includes(cmd), `Missing command: ${cmd}`);
  }
});
