(function () {
    'use strict';

    var RAW_LOCATIONS = {
        stockton: {
            name: 'Raw Sushi Bar Stockton',
            phoneDisplay: '(209) 954-9729',
            phoneHref: 'tel:+12099549729'
        },
        modesto: {
            name: 'Raw Sushi Bar Modesto',
            phoneDisplay: '(209) 566-9560',
            phoneHref: 'tel:+12095669560'
        }
    };

    var STOCKTON_PAGES = [
        'stockton',
        'menu-stockton',
        'order-sushi-stockton',
        'stockton-sushi',
        'sushi-catering-stockton',
        'sushi-delivery-stockton',
        'japanese-restaurant-stockton',
        'best-sushi-stockton',
        'date-night-stockton',
        'blog-stockton-restaurants'
    ];

    var MODESTO_PAGES = [
        'modesto',
        'menu-modesto',
        'order-sushi-modesto',
        'sushi-catering-modesto',
        'sushi-downtown-modesto',
        'japanese-restaurant-modesto',
        'best-sushi-modesto',
        'blog-modesto-dining'
    ];

    function pageSlug() {
        var path = window.location.pathname.toLowerCase();
        var last = path.split('/').pop() || '';
        return last.replace(/\.html$/, '');
    }

    function detectRawLocation() {
        var slug = pageSlug();
        if (STOCKTON_PAGES.indexOf(slug) !== -1) return 'stockton';
        if (MODESTO_PAGES.indexOf(slug) !== -1) return 'modesto';
        return null;
    }

    function applyLocationPhone() {
        var key = detectRawLocation();
        var elements = document.querySelectorAll('[data-location-phone]');

        for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            var mode = el.getAttribute('data-location-phone') || 'display';

            if (!key) {
                if (el.tagName === 'A') {
                    el.setAttribute('href', '#locations');
                    if (mode === 'display') {
                        el.textContent = 'Choose Location';
                    }
                }
                continue;
            }

            var loc = RAW_LOCATIONS[key];
            if (!loc) continue;

            if (el.tagName === 'A') {
                el.setAttribute('href', loc.phoneHref);
            }
            if (mode === 'display') {
                el.textContent = loc.phoneDisplay;
            }
        }
    }

    if (typeof window !== 'undefined') {
        window.RAW_LOCATIONS = RAW_LOCATIONS;
        window.detectRawLocation = detectRawLocation;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyLocationPhone);
    } else {
        applyLocationPhone();
    }
})();
