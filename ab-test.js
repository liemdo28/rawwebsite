/**
 * Raw Sushi Bar — A/B Test Framework
 *
 * Variants:
 *   A — Current Clean CTA Version (default visible elements)
 *   B — Revenue Push (top promo banner, stronger Order CTA, story CTA)
 *   C — Location First (alt hero with Stockton/Modesto chooser)
 *
 * Persistence: localStorage key "raw_ab_variant"
 * Override:    ?ab=A|B|C in URL forces variant (and persists)
 * Tracking:    pushes events to GA4 (window.gtag) + console.log + sendBeacon to /api/ab-events
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'raw_ab_variant';
    var SPLIT = { A: 0.34, B: 0.33, C: 0.33 }; // sums to 1.0

    function getVariant() {
        // 1. URL override (for QA): ?ab=A|B|C
        try {
            var url = new URL(window.location.href);
            var override = (url.searchParams.get('ab') || '').toUpperCase();
            if (override === 'A' || override === 'B' || override === 'C') {
                localStorage.setItem(STORAGE_KEY, override);
                return override;
            }
        } catch (e) { /* ignore */ }

        // 2. Returning visitor: read saved variant
        try {
            var existing = localStorage.getItem(STORAGE_KEY);
            if (existing === 'A' || existing === 'B' || existing === 'C') {
                return existing;
            }
        } catch (e) { /* ignore */ }

        // 3. New visitor: assign by traffic split
        var r = Math.random();
        var v = 'A';
        if (r < SPLIT.A) v = 'A';
        else if (r < SPLIT.A + SPLIT.B) v = 'B';
        else v = 'C';

        try { localStorage.setItem(STORAGE_KEY, v); } catch (e) { /* ignore */ }
        return v;
    }

    function trackEvent(eventName, payload) {
        payload = payload || {};
        var event = {
            event: eventName,
            variant: window.__rawAbVariant || 'unknown',
            path: window.location.pathname,
            timestamp: new Date().toISOString()
        };
        Object.keys(payload).forEach(function (k) { event[k] = payload[k]; });

        // 1. Console (always — useful for QA)
        try { console.log('AB_EVENT', event); } catch (e) { /* ignore */ }

        // 2. GA4 via gtag (primary signal)
        try {
            if (typeof window.gtag === 'function') {
                window.gtag('event', eventName, event);
            }
        } catch (e) { /* ignore */ }

        // 3. sendBeacon to backend (graceful — silent fail if endpoint absent)
        try {
            if (navigator.sendBeacon) {
                var blob = new Blob([JSON.stringify(event)], { type: 'application/json' });
                navigator.sendBeacon('/api/ab-events', blob);
            }
        } catch (e) { /* ignore */ }
    }

    function bindAbTracking() {
        // Click tracking on any element with data-track attribute
        document.addEventListener('click', function (e) {
            var el = e.target.closest('[data-track]');
            if (!el) return;
            var name = el.getAttribute('data-track');
            if (!name) return;
            var payload = {
                link_text: (el.textContent || '').trim().substring(0, 80),
                link_url: el.getAttribute('href') || ''
            };
            trackEvent(name, payload);
        }, true); // capture so we still fire even if other handlers preventDefault
    }

    function applyVariant(variant) {
        var body = document.body;
        if (!body) return;
        body.dataset.abVariant = variant;
        body.classList.remove('ab-a', 'ab-b', 'ab-c');
        body.classList.add('ab-' + variant.toLowerCase());
    }

    // Boot — runs as early as possible (script is at end of body OR DOMContentLoaded)
    function boot() {
        var variant = getVariant();
        window.__rawAbVariant = variant;
        applyVariant(variant);
        trackEvent('ab_variant_assigned', { variant: variant });
        bindAbTracking();
    }

    // Expose for QA / debugging
    window.RawAB = {
        getVariant: function () { return window.__rawAbVariant; },
        force: function (v) {
            v = (v || '').toUpperCase();
            if (v !== 'A' && v !== 'B' && v !== 'C') {
                console.warn('RawAB.force: variant must be A, B, or C');
                return;
            }
            try { localStorage.setItem(STORAGE_KEY, v); } catch (e) { /* ignore */ }
            location.reload();
        },
        clear: function () {
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
            location.reload();
        },
        trackEvent: trackEvent
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
