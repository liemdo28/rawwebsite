/**
 * tests/middleware.test.js — Unit tests for functions/_middleware.js.
 *
 * Cloudflare Pages routes Functions (including _middleware.js) ahead of
 * static assets by default, which silently disables the platform's own
 * "public/404.html exists -> real 404" auto-detection for any request that
 * falls through _middleware.js's context.next(). This caused every unknown
 * path — including not-yet-published campaign article slugs — to serve the
 * homepage with a false HTTP 200 (a soft 404). These tests verify the
 * explicit real-asset check added to close that gap.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';

function makeContext({ url, assetExists = true, homepageBody = 'HOMEPAGE', notFoundBody = 'NOT FOUND' }) {
  const request = new Request(url);
  return {
    request,
    env: {
      ASSETS: {
        fetch: async (input) => {
          const target = typeof input === 'string' ? input : input.url;
          if (target.endsWith('/404.html')) {
            return new Response(notFoundBody, { status: 200, headers: { 'Content-Type': 'text/html' } });
          }
          return assetExists
            ? new Response('OK', { status: 200 })
            : new Response('Not Found', { status: 404 });
        },
      },
    },
    next: async () => new Response(homepageBody, { status: 200, headers: { 'Content-Type': 'text/html' } }),
  };
}

test('_middleware: redirects non-canonical hosts to www without touching ASSETS', async () => {
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

test('_middleware: a real, existing page passes through unchanged on the canonical host', async () => {
  const context = makeContext({ url: 'https://www.rawsushibar.com/blog-sushi-etiquette.html', assetExists: true, homepageBody: 'REAL ARTICLE CONTENT' });
  const response = await onRequest(context);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'REAL ARTICLE CONTENT');
});

test('_middleware: an unknown path is served the real 404.html with a genuine 404 status, not the homepage', async () => {
  const context = makeContext({ url: 'https://www.rawsushibar.com/this-does-not-exist', assetExists: false, homepageBody: 'HOMEPAGE FALLBACK', notFoundBody: 'REAL 404 PAGE' });
  const response = await onRequest(context);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'REAL 404 PAGE');
});

test('_middleware: a not-yet-published campaign article slug returns a real 404, not a false 200', async () => {
  const context = makeContext({ url: 'https://www.rawsushibar.com/never-had-sushi-cooked-options-at-raw-sushi-bar-stockton.html', assetExists: false });
  const response = await onRequest(context);
  assert.equal(response.status, 404);
});

test('_middleware: /api/* routes are never redirected to the 404 page even if ASSETS reports missing', async () => {
  const context = makeContext({ url: 'https://www.rawsushibar.com/api/scheduler/run', assetExists: false, homepageBody: 'API RESPONSE' });
  const response = await onRequest(context);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'API RESPONSE');
});

test('_middleware: falls back to passing the response through if no ASSETS binding is present', async () => {
  const context = makeContext({ url: 'https://www.rawsushibar.com/anything' });
  delete context.env.ASSETS;
  const response = await onRequest(context);
  assert.equal(response.status, 200);
});
