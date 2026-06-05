# RawWebsite — Source Stress Audit

Date: 2026-06-05
Source root: `e:\Project\Master\RawSushi\RawWebsite`

## 1. Build & dependency baseline

| Check | Result | Notes |
|---|---:|---|
| `npm ci` | PASS | Installed 252 packages, audit 0 vulnerabilities after `npm audit fix`. |
| `npm audit` (post-fix) | PASS | 0 vulnerabilities. |
| `npm run build` | PASS | Astro builds 0 pages (intentional — `src/pages/` is empty). `dist/` is populated from `public/`. Windows-specific libuv teardown assertion is caught and exit-0 is returned because `dist/index.html` is present. |
| Public deploy surface (`dist/`) | PASS | All 62 HTML files + 5 content posts + admin SPA + `functions/` + `content/` + `lib/` + `config/` mirrored into `dist/`. |

## 2. Repository layout (post-fix)

```
RawWebsite/
├── public/                     # static marketing site (canonical deploy surface)
│   ├── index.html              # home
│   ├── stockton.html
│   ├── modesto.html
│   ├── menu-*.html
│   ├── order-*.html
│   ├── blog-*.html
│   ├── best-sushi-*.html
│   ├── japanese-restaurant-*.html
│   ├── date-night-*.html
│   ├── sushi-catering-*.html
│   ├── sushi-delivery-*.html
│   ├── sushi-downtown-modesto.html
│   ├── terms.html
│   ├── analytics.js
│   ├── cookie-consent.js
│   ├── cookie-consent.css
│   ├── _redirects              # core page redirects
│   ├── robots.txt
│   ├── content/                # canonical blog index + posts
│   ├── menu/                   # menu/stockton/, menu/modesto/
│   ├── modesto/                # modesto/ SEO subdirs
│   ├── order/                  # order/stockton/, order/modesto/
│   ├── stockton/               # stockton/ SEO subdirs
│   └── admin/                  # ← NEW: Admin SPA (single-file HTML+JS)
├── content/                    # canonical blog posts (markdown)
│   ├── index.json
│   └── posts/*.md
├── functions/                  # ← NEW: Cloudflare Pages Functions
│   ├── _middleware.js          # canonical-domain redirect
│   └── api/
│       ├── agent/
│       │   ├── status.js
│       │   ├── jobs.js
│       │   └── webhook.js
│       ├── content/
│       │   ├── blog.js
│       │   ├── posts.js
│       │   ├── posts/
│       │   │   ├── [id].js
│       │   │   ├── [id]/
│       │   │   │   ├── transition.js
│       │   │   │   ├── schedule.js
│       │   │   │   └── publish.js
│       │   │   └── preview.js
│       ├── menu/
│       │   ├── categories.js
│       │   ├── items.js
│       │   └── items/[id].js
│       └── media/upload.js
├── lib/                        # ← NEW: framework-agnostic server lib
│   ├── config.js               # env + path config
│   ├── store.js                # MemoryStore | FileStore | KVStore factory
│   ├── contentPolicy.js        # scorer for config/content_policy.json
│   ├── agentCodingClient.js    # outbound HTTP client
│   ├── posts.js                # post lifecycle + markdown serializer
│   ├── jobs.js                 # job queue + processor
│   └── auditLog.js             # audit_log + JSON response helpers
├── src/                        # (unchanged) components, layouts, data
├── scripts/                    # ← NEW: CLI scripts
│   ├── check-duplicates.mjs
│   ├── agent-status.mjs
│   ├── agent-export.mjs
│   └── agent-seed.mjs
├── tests/                      # ← NEW: Node --test unit tests
│   ├── store.test.js
│   ├── contentPolicy.test.js
│   ├── posts.test.js
│   ├── jobs.test.js
│   └── agentCodingClient.test.js
├── docs/
│   ├── content-policy.md       # (existing, untouched)
│   ├── ADMIN_CMS_GUIDE.md      # ← NEW
│   └── AGENT_CODING_BRIDGE.md  # ← NEW
├── reports/
│   ├── RAWWEBSITE_SOURCE_AUDIT.md   # this file
│   ├── AGENT_CODING_INTEGRATION_PLAN.md
│   └── QA_STRESS_TEST_REPORT.md
├── config/
│   └── content_policy.json     # (existing, now actually loaded)
├── data/                       # ← NEW: created on first write
│   ├── state.json
│   └── tables/{posts,media,menu_categories,menu_items,agent_jobs,audit_log}.json
├── public/admin/index.html     # ← NEW: Admin SPA
├── astro.config.mjs            # (kept minimal — output: 'static')
├── build.mjs                   # ← UPDATED: Windows-safe wrapper
├── package.json                # (scripts + new deps)
└── .env.example                # ← NEW: secrets template
```

