"""
fix_html_refs.py - Fix remaining .html URL references in all public/ HTML files.

Targets:
  1. JSON-LD "url", "@id", "hasMenu", "urlTemplate" fields
  2. href="terms.html" relative links
  3. Any remaining stockton.rawsushibar.com host references
"""

import os
import re
import glob

PUBLIC_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "public")
)

BASE = "https://www.rawsushibar.com"

# Map old absolute URL → new absolute URL
URL_MAP = {
    f"{BASE}/stockton.html":                     f"{BASE}/stockton/",
    f"{BASE}/stockton.html#restaurant":          f"{BASE}/stockton/#restaurant",
    f"{BASE}/modesto.html":                      f"{BASE}/modesto/",
    f"{BASE}/modesto.html#restaurant":           f"{BASE}/modesto/#restaurant",
    f"{BASE}/menu-stockton.html":                f"{BASE}/menu/stockton/",
    f"{BASE}/menu-modesto.html":                 f"{BASE}/menu/modesto/",
    f"{BASE}/order-sushi-stockton.html":         f"{BASE}/order/stockton/",
    f"{BASE}/order-sushi-modesto.html":          f"{BASE}/order/modesto/",
    f"{BASE}/best-sushi-stockton.html":          f"{BASE}/stockton/best-sushi/",
    f"{BASE}/best-sushi-modesto.html":           f"{BASE}/modesto/best-sushi/",
    f"{BASE}/japanese-restaurant-stockton.html": f"{BASE}/stockton/japanese-restaurant/",
    f"{BASE}/japanese-restaurant-modesto.html":  f"{BASE}/modesto/japanese-restaurant/",
    f"{BASE}/date-night-stockton.html":          f"{BASE}/stockton/date-night/",
    f"{BASE}/sushi-catering-stockton.html":      f"{BASE}/stockton/sushi-catering/",
    f"{BASE}/sushi-catering-modesto.html":       f"{BASE}/modesto/sushi-catering/",
    f"{BASE}/sushi-delivery-stockton.html":      f"{BASE}/stockton/sushi-delivery/",
    f"{BASE}/sushi-downtown-modesto.html":       f"{BASE}/modesto/downtown-sushi/",
    f"{BASE}/blog-posts.html":                   f"{BASE}/blog/",
    f"{BASE}/stockton-sushi.html":               f"{BASE}/stockton/",
    # Old subdomain references
    "https://stockton.rawsushibar.com":          f"{BASE}",
    "http://stockton.rawsushibar.com":           f"{BASE}",
}

# Relative href fixes (inside HTML attributes)
RELATIVE_MAP = {
    'href="terms.html"':               'href="/terms.html"',
    "href='terms.html'":               "href='/terms.html'",
    'href="index.html"':               'href="/"',
    'href="stockton.html"':            'href="/stockton/"',
    'href="modesto.html"':             'href="/modesto/"',
    'href="menu-stockton.html"':       'href="/menu/stockton/"',
    'href="menu-modesto.html"':        'href="/menu/modesto/"',
    'href="order-sushi-stockton.html"':'href="/order/stockton/"',
    'href="order-sushi-modesto.html"': 'href="/order/modesto/"',
}


def fix_file(path: str) -> bool:
    with open(path, "r", encoding="utf-8") as f:
        original = f.read()

    content = original

    # Absolute URL replacements
    for old, new in URL_MAP.items():
        content = content.replace(old, new)

    # Relative href replacements
    for old, new in RELATIVE_MAP.items():
        content = content.replace(old, new)

    if content != original:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return True
    return False


def main():
    # Target all HTML files: root + all subdirectories
    patterns = [
        os.path.join(PUBLIC_DIR, "*.html"),
        os.path.join(PUBLIC_DIR, "*", "*.html"),
        os.path.join(PUBLIC_DIR, "*", "*", "*.html"),
        os.path.join(PUBLIC_DIR, "*", "*", "*", "*.html"),
    ]
    files = []
    for p in patterns:
        files.extend(glob.glob(p))

    updated = 0
    for filepath in sorted(files):
        rel = os.path.relpath(filepath, PUBLIC_DIR)
        if fix_file(filepath):
            updated += 1
            print(f"  [FIXED] {rel}")

    print(f"\nDone -- {updated}/{len(files)} files had references updated.")


if __name__ == "__main__":
    main()
