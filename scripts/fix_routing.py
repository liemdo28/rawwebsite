"""
fix_routing.py  –  Fix Cloudflare Pages routing regression

ROOT CAUSE
----------
Cloudflare Pages can strip the .html extension for single-level paths
(stockton.html → /stockton/) but it CANNOT map flat file names to nested
routes (menu-stockton.html ≠ /menu/stockton/).

All "Order Online", menu, and SEO routes were returning 404/fallback
because they pointed to clean URLs that had no file behind them.

FIX
---
1. Copy every nested-route file from its flat public/ position into the
   correct subdirectory as index.html  (e.g. menu-stockton.html →
   menu/stockton/index.html).  Cloudflare Pages then natively serves it
   at /menu/stockton/ and /menu/stockton (no trailing slash).

2. Update the canonical / og:url / twitter:url meta tags in each moved
   file to use the clean route URL.

3. Rewrite public/_redirects so:
     a) All old .html URLs → clean routes  (301, for cached links / Yelp)
     b) Belt-and-suspenders 200 rewrites are NOT needed because the
        directory structure is now correct.

4. Remove the old flat .html files so the canonical is unambiguous (the
   301 redirect rules in _redirects handle any lingering old-URL traffic).

5. Update robots.txt sitemap reference to /sitemap-index.xml.

Files that are single-level (stockton.html → /stockton/) are already
served correctly by Cloudflare; they are left in place, not moved.
"""

import os
import re
import shutil
import glob

PUBLIC_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "public")
)

# ── Route table ──────────────────────────────────────────────────────────────
# (source_file, clean_route, new_relative_path_inside_public)
# Only nested routes (depth > 1) need to be moved.
# Single-level routes that already work are excluded.

ROUTE_TABLE = [
    # Core pages — nested
    ("menu-stockton.html",           "/menu/stockton/",                  "menu/stockton/index.html"),
    ("menu-modesto.html",            "/menu/modesto/",                   "menu/modesto/index.html"),
    ("order-sushi-stockton.html",    "/order/stockton/",                 "order/stockton/index.html"),
    ("order-sushi-modesto.html",     "/order/modesto/",                  "order/modesto/index.html"),

    # Stockton SEO pages
    ("best-sushi-stockton.html",     "/stockton/best-sushi/",            "stockton/best-sushi/index.html"),
    ("japanese-restaurant-stockton.html", "/stockton/japanese-restaurant/", "stockton/japanese-restaurant/index.html"),
    ("date-night-stockton.html",     "/stockton/date-night/",            "stockton/date-night/index.html"),
    ("sushi-catering-stockton.html", "/stockton/sushi-catering/",        "stockton/sushi-catering/index.html"),
    ("sushi-delivery-stockton.html", "/stockton/sushi-delivery/",        "stockton/sushi-delivery/index.html"),

    # Modesto SEO pages
    ("best-sushi-modesto.html",      "/modesto/best-sushi/",             "modesto/best-sushi/index.html"),
    ("japanese-restaurant-modesto.html", "/modesto/japanese-restaurant/", "modesto/japanese-restaurant/index.html"),
    ("sushi-catering-modesto.html",  "/modesto/sushi-catering/",         "modesto/sushi-catering/index.html"),
    ("sushi-downtown-modesto.html",  "/modesto/downtown-sushi/",         "modesto/downtown-sushi/index.html"),
]

# Old .html redirect stubs to delete from root after copying to subdirectory
# (stockton.html and modesto.html stay — they are single-level and work fine)
FILES_TO_DELETE_AFTER_MOVE = {row[0] for row in ROUTE_TABLE}

# Also delete legacy aliases that now redirect via _redirects
LEGACY_STUBS = [
    "stockton-sushi.html",   # redirects to /stockton/
    "blog-test-publish.html",  # test page, no canonical clean URL needed
]

BASE_URL = "https://www.rawsushibar.com"


# ── Helpers ──────────────────────────────────────────────────────────────────

def update_canonical(content: str, clean_route: str) -> str:
    """Replace all canonical / OG / Twitter URL meta tags with the clean route."""
    full_url = BASE_URL + clean_route

    # <link rel="canonical" href="...">
    content = re.sub(
        r'(<link\s+rel="canonical"\s+href=")[^"]*(")',
        rf'\g<1>{full_url}\2',
        content,
    )
    # id="canonical-url" variant
    content = re.sub(
        r'(<link\s+rel="canonical"\s+id="[^"]*"\s+href=")[^"]*(")',
        rf'\g<1>{full_url}\2',
        content,
    )
    # og:url
    content = re.sub(
        r'(<meta\s+property="og:url"\s+content=")[^"]*(")',
        rf'\g<1>{full_url}\2',
        content,
    )
    # twitter:url
    content = re.sub(
        r'(<meta\s+name="twitter:url"\s+content=")[^"]*(")',
        rf'\g<1>{full_url}\2',
        content,
    )
    return content


def fix_relative_asset_paths(content: str, depth: int) -> str:
    """
    Rewrite relative asset references that break at nested paths.
    Root-relative paths (/foo) are fine; only fix bare filenames used as links.
    depth = number of directory levels (e.g. menu/stockton/ → depth=2)
    """
    # analytics.js, cookie-consent.js, cookie-consent.css loaded as bare paths
    # Convert them to root-relative so they still load from a subdirectory
    for asset in ["analytics.js", "cookie-consent.js", "cookie-consent.css"]:
        content = content.replace(f'src="{asset}"', f'src="/{asset}"')
        content = content.replace(f"src='{asset}'", f"src='/{asset}'")
        content = content.replace(f'href="{asset}"', f'href="/{asset}"')
        content = content.replace(f"href='{asset}'", f"href='/{asset}'")
    return content


