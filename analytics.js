/**
 * Raw Sushi Bar — Analytics & Event Tracking
 * Replace `gaId` with the live GA4 Measurement ID before launch.
 */

var RAW_SUSHI_CONFIG = window.RAW_SUSHI_CONFIG || {
    gaId: 'G-XXXXXXXXXX',
    canonicalHost: 'www.rawsushibar.com'
};

window.dataLayer = window.dataLayer || [];
function gtag() {
    window.dataLayer.push(arguments);
}
window.gtag = window.gtag || gtag;

function trackEvent(name, params) {
    if (typeof window.gtag !== 'function' || !window.__rawSushiAnalyticsReady) {
        return;
    }
    window.gtag('event', name, params);
}

// Canonical host redirect: apex/subdomain -> www.rawsushibar.com
(function() {
    var host = location.hostname.toLowerCase();
    if (host === 'rawsushibar.com' || host === 'stockton.rawsushibar.com') {
        location.replace('https://' + RAW_SUSHI_CONFIG.canonicalHost + location.pathname + location.search + location.hash);
    }
})();

// GA4 initialization
(function() {
    var GA_ID = RAW_SUSHI_CONFIG.gaId;
    var hasValidGaId = /^G-[A-Z0-9]+$/i.test(GA_ID) && GA_ID !== 'G-XXXXXXXXXX';

    if (!hasValidGaId) {
        console.warn('Raw Sushi Bar analytics disabled: set RAW_SUSHI_CONFIG.gaId to the live GA4 Measurement ID.');
        return;
    }

    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);

    gtag('js', new Date());
    gtag('config', GA_ID, {
        page_path: location.pathname,
        page_title: document.title
    });
    window.__rawSushiAnalyticsReady = true;
})();

/**
 * Detect location context from page URL or phone number
 */
function getLocationContext() {
    var path = location.pathname;
    if (path.indexOf('modesto') !== -1) return 'modesto';
    if (path.indexOf('stockton') !== -1) return 'stockton';
    if (path === '/' || path.indexOf('index') !== -1) return 'brand';
    return 'unknown';
}

function getLocationFromPhone(phone) {
    if (phone.indexOf('5669560') !== -1) return 'modesto';
    if (phone.indexOf('9549729') !== -1) return 'stockton';
    return getLocationContext();
}

/**
 * Detect page type from URL
 */
function getPageType() {
    var path = location.pathname;
    if (path.indexOf('menu-') !== -1) return 'menu';
    if (path.indexOf('order-') !== -1) return 'order';
    if (path.indexOf('blog-') !== -1) return 'blog';
    if (path === '/' || path.indexOf('index') !== -1) return 'brand_home';
    if (path.indexOf('modesto') !== -1 && path.indexOf('menu') === -1) return 'landing';
    return 'page';
}

/**
 * Track CTA clicks across the site
 * Listens for clicks on links/buttons with data-track attributes
 * and common action patterns (tel:, order, reserve)
 */
document.addEventListener('click', function(e) {
    var el = e.target.closest('a, button');
    if (!el) return;

    var href = el.getAttribute('href') || '';
    var track = el.getAttribute('data-track');
    var text = (el.textContent || '').trim().substring(0, 50);
    var loc = getLocationContext();
    var pageType = getPageType();

    // Explicit data-track attribute
    if (track) {
        trackEvent(track, { link_text: text, link_url: href, location: loc, page_type: pageType });
        return;
    }

    // Auto-detect: phone call clicks
    if (href.startsWith('tel:')) {
        var phone = href.replace('tel:', '');
        trackEvent('call_click', {
            phone_number: phone,
            link_text: text,
            location: getLocationFromPhone(phone),
            page_type: pageType
        });
        return;
    }

    // Auto-detect: email clicks
    if (href.startsWith('mailto:')) {
        trackEvent('email_click', {
            email: href.replace('mailto:', ''),
            link_text: text,
            location: loc,
            page_type: pageType
        });
        return;
    }

    // Auto-detect: external order links (Toast, DoorDash)
    if (href.indexOf('toasttab.com') !== -1) {
        trackEvent('order_click', { method: 'toast_online', link_text: text, location: loc, page_type: pageType });
        return;
    }
    if (href.indexOf('doordash.com') !== -1) {
        trackEvent('order_click', { method: 'doordash', link_text: text, location: loc, page_type: pageType });
        return;
    }

    // Auto-detect: Google Maps / directions
    if (href.indexOf('google.com/maps') !== -1) {
        trackEvent('directions_click', { link_text: text, location: loc, page_type: pageType });
        return;
    }

    // Auto-detect: menu page views
    if (href.indexOf('menu-') !== -1 || href.indexOf('menu') !== -1) {
        var menuLoc = href.indexOf('modesto') !== -1 ? 'modesto' : href.indexOf('stockton') !== -1 ? 'stockton' : loc;
        trackEvent('menu_click', { link_text: text, link_url: href, location: menuLoc, page_type: pageType });
        return;
    }

    // Auto-detect: order page
    if (href.indexOf('order-sushi') !== -1) {
        trackEvent('order_page_click', { link_text: text, location: loc, page_type: pageType });
        return;
    }
});

/**
 * Scroll engagement tracking
 * Fires once at 25%, 50%, 75%, 90% scroll depth
 */
(function() {
    var fired = {};
    var loc = getLocationContext();
    var pageType = getPageType();
    window.addEventListener('scroll', function() {
        var h = document.documentElement.scrollHeight - window.innerHeight;
        if (h <= 0) return;
        var pct = Math.round((window.scrollY / h) * 100);
        [25, 50, 75, 90].forEach(function(threshold) {
            if (pct >= threshold && !fired[threshold]) {
                fired[threshold] = true;
                trackEvent('scroll_depth', { percent: threshold, page: location.pathname, location: loc, page_type: pageType });
            }
        });
    });
})();

/**
 * Track form submissions (newsletter, lead popup)
 */
document.addEventListener('submit', function(e) {
    var form = e.target;
    if (form.querySelector('input[type="email"]')) {
        var payload = {
            form_location: form.closest('section') ?
                (form.closest('section').getAttribute('aria-label') || 'unknown') : 'unknown',
            location: getLocationContext(),
            page_type: getPageType()
        };
        trackEvent('lead_submit', payload);
        trackEvent('email_signup', payload);
    }
});
