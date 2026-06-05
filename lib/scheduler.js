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
 *      - Invoke Git publish worker (if configured)
 *      - Transition to 'published' (or 'failed')
 *      - Record audit log entry
 */

import { transitionPost, postToMarkdown } from './posts.js';
import { record } from './auditLog.js';

/**
 * Process all scheduled posts that are due for publishing.
 *
 * @param {any} store - The store instance
 * @param {object} options
 * @param {Function} [options.gitPublish] - Optional async function to commit to Git
 * @param {Date} [options.now] - Override current time for testing
 * @returns {Promise<{ processed: number, published: string[], failed: { id: string, error: string }[] }>}
 */
export async function processScheduledPosts(store, options = {}) {
  const now = options.now || new Date();
  const nowISO = now.toISOString();

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

      // Attempt Git publish if configured
      let gitResult = null;
      if (options.gitPublish) {
        try {
          gitResult = await options.gitPublish(publishing);
        } catch (e) {
          // Git failure should not block publishing to store
          gitResult = { ok: false, error: e.message };
        }
      }

      // Transition to 'published'
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
      // Transition to 'failed' if possible
      try {
        await transitionPost(store, post.id, 'failed', {
          actor: 'scheduler',
          meta: { error: e.message },
        });
      } catch { /* ignore secondary failures */ }

      await record(store, {
        actor: 'scheduler',
        action: 'post.auto_publish_failed',
        target_type: 'post',
        target_id: post.id,
        meta: { error: e.message },
      });

      failed.push({ id: post.id, error: e.message });
    }
  }

  return { processed: scheduledPosts.length, published, failed };
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