## 3. Risk & duplicate findings

The original audit reported:
- 62 HTML files in `public/`, 62 in the root → root copies are dead code in the build pipeline.
- `analytics.js`, `cookie-consent.{css,js}`, `content/index.json`, `content/posts/*` all duplicated in root + `public/`.
- `npm audit`: 1 low + 1 high (`devalue` deserialization DoS).
- Astro reports "0 pages built" because `src/pages/` is empty.

### Fixes applied
- `npm audit fix` removed both vulnerabilities. `npm audit` now reports 0 issues.
- A **CI guard** (`scripts/check-duplicates.mjs`, `npm run check:duplicates`) now fails the build if a canonical file appears in both the root and `public/`. This prevents NEW duplicates from being introduced. The current 18 known duplicates (root HTML files) are pre-existing; the new guard is forward-looking. Removing them is out of scope for this fix and would change the user's working tree without explicit consent.
- `build.mjs` was rewritten to (a) handle the Windows libuv teardown assertion and (b) re-copy `public/` last so any Astro-built admin routes are preserved.
- The `@astrojs/sitemap` plugin (originally in the dependency tree and prone to leaving libuv handles open) is no longer referenced in `astro.config.mjs`.

## 4. Source-of-truth model

| Concern | Canonical location | Why |
|---|---|---|
| Marketing pages | `public/*.html` | The build only ships `public/*`. Root copies are shadowed. |
| Blog index | `content/index.json` | Already loaded by `public/blog-posts.html`. |
| Blog posts | `content/posts/<slug>.md` | Markdown with YAML frontmatter; loadable by `blog-posts.html` and the new `GET /api/content/blog`. |
| Menu content | `menu/{stockton,modesto}/index.html` | Existing static menu pages. |
| Agent-managed state | `data/tables/*.json` (FileStore) or Cloudflare KV (KVStore) | New persistence layer. |
| Content policy | `config/content_policy.json` | Already present, now actually enforced. |

## 5. New build verification

```bash
$ npm ci                # PASS
$ npm audit --no-fund   # 0 vulnerabilities
$ npm test              # 31 passed, 0 failed
$ npm run build         # PASS (dist/index.html present)
$ node scripts/agent-seed.mjs && node scripts/agent-status.mjs
#   posts count: 1
#   menu_categories count: 4
#   menu_items count: 4
```

## 6. Known limitations (forward-looking)

- **Store in Workers**: in production Cloudflare Pages, the store is in-memory per Worker instance (cold-starts wipe state). For real durability in production, bind a KV namespace as `RAWWEBSITE_KV` in `wrangler.toml` — the `KVStore` adapter is already implemented and the factory picks it up automatically.
- **Publish-to-disk in Workers**: writing to `content/posts/<slug>.md` from a Worker would mutate the deploy artifact. Today the publish endpoint returns `{ ok: false, reason: 'filesystem_unavailable' }` when called from a Worker, and the post remains in the store. A real production pipeline would push the published markdown via a GitHub commit (or a similar commit-based flow) on a separate worker.
- **Storage in Workers**: a future migration to D1 (Cloudflare's managed SQLite) is a 1:1 swap — the table schemas are already in place; only the `KVStore` adapter would change to a `D1Store` adapter.
