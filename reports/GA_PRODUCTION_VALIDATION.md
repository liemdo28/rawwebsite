# GA Production Validation Report

**Date**: [PENDING — Requires Cloudflare deployment]
**Environment**: Production Candidate
**Validator**: [NAME]
**Status**: ⏳ PENDING

---

## Overview

This report documents the General Availability (GA) validation for RawWebsite.
All tests must pass on real Cloudflare infrastructure before release.

---

## 1. Content Creation Tests

### 1.1 Page Creation
| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| POST /api/pages/pages (create draft) | 201 with page.id | | ⏳ |
| GET /api/pages/pages?id=... | Page data returned | | ⏳ |
| PATCH /api/pages/pages?id=... | Page updated | | ⏳ |
| Transition to published | Status = published | | ⏳ |
| Public URL accessible | 200 OK | | ⏳ |

**Evidence**:
```json
{
  "page_id": "",
  "slug": "",
  "public_url": "",
  "response_time_ms": ""
}
```

### 1.2 Blog Post Creation
| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| POST /api/content/posts (create draft) | 201 with post.id | | ⏳ |
| Transition draft → pending_review | Status changed | | ⏳ |
| Transition pending_review → approved | Status changed | | ⏳ |
| Transition approved → published | Status changed | | ⏳ |
| Git commit triggered | Commit SHA returned | | ⏳ |
| Public blog URL accessible | 200 OK | | ⏳ |

**Evidence**:
```json
{
  "post_id": "",
  "slug": "",
  "commit_sha": "",
  "public_url": ""
}
```

### 1.3 Menu Item Creation
| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| POST /api/menu/items | 201 with item.id | | ⏳ |
| GET /api/menu/items | Item in list | | ⏳ |
| Menu visible on public page | Item displayed | | ⏳ |

**Evidence**:
```json
{
  "item_id": "",
  "name": "",
  "price": ""
}
```

### 1.4 Image Upload
| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| POST /api/media/upload (multipart) | 201 with media.id | | ⏳ |
| Image stored in R2 | R2 key returned | | ⏳ |
| Image accessible via public URL | 200 + image data | | ⏳ |

**Evidence**:
```json
{
  "media_id": "",
  "r2_key": "",
  "public_url": "",
  "size_bytes": ""
}
```

---

## 2. Publish via Agent-Coding

| Content Type | Created | Published | Public | Status |
|--------------|---------|-----------|--------|--------|
| Page | ⏳ | ⏳ | ⏳ | ⏳ |
| Blog Post | ⏳ | ⏳ | ⏳ | ⏳ |
| Menu Item | ⏳ | ⏳ | ⏳ | ⏳ |
| Image | ⏳ | ⏳ | ⏳ | ⏳ |

---

## 3. Visibility Verification

| Content | URL | HTTP Status | Rendered | Status |
|---------|-----|-------------|----------|--------|
| Test Page | | | | ⏳ |
| Test Post | | | | ⏳ |
| Menu | | | | ⏳ |
| Image | | | | ⏳ |

---

## 4. Rollback Tests

### 4.1 Page Rollback
| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| Create version 1 | Version saved | | ⏳ |
| Update to version 2 | Version saved | | ⏳ |
| List versions | 2 versions | | ⏳ |
| Rollback to version 1 | Content restored | | ⏳ |

### 4.2 Post Rollback
| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| Publish post | Status = published | | ⏳ |
| Git commit created | SHA stored | | ⏳ |
| Transition to draft | Status = draft | | ⏳ |
| Public URL returns 404 | Content removed | | ⏳ |

### 4.3 Menu Rollback
| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| Create menu item | Item created | | ⏳ |
| Toggle active = false | Item hidden | | ⏳ |
| Toggle active = true | Item visible | | ⏳ |

---

## 5. Disaster Recovery Tests

### 5.1 Full Export
| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| GET /api/system/export | JSON backup returned | | ⏳ |
| Backup contains all tables | 10 tables | | ⏳ |
| Checksums present | All tables | | ⏳ |

### 5.2 Full Import
| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| Clear all data | Tables empty | | ⏳ |
| POST /api/system/import | Data restored | | ⏳ |
| Validate counts match | All match | | ⏳ |

### 5.3 Integrity Validation
| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| POST /api/system/validate | is_valid = true | | ⏳ |
| No mismatches | mismatches = [] | | ⏳ |

---

## 6. Permission Tests

See: `reports/PERMISSION_MATRIX_REPORT.md`

| Role | Read | Create | Publish | Delete | Status |
|------|------|--------|---------|--------|--------|
| Admin | ✅ | ✅ | ✅ | ✅ | ⏳ |
| Editor | ✅ | ✅ | ❌ | ✅ | ⏳ |
| Reviewer | ✅ | ❌ | ❌ | ❌ | ⏳ |
| Publisher | ✅ | ❌ | ✅ | ❌ | ⏳ |
| ReadOnly | ✅ | ❌ | ❌ | ❌ | ⏳ |

---

## 7. Rate Limiting Tests

See: `reports/RATE_LIMIT_VALIDATION.md`

| Endpoint | Limit | Test Method | Result | Status |
|----------|-------|-------------|--------|--------|
| /api/* (anon) | 60/min | Flood 100 requests | | ⏳ |
| /api/* (auth) | 300/min | Flood 400 requests | | ⏳ |
| /api/media/upload | 20/min | Flood 30 uploads | | ⏳ |

---

## 8. Git Publishing Tests

| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| Publish post | Git commit created | | ⏳ |
| Check content/posts/*.md | File exists | | ⏳ |
| Check content/index.json | Entry exists | | ⏳ |
| Commit hash in audit_log | SHA recorded | | ⏳ |

**Evidence**:
```json
{
  "commit_sha": "",
  "file_path": "",
  "github_url": ""
}
```

---

## 9. Scheduler Tests

| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| Create post with publish_at = now + 5min | Status = scheduled | | ⏳ |
| Wait for cron (or POST /api/scheduler/run) | Status = published | | ⏳ |
| No human intervention required | Automated | | ⏳ |

**Evidence**:
```json
{
  "scheduled_at": "",
  "published_at": "",
  "triggered_by": "cron"
}
```

---

## Final Verdict

| Category | Pass | Fail | Skip |
|----------|------|------|------|
| Content Creation | | | |
| Publishing | | | |
| Visibility | | | |
| Rollback | | | |
| Disaster Recovery | | | |
| Permissions | | | |
| Rate Limiting | | | |
| Git Publishing | | | |
| Scheduler | | | |
| **Total** | | | |

**Overall Status**: ⏳ PENDING

---

## Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| QA Engineer | | | |
| DevOps | | | |
| Product Owner | | | |
| CEO | | | |

---

## Notes

```
[Add any observations, issues, or recommendations here]
```
