/**
 * functions/api/content/publish.js — Publish a post with Git commit.
 *
 * POST /api/content/publish?id=...
 *   Transitions post to published and commits to Git.
 *   Admin auth required.
 *
 * This endpoint:
 *   1. Validates post exists and is in publishable state
 *   2. Transitions: current_status → publishing → published
 *   3. Commits markdown to Git (if GitHub credentials configured)
 *   4. Records audit log with commit hash
 */

import { loadConfig } from '../../../lib/config.js';
import { createStore } from '../../../lib/store.js';
import { transitionPost, postToMarkdown } from '../../../lib/posts.js';
import { commitToGit, buildGitAuditEntry } from '../../../lib/gitPublish.js';
import { record } from '../../../lib/auditLog.js';
import {
  ok, err, verifyAdmin, withCors, handleOptions,
} from '../../../lib/auditLog.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);

  if (request.method !== 'POST') {
    return withCors(err('method_not_allowed', 'POST only', 405));
  }

  const config = loadConfig(env);
  const store = createStore(env, { dataDir: config.dataDir });

  const actor = verifyAdmin(request, config.admin.secret);
  if (!actor) return withCors(err('unauthorized', 'admin Bearer token required', 401));

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return withCors(err('id_required', 'id query param required', 400));

  const post = await store.get('posts', id);
  if (!post) return withCors(err('not_found', 'post not found', 404));

  // Verify post is in publishable state (approved or scheduled)
  const publishableStatuses = ['approved', 'scheduled'];
  if (!publishableStatuses.includes(post.status)) {
    return withCors(err('not_publishable', `post status must be one of: ${publishableStatuses.join(', ')}`, 400, {
      current_status: post.status,
    }));
  }

  try {
    // Step 1: Transition to 'publishing'
    const publishing = await transitionPost(store, id, 'publishing', {
      actor,
      meta: { trigger: 'api_publish' },
    });

    // Step 2: Attempt Git commit if credentials available
    let gitResult = null;
    if (env.GITHUB_TOKEN && env.GITHUB_OWNER && env.GITHUB_REPO) {
      gitResult = await commitToGit(env, publishing, { actor });

      // Record git commit in audit log
      await record(store, buildGitAuditEntry(gitResult, {
        actor,
        targetType: 'post',
        targetId: id,
      }));
    }

    // Step 3: Transition to 'published'
    const published = await transitionPost(store, id, 'published', {
      actor,
      meta: { git: gitResult },
    });

    await record(store, {
      actor,
      action: 'post.publish',
      target_type: 'post',
      target_id: id,
      meta: {
        git_commit: gitResult?.commit,
        git_ok: gitResult?.ok,
      },
    });

    return withCors(ok({
      post: published,
      git: gitResult,
    }));
  } catch (e) {
    // Attempt to transition to 'failed' status
    try {
      await transitionPost(store, id, 'failed', {
        actor,
        meta: { error: e.message },
      });
    } catch { /* ignore */ }

    await record(store, {
      actor,
      action: 'post.publish_failed',
      target_type: 'post',
      target_id: id,
      meta: { error: e.message },
    });

    return withCors(err('publish_failed', e.message, 500));
  }
}
