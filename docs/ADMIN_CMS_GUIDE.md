# RawWebsite — Admin CMS Guide

The Admin CMS is a single-page web app served at `/admin/`. It calls the
Cloudflare Pages Functions API under `/api/*` and uses a Bearer token
in `localStorage` for authentication.

## 1. First-time setup

1. Generate a strong admin secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Set the secret on the Cloudflare Pages project:
   ```bash
   wrangler pages secret put RAWWEBSITE_ADMIN_SECRET --project-name rawwebsite-prod
   ```
3. Open `https://www.rawsushibar.com/admin/` in your browser.
4. In the **API base** input, leave the default (`/api`) unless you
   mounted the API under a different path.
5. In the **Admin token** input, paste the secret.
6. Click **Save**. The dashboard will load and confirm the bridge is
   connected.

The token is stored in `localStorage` only — it is never sent anywhere
besides the same-origin API endpoints via the `Authorization: Bearer …`
header.

## 2. Views

| View | What it does |
|---|---|
| **Dashboard** | Bridge health, last sync, count of jobs, last 10 jobs, Agent-coding connection card. Auto-refreshes every 30 s when visible. |
| **Posts** | Create draft posts (with content-policy scoring preview), list all posts with filters, transition a post through the workflow. |
| **Calendar** | Two tables: scheduled / approved posts grouped by `publish_at`, and recently published. |
| **Media** | Upload images (with required `alt` text), browse the media library. |
| **Menu** | Add/edit categories and items per location (`raw_stockton` / `raw_modesto`). |
| **Agent-coding** | Bridge connection card, last 20 jobs, **Trigger site.sync** button. |
| **Audit Log** | Append-only log of every state-changing action (admin + agent). |
| **Settings** | Shows the current bridge configuration and the raw status response. |

## 3. Post workflow

```
draft → pending_review → approved → scheduled → publishing → published
       ↘ rejected / failed
```

| Step | Who can do it | UI action |
|---|---|---|
| Create draft | Agent or admin | "Create draft" on Posts view |
| Submit for review | Author | "Submit" on a draft row |
| Approve / Reject | Reviewer | "Approve" / "Reject" on a pending row |
| Schedule | Editor | "Schedule" on an approved row, prompted for ISO 8601 timestamp |
| Publish | Editor | "Publish" on an approved/scheduled row, or "Publish now" on the calendar |
| Reopen rejected | Editor | "Submit" (loops back to pending_review) |

Every action:
- Validates the new state against `ALLOWED_TRANSITIONS` (HTTP 409 on
  illegal transitions, with `from` and `to` echoed in the response).
- Writes an `audit_log` row.
- Emits a job to `agent_jobs` only when triggered by Agent-coding
  (admin actions are recorded in the audit log directly).

## 4. Content policy preview

On the **Posts** view, fill in the form and click **Score against policy**
before saving. The response shows:

- `score` (0-100) and `passed` (boolean).
- `hard_blocks` — terms that immediately reject the post.
- `soft_failures` — quality issues that lowered the score.
- `details` — body length, exclamation count, ALL-CAPS run count.

The configured `pass_threshold` is in `config/content_policy.json`
under `scoring.pass_threshold` (currently 60).

## 5. Media uploads

- Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`,
  `image/gif`, `image/svg+xml`.
- Max size: **5 MB**.
- `alt` is **required** (accessibility). Empty alt fails with
  `alt_required`.
- The file is encoded to a data URL and stored in the media table.
  For production at scale, swap `lib/posts.js`'s `publishToDisk` and
  the upload handler in `functions/api/media/upload.js` for an R2
  PUT (`await env.MEDIA_BUCKET.put(key, stream)`) — the data-URL
  fallback is intentional for the static-deploy footprint.

## 6. Menus

Categories and items are stored separately. Categories are filtered
by `location`; items are filtered by `location` and can be toggled
active/inactive with the **Enable / Disable** button. Use the
**Delete** button (with confirm) to remove.

## 7. Audit log

Every state-changing call to the API appends an entry. Each entry has:
- `id` (uuid)
- `actor` (admin or `agent:<external_id>`)
- `action` (`post.create`, `post.transition`, `media.upload`, etc.)
- `target_type` + `target_id`
- `meta` (action-specific details)
- `created_at` (ISO 8601)

The admin UI shows the last 20 entries. The full log is available via
`GET /api/agent/status` (last 20) or `data/tables/audit_log.json` in
the local store.

## 8. Backup & restore

```bash
# Export the entire store to a single JSON file
node scripts/agent-export.mjs backups/$(date +%F).json

# The JSON has the shape:
# {
#   schema_version: 1,
#   exported_at: "...",
#   tables: { posts: [...], media: [...], ... },
#   state: { ... }
# }
```

There is no restore command yet — the JSON is human-readable and can
be replayed by writing it back to `data/tables/*.json` and reloading.
A `node scripts/agent-import.mjs <file>` is a one-day add; we left it
out to keep the scope tight.

## 9. Local development

```bash
# Run all unit tests
npm test

# Seed the local store with sample data
node scripts/agent-seed.mjs

# Print the bridge status
node scripts/agent-status.mjs

# Build the deploy artifact
npm run build
```

To test the admin UI locally, run `wrangler pages dev` and visit
`http://localhost:8788/admin/`.
