/**
 * lib/scheduler.js — Scheduled publishing processor.
 *
 * Called by the Cloudflare cron trigger to auto-publish posts where
 * scheduled_at <= now. Also supports setting posts to 'scheduled' status
 * with a future publish_at date.
 *
 * Workflow:
 *   1. Query all posts with status='scheduled'
 *   2. For each post where publish_at <= now:
 *      - Transition to 'publishing'
 *      - Invoke Git publish worker
 *      - Transition to 'published' only after a verified Git artifact commit
 *      - Record audit log entry
 */

import { transitionPost, postToMarkdown } from './posts.js';
import { record } from './auditLog.js';

/**
 * Process all scheduled posts that are due for publishing.
 *
 * @param {any} store - The store instance
 * @param {object} options
 * @param {Function} [options.gitPublish] - Async function to commit to Git
 * @param {boolean} [options.requireGitPublish=true] - Fail closed unless Git publishing succeeds
 * @param {Date} [options.now] - Override current time for testing
 * @returns {Promise<{ processed: number, published: string[], failed: { id: string, error: string }[] }>}
 */
export async function processScheduledPosts(store, options = {}) {
  const now = options.now || new Date();
  const nowISO = now.toISOString();
  const requireGitPublish = options.requireGitPublish !== false;

  const allPosts = await store.list('posts');
  const scheduledPosts = allPosts.filter(p =>
    p.status === 'scheduled' &&
    p.publish_at &&
    p.publish_at <= nowISO
  );

  const published = [];
  const failed = [];

  for (const post of scheduledPosts) {
    try {
      // Transition to 'publishing'
      const publishing = await transitionPost(store, post.id, 'publishing', {
        actor: 'scheduler',
        meta: { scheduled_at: post.publish_at, triggered_at: nowISO },
      });

      if (requireGitPublish && typeof options.gitPublish !== 'function') {
        throw Object.assign(new Error('git_publish_required'), { code: 'git_publish_required' });
      }

      let gitResult = null;
      if (typeof options.gitPublish === 'function') {
        gitResult = await options.gitPublish(publishing);
      }
      if (requireGitPublish) {
        validateGitPublishResult(gitResult, publishing);
      }

      const publishedPost = await transitionPost(store, post.id, 'published', {
        actor: 'scheduler',
        meta: { git: gitResult },
      });

      // Best-effort: the post is already genuinely published at this point
      // (transitionPost's own write above is what makes it real). If this
      // secondary audit-log write fails (e.g. KV write-quota exhausted), it
      // must not fall into the catch block below and get misreported as a
      // publish failure for a post that actually succeeded.
      try {
        await record(store, {
          actor: 'scheduler',
          action: 'post.auto_publish',
          target_type: 'post',
          target_id: post.id,
          meta: {
            scheduled_at: post.publish_at,
            published_at: publishedPost.published_at,
            git: gitResult,
          },
        });
      } catch { /* best effort */ }

      published.push(post.id);
    } catch (e) {
      const error = sanitizeSchedulerError(e);
      // Restore to scheduled so the fixed scheduler can retry after the
      // external publication problem is corrected.
      try {
        const current = await store.get('posts', post.id);
        if (current && current.status === 'publishing') {
          await transitionPost(store, post.id, 'scheduled', {
            actor: 'scheduler',
            meta: { error, restored_for_retry: true },
          });
        } else if (current && current.status !== 'published') {
          await store.upsert('posts', { ...current, status: current.status || 'scheduled' });
        }
      } catch {
        try {
          await transitionPost(store, post.id, 'failed', {
            actor: 'scheduler',
            meta: { error },
          });
        } catch { /* ignore secondary failures */ }
      }

      // Best-effort, matching the success path above: the real, material
      // outcome (failed.push below, returned to the caller) must not depend
      // on this housekeeping write succeeding — a KV write-quota failure
      // here must not crash the whole request (see the 2026-07-28 incident).
      try {
        await record(store, {
          actor: 'scheduler',
          action: 'post.auto_publish_failed',
          target_type: 'post',
          target_id: post.id,
          meta: { error, retryable: true },
        });
      } catch { /* best effort */ }

      failed.push({ id: post.id, error });
    }
  }

  return { processed: scheduledPosts.length, published, failed };
}

