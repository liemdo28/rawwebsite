"""
unify_nav.py - Unify navigation across all static HTML pages in public/

Two page types:
  A) "nav-container" pages (index.html, stockton.html, modesto.html, blog-posts.html,
     blog-test-publish.html) — already have full nav; update nav items + footer links
  B) "nav-bar" pages (SEO + old static blog pages) — minimal 3-link bar; upgrade to
     full nav-container with CSS + mobile JS

Result: every page shows the same 6-item header:
  Home | Stockton | Modesto | Menu | Blog | (209) 954-9729
"""

import os
import re
import glob

PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "..", "public")

# ── Unified nav HTML (verbatim match to Nav.astro) ───────────────────────────

UNIFIED_NAV_LIST = """\
            <ul class="nav-links" id="navLinks" role="menubar">
                <li role="none"><a href="/" role="menuitem">Home</a></li>
                <li role="none"><a href="/stockton/" role="menuitem">Stockton</a></li>
                <li role="none"><a href="/modesto/" role="menuitem">Modesto</a></li>
                <li role="none"><a href="/menu/stockton/" role="menuitem">Menu</a></li>
                <li role="none"><a href="/blog/" role="menuitem">Blog</a></li>
                <li role="none"><a href="tel:2099549729" class="nav-phone" role="menuitem">(209) 954-9729</a></li>
            </ul>"""

UNIFIED_FULL_NAV = """\
    <a href="#main-content" class="skip-link">Skip to main content</a>
    <header class="nav-container" role="banner">
        <nav aria-label="Main navigation">
            <a href="/" class="logo" aria-label="Raw Sushi Bar - Home">
                <svg viewBox="0 0 200 50" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Raw Sushi Bar logo">
                    <circle cx="25" cy="25" r="22" fill="#1a1a1a" stroke="#C41E3A" stroke-width="1.5"/>
                    <text x="25" y="33" text-anchor="middle" font-family="'Playfair Display',Georgia,serif" font-style="italic" font-weight="700" font-size="28" fill="#C41E3A">R</text>
                    <text x="60" y="24" font-family="'Playfair Display',Georgia,serif" font-style="italic" font-weight="700" font-size="24" fill="#C41E3A" letter-spacing="2">aw</text>
                    <text x="60" y="42" font-family="'Inter','Helvetica Neue',sans-serif" font-weight="300" font-size="11" fill="rgba(255,255,255,0.9)" letter-spacing="3">SUSHI BAR</text>
                </svg>
            </a>
            <ul class="nav-links" id="navLinks" role="menubar">
                <li role="none"><a href="/" role="menuitem">Home</a></li>
                <li role="none"><a href="/stockton/" role="menuitem">Stockton</a></li>
                <li role="none"><a href="/modesto/" role="menuitem">Modesto</a></li>
                <li role="none"><a href="/menu/stockton/" role="menuitem">Menu</a></li>
                <li role="none"><a href="/blog/" role="menuitem">Blog</a></li>
                <li role="none"><a href="tel:2099549729" class="nav-phone" role="menuitem">(209) 954-9729</a></li>
            </ul>
            <button class="mobile-menu-btn" id="mobileMenuBtn" aria-label="Open menu" aria-expanded="false">
                <span></span>
                <span></span>
                <span></span>
            </button>
        </nav>
    </header>"""

# ── CSS to inject for pages upgrading from nav-bar → nav-container ───────────

