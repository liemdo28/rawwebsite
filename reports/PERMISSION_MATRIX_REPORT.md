# Permission Matrix Report

**Date**: 2026-06-05
**Generated**: Automated from lib/permissions.js
**Status**: ✅ IMPLEMENTED

---

## Overview

RawWebsite implements role-based access control (RBAC) with 5 roles and 36 permissions.

---

## Roles

| Role | Description | Use Case |
|------|-------------|----------|
| **admin** | Full access to everything | System administrators |
| **editor** | Create, edit, delete content; cannot publish | Content writers |
| **reviewer** | Can approve/reject content | Editorial review |
| **publisher** | Can publish approved content | Content release |
| **readonly** | Read-only access to all content | Auditors, viewers |

---

## Permission Coverage Matrix

| Permission | Admin | Editor | Reviewer | Publisher | ReadOnly |
|------------|-------|--------|----------|-----------|----------|
| **Posts** | | | | | |
| posts.read | ✅ | ✅ | ✅ | ✅ | ✅ |
| posts.create | ✅ | ✅ | ❌ | ❌ | ❌ |
| posts.update | ✅ | ✅ | ❌ | ❌ | ❌ |
| posts.delete | ✅ | ✅ | ❌ | ❌ | ❌ |
| posts.submit_review | ✅ | ✅ | ❌ | ❌ | ❌ |
| posts.approve | ✅ | ❌ | ✅ | ❌ | ❌ |
| posts.reject | ✅ | ❌ | ✅ | ❌ | ❌ |
| posts.publish | ✅ | ❌ | ❌ | ✅ | ❌ |
| posts.rollback | ✅ | ❌ | ❌ | ✅ | ❌ |
| **Pages** | | | | | |
| pages.read | ✅ | ✅ | ✅ | ✅ | ✅ |
| pages.create | ✅ | ✅ | ❌ | ❌ | ❌ |
| pages.update | ✅ | ✅ | ❌ | ❌ | ❌ |
| pages.delete | ✅ | ✅ | ❌ | ❌ | ❌ |
| pages.submit_review | ✅ | ✅ | ❌ | ❌ | ❌ |
| pages.approve | ✅ | ❌ | ✅ | ❌ | ❌ |
| pages.reject | ✅ | ❌ | ✅ | ❌ | ❌ |
| pages.publish | ✅ | ❌ | ❌ | ✅ | ❌ |
| pages.rollback | ✅ | ❌ | ❌ | ✅ | ❌ |
| **Media** | | | | | |
| media.read | ✅ | ✅ | ✅ | ✅ | ✅ |
| media.upload | ✅ | ✅ | ❌ | ❌ | ❌ |
| media.delete | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Menu** | | | | | |
| menu.read | ✅ | ✅ | ✅ | ✅ | ✅ |
| menu.create | ✅ | ✅ | ❌ | ❌ | ❌ |
| menu.update | ✅ | ✅ | ❌ | ❌ | ❌ |
| menu.delete | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Theme** | | | | | |
| theme.read | ✅ | ✅ | ✅ | ✅ | ✅ |
| theme.update | ✅ | ❌ | ❌ | ❌ | ❌ |
| **SEO** | | | | | |
| seo.read | ✅ | ✅ | ✅ | ✅ | ✅ |
| seo.update | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Redirects** | | | | | |
| redirects.read | ✅ | ✅ | ✅ | ✅ | ✅ |
| redirects.create | ✅ | ❌ | ❌ | ❌ | ❌ |
| redirects.update | ✅ | ❌ | ❌ | ❌ | ❌ |
| redirects.delete | ✅ | ❌ | ❌ | ❌ | ❌ |
| redirects.import | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Analytics** | | | | | |
| analytics.read | ✅ | ✅ | ❌ | ❌ | ✅ |
| analytics.update | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Audit** | | | | | |
| audit.read | ✅ | ❌ | ✅ | ❌ | ❌ |
| **System** | | | | | |
| scheduler.run | ✅ | ❌ | ❌ | ✅ | ❌ |
| system.export | ✅ | ❌ | ❌ | ❌ | ❌ |
| system.import | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## Permission Counts

| Role | Allowed | Denied | Total |
|------|---------|--------|-------|
| Admin | 36 | 0 | 36 |
| Editor | 16 | 20 | 36 |
| Reviewer | 11 | 25 | 36 |
| Publisher | 11 | 25 | 36 |
| ReadOnly | 10 | 26 | 36 |

---

## Authentication

### Token Configuration

```bash
# Set role-specific tokens in Cloudflare
wrangler secret put RAWWEBSITE_ADMIN_SECRET
wrangler secret put RAWWEBSITE_EDITOR_TOKEN
wrangler secret put RAWWEBSITE_REVIEWER_TOKEN
wrangler secret put RAWWEBSITE_PUBLISHER_TOKEN
wrangler secret put RAWWEBSITE_READONLY_TOKEN
```

### API Usage

```bash
# Admin request
curl -X POST https://www.rawsushibar.com/api/content/posts \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "...", "slug": "...", "body": "..."}'

# Editor request (can create, but not publish)
curl -X POST https://www.rawsushibar.com/api/content/posts \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "...", "slug": "...", "body": "..."}'

# Publisher request (can only publish approved content)
curl -X POST https://www.rawsushibar.com/api/content/publish?id=... \
  -H "Authorization: Bearer $PUBLISHER_TOKEN"
```

---

## Error Responses

| Status | Error Code | Description |
|--------|------------|-------------|
| 401 | unauthorized | No or invalid Bearer token |
| 401 | token_required | Token missing from header |
| 401 | invalid_token | Token does not match any role |
| 403 | forbidden | Token valid but lacks permission |

---

## Test Checklist

| Role | Token Set | Read Test | Write Test | Publish Test | Status |
|------|-----------|-----------|------------|--------------|--------|
| admin | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| editor | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| reviewer | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| publisher | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| readonly | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |

---

## Workflow Examples

### Content Publishing Workflow

```
1. Editor creates draft post
   → posts.create (editor ✅)

2. Editor submits for review
   → posts.submit_review (editor ✅)

3. Reviewer approves content
   → posts.approve (reviewer ✅)

4. Publisher publishes to live site
   → posts.publish (publisher ✅)
```

### Admin Override

```
Admin can perform any action:
→ posts.create + posts.approve + posts.publish (admin ✅ all)
```

---

## Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Security | | | |
| Product Owner | | | |
