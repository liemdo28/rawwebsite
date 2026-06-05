# RawWebsite — Agent-coding Bridge

This document is the contract between the RawWebsite website and the
Agent-coding service. It describes the endpoints, the data model, the
command set, and the expected flow for an integration.

## 1. Trust model

The bridge is **outbound + inbound**:
- **Outbound**: the bridge calls Agent-coding's REST API to push job
  results, drafts, and sync state. Authenticated with a Bearer token
  in `Authorization`.
- **Inbound**: Agent-coding sends signed jobs to `/api/agent/webhook`.
  The signature is an HMAC-SHA256 of the raw request body, computed
  with `AGENT_CODING_WEBHOOK_SECRET`. The bridge verifies the
  signature before doing any work.

In addition, the **admin CMS** uses a separate Bearer token
(`RAWWEBSITE_ADMIN_SECRET`) for direct operator actions. Admin and
agent credentials are independent — an attacker who knows the admin
token cannot forge webhooks, and vice versa.

## 2. Configuration

Set the following on the Cloudflare Pages project (and locally in
`.env` for the CLI scripts):

| Env | Used by | Required | Description |
|---|---|---|---|
| `AGENT_CODING_API_BASE_URL` | outbound | yes (prod) | e.g. `https://agent.example.com/api/v1` |
| `AGENT_CODING_API_KEY` | outbound | yes (prod) | Bearer token for Agent-coding. |
| `AGENT_CODING_WEBHOOK_SECRET` | inbound | yes (prod) | Shared secret with Agent-coding. |
| `RAWWEBSITE_ADMIN_SECRET` | admin | yes (prod) | Admin Bearer token. |
| `RAWWEBSITE_DATA_DIR` | dev (file) | no | Where the FileStore writes (default `./data`). |
| `RAWWEBSITE_KV` (binding) | prod (kv) | optional | Cloudflare KV namespace for durability. |
| `STORE_BACKEND` | any | optional | `memory` \| `file` \| `kv`. Override the auto-detect. |

## 3. Public endpoints

These are documented in `docs/ADMIN_CMS_GUIDE.md` for the admin UI. They
are also the API surface for the bridge.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/agent/status` | none | Bridge health + last 20 jobs + last 20 audit entries. |
| `POST` | `/api/agent/status` | admin | Same; admin token unlocks the `admin_token_accepted: true` view. |
| `GET` | `/api/agent/jobs` | none | Last 50 jobs + supported command list. |
| `POST` | `/api/agent/jobs` | admin | Enqueue + process a job. Body: `{ command, payload, created_by? }`. |
| `POST` | `/api/agent/webhook` | HMAC | Inbound from Agent-coding. |
| `GET` | `/api/content/blog` | none | Public blog index (merges store + on-disk index). |
| `GET` | `/api/content/posts` | none | List posts (filter `?status=`, `?id=`). |
| `POST` | `/api/content/posts` | admin | Create a draft. |
| `PATCH` | `/api/content/posts/:id` | admin | Update a post. |
| `DELETE` | `/api/content/posts/:id` | admin | Remove a post. |
| `POST` | `/api/content/posts/:id/transition` | admin | Move through the workflow. Body: `{ to: "approved" \| ... }`. |
| `POST` | `/api/content/posts/:id/schedule` | admin | Body: `{ publish_at: "2026-06-15T18:00:00Z" }`. |
| `POST` | `/api/content/posts/:id/publish` | admin | Transition to publishing → published. |
| `POST` | `/api/content/posts/preview` | admin | Score a draft against the policy without saving. |
| `GET` | `/api/menu/items` | none | List items. |
| `POST` | `/api/menu/items` | admin | Create. |
| `PATCH` | `/api/menu/items/:id` | admin | Update. |
| `DELETE` | `/api/menu/items/:id` | admin | Remove. |
| `PATCH` | `/api/menu/items/:id` (with `{ active: null }`) | admin | Toggle. |
| `GET` | `/api/menu/categories` | none | List categories. |
| `POST` | `/api/menu/categories` | admin | Create. |
| `PATCH` | `/api/menu/categories?id=...` | admin | Update. |
| `DELETE` | `/api/menu/categories?id=...` | admin | Remove. |
| `GET` | `/api/media/upload` | none | List last 100 media rows. |
| `POST` | `/api/media/upload` | admin | Multipart upload. |

## 4. Job commands

The bridge accepts a fixed set of commands. Each is a self-contained
operation; the bridge never chains commands.

| Command | Payload shape |
|---|---|
| `content.post.create` | `{ title, slug, body, excerpt?, image?, primary_keyword?, secondary_keywords?, cta?, cta_url?, post_type?, target_audience?, location: 'raw_stockton' \| 'raw_modesto' }` |
| `content.post.update` | `{ id, patch: { ...same shape as create... } }` |
| `content.post.approve` | `{ id }` |
| `content.post.reject` | `{ id }` |
| `content.post.schedule` | `{ id, publish_at }` |
| `content.post.publish` | `{ id }` (transitions publishing → published; writes to `content/posts/<slug>.md` in Node) |
| `media.upload` | `{ url, alt, source?, mime?, size? }` (in production the actual upload goes to R2; the bridge records the metadata) |
| `menu.item.create` | `{ name, location, price, description?, active? }` |
| `menu.item.update` | `{ id, ... }` (any menu_item field) |
| `menu.item.toggle` | `{ id, active? }` (omit to flip) |
| `site.sync` | `{}` (returns row counts; updates `last_sync_at`) |

## 5. Webhook contract

Agent-coding POSTs to `/api/agent/webhook`:

```http
POST /api/agent/webhook HTTP/1.1
Host: www.rawsushibar.com
Content-Type: application/json
X-Agent-Coding-Signature: <hex hmac-sha256 of body>

