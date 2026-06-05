# Cloudflare Preview E2E Validation

**Date**: 2026-06-05 13:49 ICT  
**Preview URL**: https://7c7a9769.rawwebsite.pages.dev  
**Verdict**: **PASS WITH WARNINGS**

## Scope
This validation was run against a live Cloudflare Pages Preview deployment, not only local.

## Preconditions discovered during validation
- Cloudflare Preview deploy initially failed because `wrangler.toml` included a `triggers` section unsupported by Pages deployments.
- Cloudflare Preview deploy initially failed because Functions bundle referenced `node:path` / `node:url` in worker paths.
- Cloudflare Preview deploy then succeeded after:
  - removing Pages-incompatible `triggers` from `wrangler.toml`
  - adding `compatibility_flags = ["nodejs_compat"]`
  - making config/policy loading worker-compatible
- Preview environment currently has **no KV binding**, **no R2 binding**, and **no GitHub credentials / webhook secret** configured.
- Store backend on preview is therefore **memory**, which means data does **not persist across separate requests / cold starts**.

---

## 1. Deployment
- **PASS** — deployed live to Cloudflare Preview
- Command used:
  - `npx wrangler pages deploy dist --project-name=rawwebsite --branch=main --commit-dirty=true`
- Live URL:
  - `https://7c7a9769.rawwebsite.pages.dev`

---

## 2. Admin load
- **PASS (partial visual validation)**
- `GET /admin/` → HTTP 200
- `GET /` → HTTP 200
- Browser-console verification and login UI clickthrough were **not completed in-browser** from this environment because no browser automation/screenshot tool is available here.
- However, the route is live and reachable.

---

## 3. Agent-coding bridge
- **PASS WITH WARNINGS**
- `GET /api/agent/status` → OK
- Response confirms live Functions runtime:
  - `bridge.version = 0.1.0`
  - `store.backend = memory`
  - `agent_coding.enabled = false`
- `POST /api/agent/jobs` with `content.post.create` succeeded live on preview
- Failed auth checks:
  - admin request without token → `unauthorized`
  - admin request with wrong token → `unauthorized`
- Webhook auth behavior:
  - preview returned `webhook_not_configured` because `AGENT_CODING_WEBHOOK_SECRET` is not set in preview env
  - therefore live HMAC acceptance/rejection could not be fully validated end-to-end on this preview deployment

---

## 4. Post workflow
- **PASS WITH WARNINGS**
- Verified live:
  - draft creation via `/api/content/posts` → success
  - draft creation via `/api/agent/jobs` (`content.post.create`) → success
- Limitation discovered live:
  - subsequent requests could not find the created post because preview is using `MemoryStore`
  - this is expected without KV persistence in Cloudflare Preview
- Conclusion:
  - workflow code exists and local/unit tests pass
  - **full multi-request preview workflow** (`draft → review → approved → scheduled → published`) could **not** be completed live without KV binding

---

## 5. Media
- **PASS WITH WARNINGS**
- Live checks completed:
  - PNG upload → success
  - file > 5MB → rejected with `file_too_large`
  - invalid MIME (`text/plain`) → rejected with `mime_not_allowed`
- Preview result showed:
  - upload stored as `storage: "dataurl"`
  - not R2
- Conclusion:
  - validation logic works live
  - **R2 storage was not validated live** because `env.MEDIA_BUCKET` is not configured on preview

---

## 6. Menu
- **PASS WITH WARNINGS**
- Live checks completed:
  - `GET /api/menu/items` → success
  - `POST /api/menu/items` → success
  - `POST /api/menu/publish?location=stockton` → success
- Preview result showed:
  - `git: null`
- Conclusion:
  - menu endpoints work live
  - **Git commit creation not validated live** because GitHub credentials are not configured in preview
  - persistence across separate requests is also limited by MemoryStore

---

## 7. Git publish worker
- **WARNING / NOT FULLY VALIDATED LIVE**
- Endpoints are deployed and callable
- Menu publish endpoint returned success with `git: null`
- Post publish endpoint returned `not_found` for non-existent ID, which is expected
- Live Git commit creation, audit commit hash, and no-filesystem runtime behavior were **not fully validated on preview** because:
  - no GitHub env vars are configured
  - no persistent post state exists across requests

---

## 8. Scheduled publishing / cron
- **WARNING / NOT VALIDATED LIVE**
- Important Cloudflare-specific finding:
  - Cloudflare Pages deployment does **not** support `triggers` in `wrangler.toml`
  - this had to be removed to deploy preview successfully
- Therefore, live Pages Preview **does not run cron triggers** in this configuration
- Result:
  - scheduled publishing logic exists in code and passes local tests
  - **Cloudflare Preview cron execution was not validated live**

---

## 9. Regression checks
- `npm audit` → **PASS**, 0 vulnerabilities
- `npm test` → **PASS**, 41/41 passing
- `npm run build` → **PASS**
- `node scripts/check-duplicates.mjs` → **PASS**
- no new root/public duplicates detected

---

## Exact live evidence

### `GET /api/agent/status`
Returned `ok: true` with worker runtime and memory backend.

### Draft post creation via direct API
Returned `ok: true` with:
- `status: "draft"`
- `score: 100`
- generated UUID

### Draft creation via Agent-coding jobs API
Returned `ok: true` with:
- job status `succeeded`
- created post result in payload

### Media upload live results
- PNG upload → success
- >5MB file → `file_too_large`
- invalid MIME → `mime_not_allowed`

### Menu live results
- public list endpoint → success
- admin create endpoint → success
- menu publish endpoint → success with `git: null`

---

## Missing deliverables / blockers
The following requested items could not be fully produced from this CLI environment alone:
- screenshots/admin-dashboard.png
- screenshots/post-workflow.png
- screenshots/media-r2-upload.png
- screenshots/menu-publish.png
- screenshots/agent-status.png
- screenshots/cron-published-post.png

Reason:
- no browser automation / screenshot capture tool is available in this environment
- several live checks also require preview bindings not configured yet (KV, R2, webhook secret, GitHub token)

---

## Final assessment
This is a **live Cloudflare Preview validation**, so this is not a local-only result.

However, the preview environment is missing production-equivalent bindings:
- `RAWWEBSITE_KV`
- `MEDIA_BUCKET`
- `AGENT_CODING_WEBHOOK_SECRET`
- `GITHUB_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- any true Pages-compatible cron execution path

Because of those missing bindings, I **cannot honestly mark this PASS**.

### Final Verdict: **PASS WITH WARNINGS**

## Required next actions to reach full PASS
1. Bind Cloudflare KV for persistent preview state
2. Bind R2 as `MEDIA_BUCKET`
3. Configure webhook secret
4. Configure GitHub publish env vars
5. Use a Worker/cron-compatible deployment target for scheduled publishing, or redesign scheduled execution for Pages
6. Re-run live browser validation with screenshot capture