NAV_CSS_BLOCK = """\

        /* ── Unified Navigation (Raw Sushi Bar) ─────────────────────────── */
        .skip-link { position: absolute; top: -100px; left: 0; background: #C41E3A; color: #fff; padding: 10px 15px; z-index: 100000; transition: top 0.2s; text-decoration: none; font-weight: bold; }
        .skip-link:focus { top: 0; }
        .nav-container { position: fixed; top: 0; width: 100%; z-index: 1000; background: rgba(26,26,26,0.95); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: 0 2px 20px rgba(0,0,0,0.15); }
        .nav-container nav { max-width: 1400px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 3rem; }
        .logo { display: flex; align-items: center; text-decoration: none; }
        .logo svg { height: 44px; width: auto; display: block; }
        .nav-links { display: flex; list-style: none; gap: 2rem; align-items: center; }
        .nav-links a { color: rgba(255,255,255,0.85); text-decoration: none; font-weight: 500; font-size: 0.9rem; transition: all 0.3s; text-transform: uppercase; letter-spacing: 0.5px; position: relative; }
        .nav-links a:hover { color: #d4af37; }
        .nav-links a::after { content: ''; position: absolute; bottom: -4px; left: 0; width: 0; height: 2px; background: #d4af37; transition: width 0.3s; }
        .nav-links a:hover::after { width: 100%; }
        .nav-phone { color: #d4af37 !important; font-weight: 600 !important; }
        .mobile-menu-btn { display: none; flex-direction: column; gap: 5px; cursor: pointer; padding: 10px; background: none; border: none; z-index: 1001; }
        .mobile-menu-btn span { width: 25px; height: 2px; background: #fff; border-radius: 2px; transition: all 0.3s; }
        .mobile-menu-btn.active span:nth-child(1) { transform: rotate(45deg) translate(5px,5px); }
        .mobile-menu-btn.active span:nth-child(2) { opacity: 0; }
        .mobile-menu-btn.active span:nth-child(3) { transform: rotate(-45deg) translate(5px,-5px); }
        @media (max-width: 768px) {
            .nav-container nav { padding: 0.75rem 1.5rem; }
            .nav-links { position: fixed; top: 0; right: -100%; width: 280px; height: 100vh; background: #1a1a1a; flex-direction: column; padding: 5rem 2rem 2rem; gap: 0; transition: right 0.3s; box-shadow: -10px 0 30px rgba(0,0,0,0.3); }
            .nav-links.active { right: 0; }
            .nav-links li { width: 100%; }
            .nav-links a { display: block; padding: 0.85rem 0; font-size: 1rem; border-bottom: 1px solid rgba(255,255,255,0.06); }
            .nav-links a::after { display: none; }
            .mobile-menu-btn { display: flex; }
        }
        /* ─────────────────────────────────────────────────────────────────── */
"""

# ── Mobile menu JS ─────────────────────────────────────────────────────────

NAV_JS_BLOCK = """\
    <script>
        (function () {
            var btn = document.getElementById('mobileMenuBtn');
            var navLinks = document.getElementById('navLinks');
            if (btn && navLinks) {
                btn.addEventListener('click', function () {
                    var isOpen = btn.classList.toggle('active');
                    navLinks.classList.toggle('active');
                    btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
                    btn.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
                });
                navLinks.querySelectorAll('a').forEach(function (link) {
                    link.addEventListener('click', function () {
                        btn.classList.remove('active');
                        navLinks.classList.remove('active');
                        btn.setAttribute('aria-expanded', 'false');
                        btn.setAttribute('aria-label', 'Open menu');
                    });
                });
            }
        })();
    </script>
"""

# ── Unified footer HTML ────────────────────────────────────────────────────