{
  "command": "content.post.create",
  "payload": { "title": "...", "slug": "...", "body": "...", "location": "raw_stockton" },
  "external_id": "agent-job-12345"
}
```

- The `X-Agent-Coding-Signature` header is the lowercase hex digest of
  the raw body, computed with HMAC-SHA256 over the shared secret
  (`AGENT_CODING_WEBHOOK_SECRET`). Prefix `sha256=` is allowed.
- The endpoint reads the raw body BEFORE parsing JSON so the signature
  matches byte-for-byte.
- On success: `200 { ok: true, received: true, external_id, job, processed }`.
- On signature mismatch: `401 { ok: false, error: "invalid_signature" }`.
- On unknown command / validation failure: `400 { ok: false, error, message, ... }`.

The endpoint runs the job **synchronously** so Agent-coding can update
its UI from the same response. If you need higher throughput, the
caller can fire-and-forget and poll `/api/agent/jobs?id=...` for status.

## 6. Outbound contract (bridge → Agent-coding)

When a job completes, the bridge calls:

```http
POST <AGENT_CODING_API_BASE_URL>/jobs/<job_id>/result HTTP/1.1
Authorization: Bearer <AGENT_CODING_API_KEY>
Content-Type: application/json

{
  "status": "succeeded" | "failed",
  "result": { ... },        // command-specific (e.g., the created post)
  "error": "...",            // present only on failure
  "completed_at": "..."
}
```

Retries: 3 attempts with exponential backoff (250ms → 750ms → 2250ms).
4xx responses other than 408 / 429 abort immediately.

## 7. End-to-end example

**Agent-coding initiates a post:**

```bash
# 1. Compute signature
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

# 2. POST to webhook
curl -X POST https://www.rawsushibar.com/api/agent/webhook \
  -H "X-Agent-Coding-Signature: $SIG" \
  -H "Content-Type: application/json" \
  -d "$BODY"
```

**Admin approves and publishes via the CMS UI:**

1. Open `/admin/`, click **Posts**.
2. Click **Approve** on the pending row.
3. Click **Publish** on the approved row.
4. The markdown is written to `content/posts/<slug>.md`; the JSON
   index is updated; the next build ships both.

**Agent-coding fetches sync state:**

```bash
curl -H "Authorization: Bearer $ADMIN_SECRET" \
  -X POST https://www.rawsushibar.com/api/agent/status
```

## 8. Content policy

Every `content.post.create` and `content.post.update` is scored against
`config/content_policy.json`. The scorer returns:

```ts
{
  score: number,        // 0-100
  passed: boolean,
  hard_blocks: string[],
  soft_failures: string[],
  details: { body_length: number, exclamations: number, caps_runs: number }
}
```

A post with **any** `hard_blocks` is rejected outright
(`HTTP 400 policy_hard_block`). A post with no hard_blocks but a
`score < pass_threshold` (default 60) is **not** rejected but is
flagged in the admin UI for review.

## 9. Failure modes & recovery

- **Agent-coding offline when a job completes**: the `reportJobResult`
  call retries 3 times with backoff. If it still fails, the job is
  marked `succeeded` (or `failed`) locally; Agent-coding can poll
  `GET /api/agent/jobs?id=...` next time it's online.
- **Webhook signature mismatch**: the endpoint returns 401 and **does
  not** enqueue. The agent should not retry a mismatched signature
  with the same body — it indicates a secret rotation or a corrupt
  payload. Log + alert.
- **Job validation failure**: the job is recorded as `failed` with the
  validation error in the `error` field. The agent is expected to
  fix the payload and re-submit.
- **Worker cold start wipes the in-memory store**: in production, bind
  a KV namespace (`RAWWEBSITE_KV`) so the store survives cold starts.

## 10. Versioning

The bridge version is exposed in `GET /api/agent/status` under
`bridge.version`. Breaking changes to the job command set will bump
the minor version; new commands will be additive and listed in
`GET /api/agent/jobs` under `supported_commands`.
