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
    // returned the homepage's own body, not 404.html's).
    //
    // Only PAGE-shaped requests are checked against _validPaths.mjs — a
    // request ending in .html, or with no file extension at all (a clean
    // article/section URL like /menu/stockton/). Anything else (a path with
    // a non-.html extension: .js, .css, .webp, .xml, .txt, .json, fonts,
    // etc.) is a real static-asset request and is passed straight through
    // to Cloudflare's own asset resolution untouched — _validPaths.mjs is
    // generated only from public/'s .html files (see
    // scripts/generate-valid-paths.mjs) and was never meant to be an
    // exhaustive manifest of every asset on the site. Gating ALL paths
    // against it (the original 2026-07-28 soft-404 fix) silently 404'd
    // every CSS/JS/image/robots.txt/sitemap.xml request in production —
    // found during the 2026-07-28 deployment-routing incident follow-up.
    const isPageShapedRequest = !url.pathname.startsWith('/api/') &&
        (url.pathname.endsWith('.html') || !/\.[a-z0-9]+$/i.test(url.pathname));

    if (isPageShapedRequest && !VALID_PATHS.has(url.pathname)) {
        return new Response(NOT_FOUND_HTML, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    return context.next();
}