UNIFIED_FOOTER = """\
    <footer role="contentinfo">
        <div class="footer-content">
            <div class="footer-brand">
                <a href="/" class="logo" style="margin-bottom:1rem;">
                    <svg viewBox="0 0 200 50" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Raw Sushi Bar logo">
                        <circle cx="25" cy="25" r="22" fill="#1a1a1a" stroke="#C41E3A" stroke-width="1.5"/>
                        <text x="25" y="33" text-anchor="middle" font-family="'Playfair Display',Georgia,serif" font-style="italic" font-weight="700" font-size="28" fill="#C41E3A">R</text>
                        <text x="60" y="24" font-family="'Playfair Display',Georgia,serif" font-style="italic" font-weight="700" font-size="24" fill="#C41E3A" letter-spacing="2">aw</text>
                        <text x="60" y="42" font-family="'Inter','Helvetica Neue',sans-serif" font-weight="300" font-size="11" fill="rgba(255,255,255,0.9)" letter-spacing="3">SUSHI BAR</text>
                    </svg>
                </a>
                <p>Fresh sushi and authentic Japanese cuisine since 2005. Explore our California locations for dine-in, takeout, and ordering details.</p>
                <div class="footer-social">
                    <a href="https://www.facebook.com/rawsushibar/" target="_blank" rel="noopener" class="social-link" aria-label="Facebook">FB</a>
                    <a href="https://instagram.com/rawsushibistro/" target="_blank" rel="noopener" class="social-link" aria-label="Instagram">IG</a>
                    <a href="https://www.yelp.com/biz/raw-sushi-bistro-stockton-2" target="_blank" rel="noopener" class="social-link" aria-label="Yelp">Y!</a>
                </div>
            </div>
            <div class="footer-section">
                <h3>Quick Links</h3>
                <ul>
                    <li><a href="/">Home</a></li>
                    <li><a href="/stockton/">Stockton</a></li>
                    <li><a href="/modesto/">Modesto</a></li>
                    <li><a href="/menu/stockton/">Stockton Menu</a></li>
                    <li><a href="/menu/modesto/">Modesto Menu</a></li>
                    <li><a href="/blog/">Blog</a></li>
                    <li><a href="mailto:info@rawsushibar.com">Catering</a></li>
                </ul>
            </div>
            <div class="footer-section">
                <h3>Stockton</h3>
                <ul>
                    <li>10742 Trinity Pkwy, Suite D</li>
                    <li>Stockton, CA 95219</li>
                    <li><a href="tel:2099549729">(209) 954-9729</a></li>
                    <li>Mon–Thu: 4:30 PM – 8:30 PM</li>
                    <li>Fri: 11:30 AM – 9:00 PM</li>
                    <li>Sat: 12:00 PM – 9:00 PM</li>
                    <li>Sun: 12:00 PM – 8:00 PM</li>
                </ul>
            </div>
            <div class="footer-section">
                <h3>Modesto</h3>
                <ul>
                    <li>1200 I Street</li>
                    <li>Modesto, CA 95354</li>
                    <li><a href="tel:2095669560">(209) 566-9560</a></li>
                    <li>Mon: 5:00 PM – 9:00 PM</li>
                    <li>Tue–Thu: 11:30 AM – 9:00 PM</li>
                    <li>Fri: 11:30 AM – 10:00 PM</li>
                    <li>Sat: 5:00 PM – 10:00 PM</li>
                    <li>Sun: Closed</li>
                </ul>
            </div>
        </div>
        <div class="footer-bottom">
            <p>&copy; 2025 Raw Sushi Bar. All rights reserved. | Celebrating 20 Years (2005–2025) | <a href="mailto:info@rawsushibar.com" style="color:rgba(255,255,255,0.5);">info@rawsushibar.com</a></p>
        </div>
    </footer>"""

# Footer CSS (minimal, for pages that might not have it)
FOOTER_CSS_BLOCK = """\

        /* ── Unified Footer (Raw Sushi Bar) ─────────────────────────────── */
        footer { background: #1a1a1a; color: rgba(255,255,255,0.8); padding: 4rem 2rem 1.5rem; }
        .footer-content { max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 3rem; margin-bottom: 3rem; }
        .footer-brand p { font-size: 0.95rem; line-height: 1.7; margin-bottom: 1.5rem; opacity: 0.8; }
        .footer-social { display: flex; gap: 0.75rem; }
        .social-link { width: 40px; height: 40px; border-radius: 50%; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; color: #fff; text-decoration: none; font-size: 0.85rem; font-weight: 600; transition: all 0.3s; }
        .social-link:hover { background: #C41E3A; transform: translateY(-3px); }
        .footer-section h3 { font-family: 'Playfair Display', serif; font-size: 1.2rem; margin-bottom: 1.25rem; color: #d4af37; }
        .footer-section ul { list-style: none; }
        .footer-section li { margin-bottom: 0.6rem; font-size: 0.9rem; opacity: 0.7; }
        .footer-section a { color: rgba(255,255,255,0.7); text-decoration: none; font-size: 0.9rem; transition: all 0.3s; }
        .footer-section a:hover { color: #fff; }
        .footer-bottom { text-align: center; padding-top: 2rem; border-top: 1px solid rgba(255,255,255,0.08); font-size: 0.85rem; opacity: 0.5; }
        @media (max-width: 1024px) { .footer-content { grid-template-columns: repeat(2,1fr); } }
        @media (max-width: 768px) { .footer-content { grid-template-columns: 1fr; gap: 2rem; } footer { padding-bottom: 5rem; } }
        /* ─────────────────────────────────────────────────────────────────── */
"""