export function validateGitPublishResult(result, post) {
  if (!result || result.ok !== true) {
    throw Object.assign(new Error(result?.error || 'git_publish_failed'), { code: 'git_publish_failed' });
  }
  if (!result.commit || typeof result.commit !== 'string') {
    throw Object.assign(new Error('git_publish_missing_commit'), { code: 'git_publish_missing_commit' });
  }
  if (!result.repository || !result.branch) {
    throw Object.assign(new Error('git_publish_missing_repository'), { code: 'git_publish_missing_repository' });
  }
  // Only public/ is ever deployed (build.mjs copies public/ -> dist/; root-level
  // loose files are never touched by the build), so only those paths are
  // required here. Requiring a root-level duplicate caused an unnecessary
  // second "backfill" commit during the 2026-07-28 incident.
  const files = result.files || [];
  const publicPagePath = `public/${post.slug}.html`;
  if (!files.includes(publicPagePath) || !files.includes('public/sitemap.xml')) {
    throw Object.assign(new Error('git_publish_missing_live_artifacts'), { code: 'git_publish_missing_live_artifacts' });
  }
  // functions/_validPaths.mjs is the manifest _middleware.js checks every
  // request against to distinguish a real page from a soft-404 (see the
  // 2026-07-28 incident). Without it in the same commit, this post would
  // publish live but 404 until someone manually regenerated the manifest.
  if (!files.includes('functions/_validPaths.mjs')) {
    throw Object.assign(new Error('git_publish_missing_valid_paths_manifest'), { code: 'git_publish_missing_valid_paths_manifest' });
  }
  return true;
}

function sanitizeSchedulerError(error) {
  const code = error?.code || error?.message || 'scheduler_publish_failed';
  return String(code).replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]').slice(0, 160);
}

/** How long a post may sit in 'publishing' before it's considered stuck from
 * an interrupted run, rather than mid-flight. A normal publish takes a few
 * seconds (a handful of GitHub API calls); 10 minutes gives generous margin
 * for a slow request without leaving a genuinely stuck post unrecovered for
 * more than a couple of 5-minute polling cycles. */
export const DEFAULT_STALE_PUBLISHING_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Recover posts stuck in 'publishing' from an interrupted run.
 * processScheduledPosts() only ever scans status='scheduled' — a post stuck
 * in 'publishing' (e.g. a Git commit succeeded but the KV write recording
 * 'published' then failed, and the rollback-to-'scheduled' write also
 * failed — see the 2026-07-28 KV-quota incident's critical partial-success
 * case) would otherwise never be revisited by the normal due-post scan.
 *
 * Scoped to campaign posts (id starting with 'campaign-') — this project's
 * only automated-publish path with a well-defined expected artifact shape —
 * so this never reaches into unrelated, admin-managed posts.
 *
 * For each stale 'publishing' post (older than staleTimeoutMs):
 *   - If verifyArtifact(post) proves a real commit already exists, reconcile
 *     straight to 'published', preserving the original commit SHA. This
 *     never creates a new Git commit, so a stuck post can never be
 *     double-published.
 *   - Otherwise (no verifiable artifact — the commit itself never happened,
 *     or credentials are unavailable), revert to 'scheduled' so the normal
 *     due-post scan retries it on the next run, which will create a fresh
 *     commit since none exists yet.
 *
 * Never throws: a KV or verification failure for one post is caught and
 * simply leaves that post for the next run to retry, without blocking
 * reconciliation of any other stale post in the same batch.
 *
 * @param {any} store
 * @param {object} [options]
 * @param {Function} [options.verifyArtifact] - async (post) => { ok, commit?, repository?, branch?, files?, error? }
 * @param {Date} [options.now]
 * @param {number} [options.staleTimeoutMs]
 * @returns {Promise<{ checked: number, reconciled: string[], reverted: string[] }>}
 */
