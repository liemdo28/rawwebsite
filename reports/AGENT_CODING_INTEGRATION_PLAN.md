# Agent-coding Integration Plan

Date: 2026-06-05

## Goal

Turn RawWebsite from a static marketing site into a website that
**Agent-coding can manage end-to-end**: posts, schedules, images, menu
items, and approval workflow. Every change is auditable, every published
post is policy-checked, and every action is reported back to Agent-coding.

## Status

| Capability | Status | Endpoint(s) |
|---|---|---|
| Create / read / update / delete post | ✅ DONE | `GET /api/content/posts`, `POST /api/content/posts`, `PATCH /api/content/posts/:id`, `DELETE /api/content/posts/:id` |
| Post workflow: draft → pending_review → approved → scheduled → publishing → published | ✅ DONE | `POST /api/content/posts/:id/transition`, `POST /api/content/posts/:id/schedule`, `POST /api/content/posts/:id/publish` |
| Score draft against content policy | ✅ DONE | `POST /api/content/posts/preview` |
| Publish to canonical markdown + index | ✅ DONE (Node); Worker-safe no-op in CF | `publishToDisk()` in `lib/posts.js` |
| Upload images (with MIME + size + alt validation) | ✅ DONE | `POST /api/media/upload` |
| Menu categories CRUD | ✅ DONE | `/api/menu/categories` |
| Menu items CRUD + toggle | ✅ DONE | `/api/menu/items`, `/api/menu/items/:id` |
| Admin CMS UI | ✅ DONE | `public/admin/index.html` (Dashboard, Posts, Calendar, Media, Menu, Agent, Audit, Settings) |
| Agent-coding bridge: status | ✅ DONE | `GET /api/agent/status` (public), `POST /api/agent/status` (admin) |
| Agent-coding bridge: enqueue jobs | ✅ DONE | `POST /api/agent/jobs` (admin) |
| Agent-coding bridge: inbound webhook (HMAC-SHA256) | ✅ DONE | `POST /api/agent/webhook` |
| Job queue + audit log | ✅ DONE | `data/tables/agent_jobs.json`, `data/tables/audit_log.json` |
| Persistence: local JSON + Cloudflare KV | ✅ DONE | `lib/store.js` (MemoryStore / FileStore / KVStore) |
| Content-policy scoring | ✅ DONE | `lib/contentPolicy.js` |
| Duplicate-file CI guard | ✅ DONE | `scripts/check-duplicates.mjs` |
| Tests (31 unit tests) | ✅ DONE | `npm test` (Node --test) |
| Documentation | ✅ DONE | `docs/ADMIN_CMS_GUIDE.md`, `docs/AGENT_CODING_BRIDGE.md` |

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Cloudflare Pages (production)                                       │
│  ┌────────────────────────┐    ┌─────────────────────────────────┐    │
│  │  Static files (public/)│    │  functions/ — Pages Functions   │    │
│  │  index.html            │    │  ┌───────────────────────────┐  │    │
│  │  stockton.html         │    │  │  functions/_middleware.js │  │    │
│  │  …                     │    │  │   - canonical-domain      │  │    │
│  │  admin/index.html (SPA)│◀───┼──│  functions/api/...         │  │    │
│  └────────────────────────┘    │  │   /api/agent/status       │  │    │
│                                │  │   /api/agent/jobs         │  │    │
│                                │  │   /api/agent/webhook      │  │    │
│                                │  │   /api/content/posts      │  │    │
│                                │  │   /api/content/blog       │  │    │
│                                │  │   /api/menu/...           │  │    │
│                                │  │   /api/media/upload       │  │    │
│                                │  └─────────┬─────────────────┘  │    │
│                                └────────────│────────────────────┘    │
│                                             │                         │
│                                             ▼                         │
│                                  ┌──────────────────────┐             │
│                                  │  Store adapter       │             │
│                                  │  KVStore (prod)      │             │
│                                  │  MemoryStore (no KV) │             │
│                                  └──────────────────────┘             │
│                                             │                         │
│                                             ▼                         │
│                                  ┌──────────────────────┐             │
│                                  │  Agent-coding HTTP   │             │
│                                  │  reportJobResult()   │─────────────┼──▶  Agent-coding
│                                  └──────────────────────┘             │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  Local dev (Node)                                                    │
│  ┌────────────────────────┐    ┌─────────────────────────────────┐    │
│  │  scripts/agent-*       │    │  tests/ — Node --test          │    │
│  │   - agent-status        │    │   31 passing                   │    │
│  │   - agent-seed          │    └─────────────────────────────────┘    │
│  │   - agent-export        │    ┌─────────────────────────────────┐    │
│  └────────────┬───────────┘    │  build.mjs (Windows-safe)      │    │
│               ▼                 └─────────────────────────────────┘    │
│   ┌──────────────────────┐                                              │
│   │  FileStore           │                                              │
│   │  data/tables/*.json  │                                              │
│   └──────────────────────┘                                              │
└──────────────────────────────────────────────────────────────────────┘
```

## Environment variables

| Var | Required | Default | Description |
|---|---|---|---|
| `RAWWEBSITE_ADMIN_SECRET` | prod | `dev-admin-secret` | Bearer token for admin auth. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `AGENT_CODING_API_BASE_URL` | prod | (empty) | Base URL Agent-coding uses to receive job results. |
| `AGENT_CODING_API_KEY` | prod | (empty) | Bearer token sent to Agent-coding on outbound calls. |
| `AGENT_CODING_WEBHOOK_SECRET` | prod | `dev-webhook-secret` | Shared secret for verifying HMAC-SHA256 signatures on inbound webhooks. |
| `RAWWEBSITE_DATA_DIR` | dev (file) | `./data` | Where the FileStore writes JSON files. |
| `RAWWEBSITE_KV` (binding) | prod (kv) | — | Cloudflare KV namespace binding. Setting this makes the bridge use durable KV. |
| `STORE_BACKEND` | optional | auto | `memory` \| `file` \| `kv`. Forces the adapter regardless of bindings. |

## Job lifecycle

```
queued ──▶ running ──▶ succeeded
            │
            └──────────▶ failed (with error message)
```

Each job produces an `agent_jobs` row + an `audit_log` entry. The
best-effort call to `client.reportJobResult` does NOT fail the job if
Agent-coding is offline.

## Approval workflow

```
draft ──▶ pending_review ──▶ approved ──▶ scheduled ──▶ publishing ──▶ published
                              │               │              │
                              │               │              └─────▶ failed
                              └─────▶ rejected
```

- **Hard rules**:
  - `published` is terminal (cannot move to another state).
  - `rejected` and `failed` can be reopened to `draft` or `pending_review`.
  - Transitions are enforced by `ALLOWED_TRANSITIONS` in `lib/posts.js` and unit-tested in `tests/posts.test.js`.
- **Publishing** in dev writes `content/posts/<slug>.md` + updates `content/index.json` so `public/blog-posts.html` picks it up.
- **Publishing** in Workers is a no-op (no `fs` available). The post is marked `published` in the store and a follow-up Git commit is the recommended production flow.

## End-to-end happy path

1. Agent-coding sends `POST /api/agent/webhook` with a signed job:
   ```json
   { "command": "content.post.create", "payload": { ... } }
   ```
2. The endpoint verifies the HMAC, enqueues a job, processes it (synchronous), and returns `{ job, processed }`.
3. The processed post is now in the store with `status: "draft"` and a `score` from the content-policy scorer.
4. Admin opens `/admin/`, sees the new draft, clicks **Submit → Approve → Schedule → Publish**.
5. Each action records an `audit_log` entry.
6. On **Publish**, the markdown is written to `content/posts/<slug>.md` and the JSON index is updated. The next build ships it to `public/content/posts/`.
7. `blog-posts.html` now lists and renders the new post without any code change.

## What's left for production hardening

- A real **scheduled-publish cron** (Cloudflare Cron Triggers) that flips `scheduled` posts whose `publish_at` is in the past to `publishing`. Today, scheduled posts are published manually via the admin.
- A **Git-based commit flow** for the markdown write step in Workers (e.g., a separate worker that calls `PUT /repos/:owner/:repo/contents/...` on the GitHub API).
- A **D1 adapter** for `lib/store.js` so the bridge uses Cloudflare D1
  (managed SQLite) instead of KV. The data model maps 1:1 to tables.
- **Per-location menu data** — currently a single `menu_items` table is
  filtered by `location`; if menus diverge further, split into per-location
  stores or use composite keys.

## Deployment

1. **Staging**:
   ```bash
   npm ci
   npm test
   npm run build
   wrangler pages deploy dist --project-name rawwebsite-staging
   ```
2. **Production**:
   - Add the following secrets to the Cloudflare Pages project:
     `RAWWEBSITE_ADMIN_SECRET`, `AGENT_CODING_API_BASE_URL`,
     `AGENT_CODING_API_KEY`, `AGENT_CODING_WEBHOOK_SECRET`.
   - Add a KV namespace binding `RAWWEBSITE_KV` (and the namespace ID in `wrangler.toml`).
   - Push to `main`; Cloudflare Pages builds from `package.json`'s `build` script
     (`node build.mjs`) and serves `dist/`.
3. **Agent-coding onboarding**:
   - Share the public base URL of the deployment.
   - Register the webhook URL: `https://www.rawsushibar.com/api/agent/webhook`.
   - Share `AGENT_CODING_WEBHOOK_SECRET` out-of-band so it can sign requests.
   - Share `AGENT_CODING_API_KEY` so the bridge can authenticate to Agent-coding.