def move_file(src_name: str, clean_route: str, rel_dest: str) -> bool:
    src = os.path.join(PUBLIC_DIR, src_name)
    dest = os.path.join(PUBLIC_DIR, rel_dest.replace("/", os.sep))

    if not os.path.exists(src):
        print(f"  [SKIP] Source not found: {src_name}")
        return False

    # Calculate nesting depth (e.g. "menu/stockton/index.html" → 2 dirs)
    depth = rel_dest.count("/") - 1  # minus the /index.html

    os.makedirs(os.path.dirname(dest), exist_ok=True)

    with open(src, "r", encoding="utf-8") as f:
        content = f.read()

    content = update_canonical(content, clean_route)
    content = fix_relative_asset_paths(content, depth)

    with open(dest, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"  [MOVE] {src_name:45s} -> {rel_dest}")
    return True


def delete_file(filename: str, reason: str = "") -> None:
    path = os.path.join(PUBLIC_DIR, filename)
    if os.path.exists(path):
        os.remove(path)
        print(f"  [DEL]  {filename}  {reason}")
    else:
        print(f"  [----] Already gone: {filename}")


# ── New _redirects content ────────────────────────────────────────────────────

NEW_REDIRECTS = """\
# ── Core page redirects (old .html → clean routes) ───────────────────────────
/index.html                         /                                   301
/stockton-sushi.html                /stockton/                          301
/stockton.html                      /stockton/                          301
/modesto.html                       /modesto/                           301
/menu-stockton.html                 /menu/stockton/                     301
/menu-modesto.html                  /menu/modesto/                      301
/order-sushi-stockton.html          /order/stockton/                    301
/order-sushi-modesto.html           /order/modesto/                     301

# ── SEO page redirects ────────────────────────────────────────────────────────
/best-sushi-stockton.html           /stockton/best-sushi/               301
/best-sushi-modesto.html            /modesto/best-sushi/                301
/japanese-restaurant-stockton.html  /stockton/japanese-restaurant/      301
/japanese-restaurant-modesto.html   /modesto/japanese-restaurant/       301
/date-night-stockton.html           /stockton/date-night/               301
/sushi-catering-stockton.html       /stockton/sushi-catering/           301
/sushi-catering-modesto.html        /modesto/sushi-catering/            301
/sushi-delivery-stockton.html       /stockton/sushi-delivery/           301
/sushi-downtown-modesto.html        /modesto/downtown-sushi/            301

# ── Blog ──────────────────────────────────────────────────────────────────────
/blog-posts.html                    /blog/                              301
/blog-posts.html?slug=*             /blog/:splat                        301
/blog-top-sushi-rolls.html          /blog/                              301
/blog-date-night-guide.html         /blog/memorable-date-night-sushi-stockton/ 301
/blog-sushi-etiquette.html          /blog/                              301
/blog-sashimi-guide.html            /blog/                              301
/blog-stockton-restaurants.html     /blog/                              301
/blog-modesto-dining.html           /blog/                              301
/blog-catering-guide.html           /blog/                              301
/blog-20-years.html                 /blog/                              301
/blog-nigiri-art.html               /blog/                              301
/blog-sustainability.html           /blog/                              301

# ── Canonical domain (handled by functions/_middleware.js, listed for clarity)
# rawsushibar.com  →  www.rawsushibar.com  (301 via middleware)
"""


def write_redirects() -> None:
    path = os.path.join(PUBLIC_DIR, "_redirects")
    with open(path, "w", encoding="utf-8") as f:
        f.write(NEW_REDIRECTS)
    print("  [WRITE] _redirects updated")


def fix_robots_txt() -> None:
    path = os.path.join(PUBLIC_DIR, "robots.txt")
    if not os.path.exists(path):
        print("  [SKIP] robots.txt not found")
        return
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    # Use sitemap-index.xml (generated by @astrojs/sitemap)
    content = re.sub(
        r"Sitemap:.*",
        "Sitemap: https://www.rawsushibar.com/sitemap-index.xml",
        content,
    )
    # Remove any stockton.rawsushibar.com references
    content = content.replace("stockton.rawsushibar.com", "www.rawsushibar.com")
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("  [WRITE] robots.txt — sitemap URL updated")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("\n=== Step 1: Copy files to clean-URL directory structure ===")
    moved = 0
    for src_name, clean_route, rel_dest in ROUTE_TABLE:
        if move_file(src_name, clean_route, rel_dest):
            moved += 1

    print(f"\n=== Step 2: Delete old flat .html files ({len(FILES_TO_DELETE_AFTER_MOVE)} files) ===")
    for fname in sorted(FILES_TO_DELETE_AFTER_MOVE):
        delete_file(fname, "(301 redirect stays in _redirects)")

    print(f"\n=== Step 3: Delete legacy stub files ===")
    for fname in LEGACY_STUBS:
        delete_file(fname, "(no clean route needed)")

    print("\n=== Step 4: Rewrite _redirects ===")
    write_redirects()

    print("\n=== Step 5: Fix robots.txt ===")
    fix_robots_txt()

    print(f"\nDone — {moved}/{len(ROUTE_TABLE)} files moved to directory structure.")
    print("Run: npm run build  then  deploy dist/")


if __name__ == "__main__":
    main()
