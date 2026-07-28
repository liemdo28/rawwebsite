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
import { processScheduledPosts, reconcileStalePublishing } from '../../../lib/scheduler.js';
import { commitToGit, buildGitAuditEntry, verifyGitArtifact } from '../../../lib/gitPublish.js';
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

  const hasGitCredentials = !!(env.GITHUB_TOKEN && env.GITHUB_OWNER && env.GITHUB_REPO);

  const gitPublish = typeof env._gitPublish === 'function'
    ? env._gitPublish
    : hasGitCredentials
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

  // Recover posts stuck in 'publishing' from an interrupted prior run (e.g.
  // a Git commit succeeded but the KV write recording 'published' — and its
  // rollback-to-'scheduled' write — both then failed under quota exhaustion;
  // see the 2026-07-28 incident's critical partial-success case).
  // processScheduledPosts() below only ever scans status='scheduled', so a
  // stuck 'publishing' post would otherwise never be revisited. Read-only
  // against GitHub (verifyGitArtifact never creates a commit), so this can
  // never duplicate a publication.
  const verifyArtifact = typeof env._verifyArtifact === 'function'
    ? env._verifyArtifact
    : hasGitCredentials
    ? (post) => verifyGitArtifact(env, post)
    : null;
  const reconciliation = await reconcileStalePublishing(store, { verifyArtifact, now });

  const result = await processScheduledPosts(store, { gitPublish, now });

  // Best-effort, matching the gitPublish audit write above: this run's real
  // outcome (result, used for the response below) is already final by this
  // point. A housekeeping audit-log write must never turn an otherwise-
  // successful (or correctly fail-closed) scheduler run into a 500 — see the
  // 2026-07-28 incident where a Cloudflare KV daily write-quota error here
  // (KVStore._writeTable -> upsert -> record) surfaced as an uncaught
  // exception (error 1101) even though processScheduledPosts had already
  // completed with zero due posts and nothing left to publish.
  //
  // Skip the write entirely when there's nothing to report (processed:0 and
  // no stale posts reconciled): the GitHub Actions cron polls this endpoint
  // every 5 minutes (288 times/day), and on Cloudflare KV's free-tier daily
  // write quota (1,000/day), an unconditional no-op audit write here alone
  // would burn ~29% of the whole day's budget on runs where nothing
  // happened — the proximate cause of the 2026-07-28 incident. Meaningful
  // events (at least one due post processed, or a stale post reconciled)
  // still always get an audit entry; only pure no-op polls are skipped.
  // GitHub Actions' own run history remains the record of when no-op polls
  // occurred.
  const hadActivity = result.processed > 0 || reconciliation.checked > 0;
  if (hadActivity) {
    try {
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
          reconciled: reconciliation.reconciled,
          reverted: reconciliation.reverted,
          source: 'github_actions',
          github_run_id: request.headers.get('X-GitHub-Run-Id') || null,
          github_actor: request.headers.get('X-GitHub-Actor') || null,
        },
      });
    } catch { /* best effort */ }
  }

  if (result.failed.length > 0) {
    return withCors(err('scheduler_publish_failed', 'one or more due posts failed closed before publication', 424, {
      actor,
      now: now.toISOString(),
      reconciliation,
      ...result,
    }));
  }

  return withCors(ok({
    actor,
    now: now.toISOString(),
    reconciliation,
    ...result,
  }));
}
