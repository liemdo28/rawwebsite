/**
 * functions/api/scheduler/diagnostics.js — Read-only Git config check.
 *
 * GET /api/scheduler/diagnostics
 *   Auth: Bearer RAWWEBSITE_SCHEDULER_TOKEN (same as /api/scheduler/run)
 *
 * Confirms GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO/GITHUB_BRANCH resolve and
 * that the token can read the target branch ref — the exact same config
 * resolution commitToGit uses. Makes exactly one GitHub API call
 * (GET /repos/{owner}/{repo}/git/ref/heads/{branch}) and nothing else: no
 * commits, trees, blobs, branches, or issues. Never returns the token.
 */

import { verifyGitConfig } from '../../../lib/gitPublish.js';
import { verifyScheduler } from '../../../lib/schedulerAuth.js';
import { ok, err, withCors, handleOptions } from '../../../lib/auditLog.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);
  if (request.method !== 'GET') {
    return withCors(err('method_not_allowed', 'GET only', 405));
  }

  const actor = verifyScheduler(request, env);
  if (!actor) {
    return withCors(err('unauthorized', 'scheduler Bearer token required', 401));
  }

  const result = await verifyGitConfig(env);
  if (!result.ok) {
    const { error: git_error, ...safeResult } = result;
    return withCors(err('git_config_invalid', 'GitHub publication configuration failed verification', 424, {
      ...safeResult,
      git_error,
    }));
  }

  return withCors(ok(result));
}
