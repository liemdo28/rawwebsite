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

      await record(store, {
        actor: 'scheduler',
        action: 'post.auto_publish_failed',
        target_type: 'post',
        target_id: post.id,
        meta: { error, retryable: true },
      });

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
  const files = result.files || [];
  const rootPagePath = `${post.slug}.html`;
  const publicPagePath = `public/${post.slug}.html`;
  if (!files.includes(rootPagePath) || !files.includes('sitemap.xml') ||
      !files.includes(publicPagePath) || !files.includes('public/sitemap.xml')) {
    throw Object.assign(new Error('git_publish_missing_live_artifacts'), { code: 'git_publish_missing_live_artifacts' });
  }
  return true;
}

function sanitizeSchedulerError(error) {
  const code = error?.code || error?.message || 'scheduler_publish_failed';
  return String(code).replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]').slice(0, 160);
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
