/**
 * tests/middleware.test.js — Unit tests for functions/_middleware.js.
 *
 * Cloudflare Pages routes Functions (including _middleware.js) ahead of
 * static assets by default, which silently disables the platform's own
 * "public/404.html exists -> real 404" auto-detection for any request that
 * falls through _middleware.js's context.next(). context.env.ASSETS.fetch()
 * cannot be used to detect this from inside a Function either — it applies
 * the same SPA-fallback internally, returning 200 for missing paths too
 * (confirmed live on 2026-07-28: two deploys using ASSETS.fetch() as the
 * existence check both failed to produce a real 404 for unknown paths).
 *
 * The fix instead checks the request path against functions/_validPaths.mjs,
 * a manifest generated straight from public/'s actual file listing (see
 * scripts/generate-valid-paths.mjs), with no dependency on any
 * Cloudflare-internal fetch behavior. These tests verify that check.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';
import { VALID_PATHS } from '../functions/_validPaths.mjs';

function makeContext({ url, hasAssets = true, notFoundBody = 'NOT FOUND', nextBody = 'NEXT() RESPONSE' }) {
  const request = new Request(url);
  const env = hasAssets
    ? {
        ASSETS: {
          fetch: async (input) => {
            const target = typeof input === 'string' ? input : input.url;
            if (target.endsWith('/404.html')) {
              return new Response(notFoundBody, { status: 200, headers: { 'Content-Type': 'text/html' } });
            }
            return new Response('OK', { status: 200 });
          },
        },
      }
    : {};
  return {
    request,
    env,
    next: async () => new Response(nextBody, { status: 200, headers: { 'Content-Type': 'text/html' } }),
  };
}

test('sanity: the generated manifest is non-empty and contains the homepage', () => {
  assert.ok(VALID_PATHS.size > 0);
  assert.ok(VALID_PATHS.has('/'));
});

test('_middleware: redirects non-canonical hosts to www without consulting the manifest', async () => {
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

test('_middleware: an unknown path is served the real 404.html with a genuine 404 status, not the homepage', async () => {
  const context = makeContext({ url: 'https://www.rawsushibar.com/this-does-not-exist', notFoundBody: 'REAL 404 PAGE' });
  const response = await onRequest(context);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'REAL 404 PAGE');
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

test('_middleware: falls back to passing the response through if no ASSETS binding is present', async () => {
  const context = makeContext({ url: 'https://www.rawsushibar.com/this-does-not-exist', hasAssets: false });
  const response = await onRequest(context);
  assert.equal(response.status, 200);
});
