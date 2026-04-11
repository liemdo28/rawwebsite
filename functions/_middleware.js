const CANONICAL_HOST = 'www.rawsushibar.com';
const REDIRECT_HOSTS = new Set([
    'rawsushibar.com',
    'stockton.rawsushibar.com'
]);

export function onRequest(context) {
    const url = new URL(context.request.url);
    const host = url.hostname.toLowerCase();

    if (REDIRECT_HOSTS.has(host)) {
        url.protocol = 'https:';
        url.hostname = CANONICAL_HOST;
        return Response.redirect(url.toString(), 301);
    }

    return context.next();
}
