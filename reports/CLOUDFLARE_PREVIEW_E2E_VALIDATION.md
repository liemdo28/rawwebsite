# Cloudflare Preview E2E Validation

**Date**: 2026-06-05 13:55 ICT (initial) / 2026-06-05 14:53 ICT (live scheduler validated)  
**Preview URL (current)**: https://d6fc2444.rawwebsite.pages.dev  
**Scheduler path**: GitHub Actions workflow (every 5 minutes)  
**Verdict**: **PASS**

---

## 1. Live scheduled publish proof

The critical regression: scheduled publishing now auto-publishes live without admin click.

### Workflow run (PASS)
- Run: https://github.com/liemdo28/rawwebsite/actions/runs/27002667579
- Status: success
- Resolved URL: `https://d6fc2444.rawwebsite.pages.dev` (from `vars.RAWWEBSITE_PREVIEW_URL`)
- Log: `Resolved URL: https://d6fc2444.rawwebsite.pages.dev`
- HTTP: 200
- Post that auto-published:
  - `id: 02851be5-4468-482c-9cd5-98302b608d76`
  - `title: "Live Scheduler Validation Post"`
  - `status` after scheduler run: `published`
  - `published_at: 2026-06-05T07:51:09.551Z`
  - `publish_at: 2026-06-05T07:11:30.000Z`
  - (publish_at was set in the past so the next scheduled run would immediately pick it up)

### Live audit log (from `/api/agent/status` with admin auth)

```json
{
  "actor": "scheduler:github-actions",
  "action": "scheduler.run",
  "target_id": "scheduled-publish",
  "created_at": "2026-06-05T07:51:10.074Z"
},
{
  "actor": "scheduler",
  "action": "post.auto_publish",
  "target_id": "02851be5-4468-482c-9cd5-98302b608d76",
  "created_at": "2026-06-05T07:51:09.870Z"
},
{
  "actor": "scheduler",
  "action": "post.transition",
  "target_id": "02851be5-4468-482c-9cd5-98302b608d76",
  "created_at": "2026-06-05T07:51:09.689Z"
}
```

This proves the **end-to-end live scheduled publishing works**: GitHub Actions cron → workflow → scheduler endpoint → KV-backed post state → status `scheduled → published` without admin action.

---

## 2. Deployment
- **PASS** — live Cloudflare Preview URL: https://d6fc2444.rawwebsite.pages.dev
- KV namespace bound: `RAWWEBSITE_KV` (id `57a4e58e773445d590a658c7edecc853`)
- Store backend in preview: `kv` (persists across requests/cold starts)
- Secrets set on Pages:
  - `RAWWEBSITE_SCHEDULER_TOKEN`
  - `RAWWEBSITE_ADMIN_SECRET`

---

## 3. Admin load
- `GET /admin/` → 200
- `GET /` → 200
- `GET /api/agent/status` → 200 (KV backend confirmed)
- `POST /api/agent/status` with admin token → returns `admin_token_accepted: true`

---

## 4. Agent-coding bridge
- `GET /api/agent/status` → OK
- Live draft creation via `POST /api/content/posts` and `POST /api/agent/jobs` (content.post.create) both succeed
- Failed auth correctly rejected
- Webhook auth: `webhook_not_configured` is honest (no `AGENT_CODING_WEBHOOK_SECRET` set on preview)

---

## 5. Post workflow (live, with KV persistence)
Live transition chain verified:
- `draft` → `pending_review` → `approved` → `scheduled` (with `publish_at` in the past) → `published` (auto by scheduler)

This was observed for two separate posts in the live KV:
- `25776dd8-f33b-4231-ad91-63ddfb943748` (E2E Scheduled Stockton Post) — published 2026-06-05T07:08:48Z
- `02851be5-4468-482c-9cd5-98302b608d76` (Live Scheduler Validation Post) — published 2026-06-05T07:51:09Z

---

## 6. Media
- PNG upload → success
- >5MB upload → rejected (`file_too_large`)
- Invalid MIME (`text/plain`) → rejected (`mime_not_allowed`)
- R2 storage: not configured in preview, so dataURL fallback is in effect (as designed). MIME and size validation logic is verified live.

---

## 7. Menu
- `GET /api/menu/items` → success
- `POST /api/menu/items` (admin) → success
- `POST /api/menu/publish?location=stockton` → success with `git: null` (GitHub env vars not set on preview; this is a no-op path, intended)

---

## 8. Git publish worker
- Endpoints callable on preview.
- No live Git commit created (GitHub env vars not configured on preview); `git: null` returned as designed.
- Git publishing code path verified by unit tests.

---

## 9. Scheduled publishing — PASS
Implementation: GitHub Actions workflow at `.github/workflows/scheduled-publish.yml` with:
- `schedule.cron: "*/5 * * * *"` (every 5 min)
- `workflow_dispatch` for manual runs
- Service-token auth via `RAWWEBSITE_SCHEDULER_TOKEN` secret
- Variable `RAWWEBSITE_PREVIEW_URL` selects target preview
- Workflow POSTs to `/api/scheduler/run` on the preview URL
- Live evidence: https://github.com/liemdo28/rawwebsite/actions/runs/27002667579

---

## 10. Regression checks
- `npm audit` → **PASS**, 0 vulnerabilities
- `npm test` → **PASS**, 41/41 passing
- `npm run build` → **PASS**
- `node scripts/check-duplicates.mjs` → **OK**
- no new root/public duplicates

---

## Files added/changed for this iteration
- New: `lib/schedulerAuth.js`, `functions/api/scheduler/run.js`, `.github/workflows/scheduled-publish.yml`
- Modified: `wrangler.toml` (KV bound, `STORE_BACKEND=kv`)
- Cloudflare Pages secrets set: `RAWWEBSITE_SCHEDULER_TOKEN`, `RAWWEBSITE_ADMIN_SECRET`
- GitHub repo secret: `RAWWEBSITE_SCHEDULER_TOKEN`
- GitHub repo variable: `RAWWEBSITE_PREVIEW_URL`

---

## Final Verdict: **PASS**

This is a live, not a local-only, PASS.
- Live cron-driven scheduled publishing auto-published a post.
- KV-backed persistence allowed the workflow to mutate preview state correctly.
- All regression checks (audit/test/build/duplicates) are green.
- Git publish and R2 storage paths are wired and unit-tested; live validation of those depends on the operator setting up `GITHUB_*` and `MEDIA_BUCKET` bindings.
