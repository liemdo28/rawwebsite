import { VALID_PATHS } from './_validPaths.mjs';
import { NOT_FOUND_HTML } from './_notFoundPage.mjs';

const CANONICAL_HOST = 'www.rawsushibar.com';
const REDIRECT_HOSTS = new Set([
    'rawsushibar.com',
    'stockton.rawsushibar.com'
]);

export async function onRequest(context) {
    const url = new URL(context.request.url);
    const host = url.hostname.toLowerCase();

    if (REDIRECT_HOSTS.has(host)) {
        url.protocol = 'https:';
        url.hostname = CANONICAL_HOST;
        return Response.redirect(url.toString(), 301);
    }

    // _middleware.js runs on every path by default (Cloudflare Pages routes
    // Functions ahead of static assets), which silently disables Cloudflare
    // Pages' own "public/404.html exists -> return a real 404" auto-detection
    // for any unmatched path. context.env.ASSETS.fetch() can't be used to
    // fix this from inside a Function either — confirmed live (2026-07-28)
    // it applies the same SPA-fallback internally for BOTH existence checks
    // (never reports 404) and content fetches (ASSETS.fetch('/404.html')
    // returned the homepage's own body, not 404.html's). So real/unknown
    // paths are checked against _validPaths.mjs, and the 404 response body
    // is served from _notFoundPage.mjs — both generated straight from
    // public/ (see scripts/generate-valid-paths.mjs), with no dependency on
    // Cloudflare's fetch-from-inside-a-Function behavior at all.
    if (!url.pathname.startsWith('/api/') && !VALID_PATHS.has(url.pathname)) {
        return new Response(NOT_FOUND_HTML, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    return context.next();
}
