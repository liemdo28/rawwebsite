/**
 * tests/middleware.test.js — Unit tests for functions/_middleware.js.
 *
 * Cloudflare Pages routes Functions (including _middleware.js) ahead of
 * static assets by default, which silently disables the platform's own
 * "public/404.html exists -> real 404" auto-detection for any request that
 * falls through _middleware.js's context.next(). context.env.ASSETS.fetch()
 * cannot be used to work around this from inside a Function either —
 * confirmed live (2026-07-28) it applies the same SPA-fallback internally
 * for BOTH existence checks (status was never 404 for a missing path) and
 * content fetches (ASSETS.fetch('/404.html') returned the homepage's own
 * body, not 404.html's, even though public/404.html is a real file). So
 * _middleware.js no longer calls ASSETS.fetch at all — both the path-exists
 * check (VALID_PATHS) and the 404 response body (NOT_FOUND_HTML) are
 * self-contained manifests generated straight from public/ (see
 * scripts/generate-valid-paths.mjs). These tests verify that check.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';
import { VALID_PATHS } from '../functions/_validPaths.mjs';
import { NOT_FOUND_HTML } from '../functions/_notFoundPage.mjs';

function makeContext({ url, nextBody = 'NEXT() RESPONSE' }) {
  const request = new Request(url);
  return {
    request,
    env: {},
    next: async () => new Response(nextBody, { status: 200, headers: { 'Content-Type': 'text/html' } }),
  };
}

test('sanity: the generated manifest is non-empty and contains the homepage', () => {
  assert.ok(VALID_PATHS.size > 0);
  assert.ok(VALID_PATHS.has('/'));
});

test('sanity: the generated 404 body is non-empty and distinct from a homepage response', () => {
  assert.ok(NOT_FOUND_HTML.length > 0);
  assert.match(NOT_FOUND_HTML, /Page Not Found/);
});

test('_middleware: redirects non-canonical hosts to www without touching routing checks', async () => {
  const context = makeContext({ url: 'https://rawsushibar.com/some-page' });
  const response = await onRequest(context);
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), 'https://www.rawsushibar.com/some-page');
});

test('_middleware: redirects stockton.rawsushibar.com to www', async () => {
  const context = makeContext({ url: 'https://stockton.rawsushibar.com/menu' });
  const response = await onRequest(context);
  assert.equal(response.status, 301);
  assert.match(response.headers.get('location'), /^https:\/\/www\.rawsushibar\.com\/menu/);
});

test('_middleware: the homepage passes through to next()', async () => {
  const context = makeContext({ url: 'https://www.rawsushibar.com/' });
  const response = await onRequest(context);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'NEXT() RESPONSE');
});

test('_middleware: a real, published page (present in the manifest) passes through unchanged', async () => {
  const knownPath = [...VALID_PATHS].find(p => p !== '/' && p.endsWith('.html'));
  assert.ok(knownPath, 'expected at least one known .html path in the manifest for this test to be meaningful');
  const context = makeContext({ url: `https://www.rawsushibar.com${knownPath}` });
  const response = await onRequest(context);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'NEXT() RESPONSE');
});

test('_middleware: an unknown path is served the real, inlined 404 body with a genuine 404 status, not the homepage', async () => {
  const context = makeContext({ url: 'https://www.rawsushibar.com/this-does-not-exist' });
  const response = await onRequest(context);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), NOT_FOUND_HTML);
});

test('_middleware: a not-yet-published campaign article slug returns a real 404, not a false 200', async () => {
  const unpublishedSlug = '/never-had-sushi-cooked-options-at-raw-sushi-bar-stockton.html';
  assert.ok(!VALID_PATHS.has(unpublishedSlug), 'precondition: this slug must not yet be published for the test to be meaningful');
  const context = makeContext({ url: `https://www.rawsushibar.com${unpublishedSlug}` });
  const response = await onRequest(context);
  assert.equal(response.status, 404);
});

test('_middleware: /api/* routes are never redirected to the 404 page, even when not in the manifest', async () => {
  const context = makeContext({ url: 'https://www.rawsushibar.com/api/scheduler/run' });
  const response = await onRequest(context);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'NEXT() RESPONSE');
});

/**
 * 2026-07-28 deployment-routing incident follow-up: VALID_PATHS is
 * generated only from public/'s .html files (see
 * scripts/generate-valid-paths.mjs) and was never meant to be an
 * exhaustive manifest of every static asset. Gating every request against
 * it — the original soft-404 fix — silently 404'd every CSS/JS/image/
 * sitemap.xml/robots.txt request in Production, since none of those are
 * (or should be) present in VALID_PATHS. Only page-shaped requests (a
 * .html path, or an extensionless clean-URL path) are gated; anything with
 * a non-.html file extension passes straight through to Cloudflare's own
 * static-asset resolution.
 */
test('_middleware: a path with a non-.html extension (a real static asset) is never gated by VALID_PATHS, even when absent from the manifest', async () => {
  assert.ok(!VALID_PATHS.has('/analytics.js'), 'precondition: asset paths are never added to VALID_PATHS');
  const context = makeContext({ url: 'https://www.rawsushibar.com/analytics.js' });
  const response = await onRequest(context);
  assert.equal(response.status, 200, 'a real static asset must never be 404\'d by the page-routing manifest');
  assert.equal(await response.text(), 'NEXT() RESPONSE');
});

test('_middleware: sitemap.xml and robots.txt pass through untouched, not gated as page-shaped requests', async () => {
  for (const path of ['/sitemap.xml', '/robots.txt']) {
    const context = makeContext({ url: `https://www.rawsushibar.com${path}` });
    const response = await onRequest(context);
    assert.equal(response.status, 200, `${path} must pass through to Cloudflare's asset resolution, not be gated`);
  }
});

test('_middleware: an unknown extensionless path is still correctly gated and returns a real 404 (page-shaped detection still applies)', async () => {
  const context = makeContext({ url: 'https://www.rawsushibar.com/this-page-does-not-exist-at-all' });
  const response = await onRequest(context);
  assert.equal(response.status, 404);
});
