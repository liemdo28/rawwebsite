# Duplicate Files Backup Report

**Generated**: 2026-06-05T12:32:00+07:00
**Analysis Tool**: scripts/check-duplicates.mjs

## Summary

Found **18 duplicate files** existing in both root and `public/` directories.
The build system only ships `public/*`, making `public/` the canonical location.

## Analysis Decision

| Action | File | Root Size | Root Modified | Public Size | Public Modified | Verdict |
|--------|------|-----------|---------------|-------------|-----------------|---------|
| DELETE | analytics.js | 6,341 | 2026-04-13 | 6,341 | 2026-04-20 | IDENTICAL - safe delete |
| DELETE | blog-20-years.html | 15,063 | 2026-04-23 11:54 | 15,086 | 2026-04-23 13:43 | Public newer - safe delete |
| DELETE | blog-catering-guide.html | 22,084 | 2026-04-11 | 33,052 | 2026-04-20 | Public newer/larger - safe delete |
| DELETE | blog-date-night-guide.html | 19,003 | 2026-04-11 | 24,213 | 2026-04-20 | Public newer/larger - safe delete |
| DELETE | blog-modesto-dining.html | 19,755 | 2026-04-11 | 30,679 | 2026-04-20 | Public newer/larger - safe delete |
| DELETE | blog-nigiri-art.html | 20,715 | 2026-04-23 11:55 | 20,738 | 2026-04-23 13:43 | Public newer - safe delete |
| DELETE | blog-posts.html | 29,787 | 2026-04-20 09:36 | 34,067 | 2026-04-20 12:36 | Public newer/larger - safe delete |
| DELETE | blog-sashimi-guide.html | 22,229 | 2026-04-11 | 27,488 | 2026-04-20 | Public newer/larger - safe delete |
| DELETE | blog-stockton-restaurants.html | 19,063 | 2026-04-11 | 29,973 | 2026-04-20 | Public newer/larger - safe delete |
| DELETE | blog-sushi-etiquette.html | 21,383 | 2026-04-11 | 26,634 | 2026-04-20 | Public newer/larger - safe delete |
| DELETE | blog-sustainability.html | 23,528 | 2026-04-23 11:57 | 23,551 | 2026-04-23 13:43 | Public newer - safe delete |
| DELETE | blog-top-sushi-rolls.html | 21,542 | 2026-04-11 | 26,787 | 2026-04-20 | Public newer/larger - safe delete |
| DELETE | cookie-consent.css | 5,413 | 2026-04-03 | 5,413 | 2026-04-20 | IDENTICAL - safe delete |
| DELETE | cookie-consent.js | 6,204 | 2026-04-03 | 6,204 | 2026-04-20 | IDENTICAL - safe delete |
| DELETE | index.html | 83,428 | 2026-04-23 11:52 | 86,367 | 2026-04-24 12:13 | Public newer/larger - safe delete |
| DELETE | modesto.html | 77,962 | 2026-04-11 | 80,887 | 2026-04-23 | Public newer/larger - safe delete |
| DELETE | stockton.html | 77,985 | 2026-04-11 | 80,408 | 2026-04-23 | Public newer/larger - safe delete |
| DELETE | terms.html | 11,667 | 2026-04-11 | 17,760 | 2026-04-23 | Public newer/larger - safe delete |

## Canonical Source

All 18 files have their canonical version in `public/`. The root copies are:
- Either **byte-identical** (analytics.js, cookie-consent.css, cookie-consent.js)
- Or **older and smaller** (all HTML files)

## Files Deleted

```
analytics.js
blog-20-years.html
blog-catering-guide.html
blog-date-night-guide.html
blog-modesto-dining.html
blog-nigiri-art.html
blog-posts.html
blog-sashimi-guide.html
blog-stockton-restaurants.html
blog-sushi-etiquette.html
blog-sustainability.html
blog-top-sushi-rolls.html
cookie-consent.css
cookie-consent.js
index.html
modesto.html
stockton.html
terms.html
```

## Remaining Root HTML Files (NOT duplicates)

These files exist only in root and are intentionally kept:

- `best-sushi-modesto.html` — SEO landing page
- `best-sushi-stockton.html` — SEO landing page
- `blog-test-publish.html` — Test/dev artifact
- `date-night-stockton.html` — SEO landing page
- `japanese-restaurant-modesto.html` — SEO landing page
- `japanese-restaurant-stockton.html` — SEO landing page
- `menu-modesto.html` — Menu page
- `menu-stockton.html` — Menu page
- `order-sushi-modesto.html` — Order page
- `order-sushi-stockton.html` — Order page
- `stockton-sushi.html` — SEO landing page
- `sushi-catering-modesto.html` — SEO landing page
- `sushi-catering-stockton.html` — SEO landing page
- `sushi-delivery-stockton.html` — SEO landing page
- `sushi-downtown-modesto.html` — SEO landing page

**Note**: These should be reviewed and potentially moved to `public/` or `src/pages/` in a future cleanup pass.

## Risk Assessment

**Low Risk**: All deleted files have newer/equal versions in `public/`.
The build system (`npm run build`) copies `public/*` to `dist/`, so production is unaffected.

## Verification Command

After deletion, run:
```bash
node scripts/check-duplicates.mjs
# Expected output: [check-duplicates] OK — no root/public canonical duplicates.
```
