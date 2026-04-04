/**
 * Raw Sushi Bar — Analytics & Event Tracking
 * GA4 Property: Replace G-XXXXXXXXXX with your actual GA4 Measurement ID
 */

// GA4 initialization
(function() {
    var GA_ID = 'G-XXXXXXXXXX'; // TODO: Replace with real GA4 Measurement ID

    // Load gtag.js
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);

    // Initialize dataLayer
    window.dataLayer = window.dataLayer || [];
    function gtag() { dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA_ID);
})();

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

    // Explicit data-track attribute
    if (track) {
        gtag('event', track, { link_text: text, link_url: href });
        return;
    }

    // Auto-detect: phone call clicks
    if (href.startsWith('tel:')) {
        gtag('event', 'call_click', {
            phone_number: href.replace('tel:', ''),
            link_text: text
        });
        return;
    }

    // Auto-detect: email clicks
    if (href.startsWith('mailto:')) {
        gtag('event', 'email_click', {
            email: href.replace('mailto:', ''),
            link_text: text
        });
        return;
    }

    // Auto-detect: external order links (Toast, DoorDash)
    if (href.indexOf('toasttab.com') !== -1) {
        gtag('event', 'order_click', { method: 'toast_online', link_text: text });
        return;
    }
    if (href.indexOf('doordash.com') !== -1) {
        gtag('event', 'order_click', { method: 'doordash', link_text: text });
        return;
    }

    // Auto-detect: Google Maps / directions
    if (href.indexOf('google.com/maps') !== -1) {
        gtag('event', 'directions_click', { link_text: text });
        return;
    }

    // Auto-detect: menu page views
    if (href.indexOf('menu-') !== -1 || href.indexOf('menu') !== -1) {
        gtag('event', 'menu_click', { link_text: text, link_url: href });
        return;
    }

    // Auto-detect: order page
    if (href.indexOf('order-sushi') !== -1) {
        gtag('event', 'order_page_click', { link_text: text });
        return;
    }
});

/**
 * Scroll engagement tracking
 * Fires once at 25%, 50%, 75%, 90% scroll depth
 */
(function() {
    var fired = {};
    window.addEventListener('scroll', function() {
        var h = document.documentElement.scrollHeight - window.innerHeight;
        if (h <= 0) return;
        var pct = Math.round((window.scrollY / h) * 100);
        [25, 50, 75, 90].forEach(function(threshold) {
            if (pct >= threshold && !fired[threshold]) {
                fired[threshold] = true;
                gtag('event', 'scroll_depth', { percent: threshold, page: location.pathname });
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
        gtag('event', 'email_signup', {
            form_location: form.closest('section') ?
                (form.closest('section').getAttribute('aria-label') || 'unknown') : 'unknown'
        });
    }
});
