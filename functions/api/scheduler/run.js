/**
 * functions/api/scheduler/run.js — Protected scheduled publish endpoint.
 *
 * POST /api/scheduler/run
 *   Auth: Bearer RAWWEBSITE_SCHEDULER_TOKEN
 *
 * Body (optional):
 *   { now?: string }
 *
 * Behavior:
 *   - verifies scheduler token
 *   - scans scheduled posts with publish_at <= now
 *   - transitions scheduled -> publishing -> published
 *   - records audit log with scheduler actor + meta
 */

import { loadConfig } from '../../../lib/config.js';
import { createStore } from '../../../lib/store.js';
import { processScheduledPosts } from '../../../lib/scheduler.js';
import { commitToGit, buildGitAuditEntry } from '../../../lib/gitPublish.js';
import { verifyScheduler } from '../../../lib/schedulerAuth.js';
import { record, ok, err, readJson, withCors, handleOptions } from '../../../lib/auditLog.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);
  if (request.method !== 'POST') {
    return withCors(err('method_not_allowed', 'POST only', 405));
  }

  const actor = verifyScheduler(request, env);
  if (!actor) {
    return withCors(err('unauthorized', 'scheduler Bearer token required', 401));
  }

  const config = loadConfig(env);
  const store = createStore(env, { dataDir: config.dataDir });

  let parsed = { ok: true, data: {} };
  const ct = request.headers.get('content-type') || '';
  if (ct.toLowerCase().includes('application/json')) {
    parsed = await readJson(request);
    if (!parsed.ok) return withCors(err(parsed.error, 'bad request body', 400));
  }

  const requestedNow = parsed.data?.now;
  const now = requestedNow && !Number.isNaN(Date.parse(String(requestedNow)))
    ? new Date(String(requestedNow))
    : new Date();

  const gitPublish = (env.GITHUB_TOKEN && env.GITHUB_OWNER && env.GITHUB_REPO)
    ? async (post) => {
        const result = await commitToGit(env, post, { actor });
        try {
          await record(store, buildGitAuditEntry(result, {
            actor,
            targetType: 'post',
            targetId: post.id,
          }));
        } catch { /* best effort */ }
        return result;
      }
    : null;

  const result = await processScheduledPosts(store, { gitPublish, now });

  await record(store, {
    actor,
    action: 'scheduler.run',
    target_type: 'system',
    target_id: 'scheduled-publish',
    meta: {
      now: now.toISOString(),
      processed: result.processed,
      published: result.published,
      failed: result.failed,
      source: 'github_actions',
      github_run_id: request.headers.get('X-GitHub-Run-Id') || null,
      github_actor: request.headers.get('X-GitHub-Actor') || null,
    },
  });

  return withCors(ok({
    actor,
    now: now.toISOString(),
    ...result,
  }));
}
