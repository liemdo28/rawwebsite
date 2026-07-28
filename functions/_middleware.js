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

    const response = await context.next();

    // _middleware.js runs on every path by default (Cloudflare Pages routes
    // Functions ahead of static assets), which silently disables Cloudflare
    // Pages' own "public/404.html exists -> return a real 404" auto-detection
    // for any path that falls through to context.next() with no matching
    // route or asset. Without this, an unknown path (including a
    // not-yet-published article slug) served the homepage with a false
    // HTTP 200 instead of a real 404. Only API/function routes and real
    // static assets should ever reach here with a non-404; anything else
    // that resolves to a 200 for a path outside those is the SPA-fallback,
    // so explicitly serve the real 404 page for it.
    if (response.status === 200 && !url.pathname.startsWith('/api/')) {
        const isRealAsset = context.env.ASSETS
            ? (await context.env.ASSETS.fetch(new Request(url.toString(), { method: 'HEAD' }))).status !== 404
            : true;
        if (!isRealAsset) {
            const notFound = await context.env.ASSETS.fetch(new URL('/404.html', url).toString());
            return new Response(notFound.body, { status: 404, headers: notFound.headers });
        }
    }

    return response;
}