def process_nav_container_page(content, filename):
    """
    Pages that already have nav-container:
      - Replace the <ul class="nav-links" ...>...</ul> block
      - Update nav-cta to remove modal JS
      - Fix footer quick links to use clean routes
    """
    # Replace existing nav-links <ul> with unified version
    # Match from <ul class="nav-links" to the closing </ul>
    content = re.sub(
        r'<ul class="nav-links"[^>]*>.*?</ul>',
        UNIFIED_NAV_LIST,
        content,
        flags=re.DOTALL
    )

    # Remove the location chooser modal entirely (it's no longer needed)
    content = re.sub(
        r'\s*<!-- Location Chooser Modal -->.*?(?=\s*<(?:main|section|div id="home"|<!-- ))',
        '\n',
        content,
        flags=re.DOTALL
    )

    # Remove openLocationModal JS function blocks
    content = re.sub(
        r'\s*function openLocationModal\(.*?\n\s*\}\s*\n',
        '\n',
        content,
        flags=re.DOTALL
    )
    content = re.sub(
        r'\s*function closeLocationModal\(\).*?\n\s*\}\s*\n',
        '\n',
        content,
        flags=re.DOTALL
    )

    # Fix footer links: replace old .html links and modal links with clean routes
    footer_replacements = [
        # Modal links → clean routes
        (r'href="#"\s+onclick="openLocationModal\(\'menu\'\)[^"]*"', 'href="/menu/stockton/"'),
        (r'href="#"\s+onclick="openLocationModal\(\'order\'\)[^"]*"', 'href="/order/stockton/"'),
        # Floating CTA modal → order page
        (r'href="#"\s+onclick="openLocationModal\(\'order\'\)[^"]*"\s+class="floating-cta"',
         'href="/order/stockton/" class="floating-cta"'),
        # Old .html links → clean routes (footer area)
        (r'href="stockton\.html"', 'href="/stockton/"'),
        (r'href="modesto\.html"', 'href="/modesto/"'),
        (r'href="menu-stockton\.html"', 'href="/menu/stockton/"'),
        (r'href="menu-modesto\.html"', 'href="/menu/modesto/"'),
        (r'href="order-sushi-stockton\.html"', 'href="/order/stockton/"'),
        (r'href="order-sushi-modesto\.html"', 'href="/modesto/order-sushi/"'),
        (r'href="index\.html"', 'href="/"'),
        (r'href="blog-posts\.html"', 'href="/blog/"'),
    ]
    for pattern, replacement in footer_replacements:
        content = re.sub(pattern, replacement, content, flags=re.IGNORECASE)

    # Replace the footer HTML entirely with unified footer
    content = re.sub(
        r'<footer role="contentinfo">.*?</footer>',
        UNIFIED_FOOTER,
        content,
        flags=re.DOTALL
    )

    return content


