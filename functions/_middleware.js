import { VALID_PATHS } from './_validPaths.mjs';

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
    // detect this from inside a Function either — it applies the same
    // SPA-fallback internally and returns 200 for missing paths too
    // (confirmed live: 2026-07-28). So real/unknown paths are instead
    // checked against _validPaths.mjs, a manifest generated straight from
    // public/'s actual file listing (see scripts/generate-valid-paths.mjs) —
    // no dependency on Cloudflare's fetch-from-inside-a-Function behavior.
    if (context.env.ASSETS && !url.pathname.startsWith('/api/') && !VALID_PATHS.has(url.pathname)) {
        const notFound = await context.env.ASSETS.fetch(new URL('/404.html', url).toString());
        return new Response(notFound.body, { status: 404, headers: notFound.headers });
    }

    return context.next();
}