export async function reconcileStalePublishing(store, options = {}) {
  const now = options.now || new Date();
  const nowISO = now.toISOString();
  const staleTimeoutMs = options.staleTimeoutMs ?? DEFAULT_STALE_PUBLISHING_TIMEOUT_MS;

  const allPosts = await store.list('posts');
  const stale = allPosts.filter(p =>
    p.status === 'publishing' &&
    typeof p.id === 'string' && p.id.startsWith('campaign-') &&
    p.publish_at && p.publish_at <= nowISO &&
    p.updated_at && (now.getTime() - new Date(p.updated_at).getTime()) > staleTimeoutMs
  );

  const reconciled = [];
  const reverted = [];

  for (const post of stale) {
    let verified = null;
    if (typeof options.verifyArtifact === 'function') {
      try {
        verified = await options.verifyArtifact(post);
      } catch {
        verified = null;
      }
    }

    try {
      if (verified && verified.ok) {
        await transitionPost(store, post.id, 'published', {
          actor: 'scheduler',
          meta: { git: verified, reconciled: true },
        });
        try {
          await record(store, {
            actor: 'scheduler',
            action: 'post.reconciled_published',
            target_type: 'post',
            target_id: post.id,
            meta: {
              commit: verified.commit,
              repository: verified.repository,
              branch: verified.branch,
              stale_for_ms: now.getTime() - new Date(post.updated_at).getTime(),
            },
          });
        } catch { /* best effort */ }
        reconciled.push(post.id);
      } else {
        await transitionPost(store, post.id, 'scheduled', {
          actor: 'scheduler',
          meta: { reconciled: true, reverted_stale_publishing: true, verify_error: verified?.error || 'no_artifact_found' },
        });
        try {
          await record(store, {
            actor: 'scheduler',
            action: 'post.reconciled_reverted',
            target_type: 'post',
            target_id: post.id,
            meta: { reason: verified?.error || 'no_artifact_found' },
          });
        } catch { /* best effort */ }
        reverted.push(post.id);
      }
    } catch {
      // KV is still unwritable for this specific post — leave it stuck in
      // 'publishing' for the next reconciliation pass rather than losing
      // track of it or letting the failure block other stale posts.
    }
  }

  return { checked: stale.length, reconciled, reverted };
}

/**
 * Schedule a post for future publishing.
 *
 * @param {any} store
 * @param {string} postId
 * @param {string|Date} publishAt - ISO string or Date
 * @param {{ actor?: string }} [opts]
 */
export async function schedulePost(store, postId, publishAt, opts = {}) {
  const post = await store.get('posts', postId);
  if (!post) {
    throw Object.assign(new Error('not_found'), { code: 'not_found' });
  }

  // Validate publish_at is in the future
  const publishDate = typeof publishAt === 'string' ? new Date(publishAt) : publishAt;
  if (isNaN(publishDate.getTime())) {
    throw Object.assign(new Error('invalid_publish_at'), { code: 'invalid_publish_at' });
  }

  // Update the post with publish_at
  const updated = await store.upsert('posts', {
    ...post,
    publish_at: publishDate.toISOString(),
  });

  // Transition to 'scheduled' status
  const scheduled = await transitionPost(store, postId, 'scheduled', {
    actor: opts.actor || 'admin',
    meta: { publish_at: publishDate.toISOString() },
  });

  return scheduled;
}

/**
 * Get all posts currently in 'scheduled' status with their scheduled times.
 *
 * @param {any} store
 */
export async function listScheduledPosts(store) {
  const allPosts = await store.list('posts');
  return allPosts
    .filter(p => p.status === 'scheduled')
    .sort((a, b) => (a.publish_at || '').localeCompare(b.publish_at || ''));
}