def process_nav_bar_page(content, filename):
    """
    Pages with minimal .nav-bar structure:
      - Inject nav-container CSS before </style>
      - Replace <div class="nav-bar">...</div> with full nav HTML
      - Inject mobile JS before </body>
      - Add body padding-top for the fixed nav
      - Upgrade / add unified footer if missing, else leave existing page footer
    """
    # 1. Inject NAV CSS right before </style>
    if '.nav-container' not in content:
        # Replace last </style> occurrence
        content = content.replace('</style>', NAV_CSS_BLOCK + '        </style>', 1)

    # 2. Add body padding-top for fixed nav (if not already set)
    if 'padding-top' not in content and '.nav-bar' in content:
        # Add after the last </style>
        content = content.replace(
            NAV_CSS_BLOCK + '        </style>',
            NAV_CSS_BLOCK + '        body { padding-top: 72px; }\n        </style>',
            1
        )

    # 3. Replace .nav-bar div with the unified full nav
    # Match <div class="nav-bar">...</div>
    content = re.sub(
        r'<div class="nav-bar">.*?</div>\s*',
        UNIFIED_FULL_NAV + '\n\n',
        content,
        flags=re.DOTALL
    )

    # 4. Fix internal .html links throughout the file → clean routes
    link_replacements = [
        (r'href="index\.html"', 'href="/"'),
        (r'href="stockton\.html"', 'href="/stockton/"'),
        (r'href="modesto\.html"', 'href="/modesto/"'),
        (r'href="stockton-sushi\.html"', 'href="/stockton/"'),
        (r'href="menu-stockton\.html"', 'href="/menu/stockton/"'),
        (r'href="menu-modesto\.html"', 'href="/menu/modesto/"'),
        (r'href="order-sushi-stockton\.html"', 'href="/order/stockton/"'),
        (r'href="order-sushi-modesto\.html"', 'href="/modesto/order-sushi/"'),
        (r'href="best-sushi-stockton\.html"', 'href="/stockton/best-sushi/"'),
        (r'href="best-sushi-modesto\.html"', 'href="/modesto/best-sushi/"'),
        (r'href="japanese-restaurant-stockton\.html"', 'href="/stockton/japanese-restaurant/"'),
        (r'href="japanese-restaurant-modesto\.html"', 'href="/modesto/japanese-restaurant/"'),
        (r'href="date-night-stockton\.html"', 'href="/stockton/date-night/"'),
        (r'href="sushi-catering-stockton\.html"', 'href="/stockton/sushi-catering/"'),
        (r'href="sushi-catering-modesto\.html"', 'href="/modesto/sushi-catering/"'),
        (r'href="sushi-delivery-stockton\.html"', 'href="/stockton/sushi-delivery/"'),
        (r'href="sushi-downtown-modesto\.html"', 'href="/modesto/downtown-sushi/"'),
        (r'href="blog-posts\.html"', 'href="/blog/"'),
    ]
    for pattern, replacement in link_replacements:
        content = re.sub(pattern, replacement, content, flags=re.IGNORECASE)

    # 5. Add footer CSS if missing
    if '.footer-content' not in content and '<footer' not in content:
        content = content.replace('</style>', FOOTER_CSS_BLOCK + '        </style>', 1)
        # Append footer before </body>
        content = content.replace('</body>', UNIFIED_FOOTER + '\n</body>')

    # 6. Inject mobile menu JS before </body>
    if 'mobileMenuBtn' in content and 'mobileMenuBtn' not in content.split('<script')[0]:
        pass  # Already has inline JS — skip
    elif 'mobileMenuBtn' in content and NAV_JS_BLOCK.strip() not in content:
        content = content.replace('</body>', NAV_JS_BLOCK + '\n</body>')

    return content


def main():
    html_files = glob.glob(os.path.join(PUBLIC_DIR, "*.html"))
    updated = []
    skipped = []

    for filepath in sorted(html_files):
        filename = os.path.basename(filepath)

        with open(filepath, 'r', encoding='utf-8') as f:
            original = f.read()

        content = original

        if 'class="nav-container"' in content:
            content = process_nav_container_page(content, filename)
        elif 'class="nav-bar"' in content:
            content = process_nav_bar_page(content, filename)
        else:
            skipped.append(filename)
            continue

        if content != original:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            updated.append(filename)
            print(f"  [OK] Updated: {filename}")
        else:
            skipped.append(filename)
            print(f"  [--] No change: {filename}")

    print(f"\nDone — {len(updated)} files updated, {len(skipped)} unchanged.")
    if skipped:
        print("Skipped:", ", ".join(skipped))


if __name__ == "__main__":
    main()
