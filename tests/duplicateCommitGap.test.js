/**
 * tests/duplicateCommitGap.test.js — Reproduces and closes the documented
 * "rollback-success" duplicate-commit gap (2026-07-28 follow-up audit):
 *
 *   Run 1: scheduled -> publishing succeeds; the Git publication commit
 *          succeeds for real; the publishing -> published KV write fails;
 *          the rollback publishing -> scheduled write SUCCEEDS. Final state
 *          after run 1: 'scheduled' — but the real page + sitemap artifact
 *          already exists in the repo.
 *   Run 2: the same post is due and 'scheduled' again, so
 *          processScheduledPosts() picks it up exactly like any other due
 *          post and — before this fix — would call gitPublish/commitToGit
 *          again, creating a second, redundant commit.
 *
 * This is distinct from the CRITICAL sustained-failure case covered in
 * tests/schedulerFailureMatrix.test.js and tests/reconcileStalePublishing.test.js
 * (where rollback ALSO fails and the post gets stuck in 'publishing' —
 * recovered by reconcileStalePublishing). Here rollback succeeds, so the
 * post is never 'publishing' on the next scan — it's simply 'scheduled'
 * again, indistinguishable from a post that was never attempted at all,
 * which is exactly why processScheduledPosts() itself (not the separate
 * stale-'publishing' recovery path) needs a reconcile-before-publish check.
 *
 * IMPORTANT finding from isolating the two fixes independently (each
 * verified by temporarily git-stashing the other): the deterministic-
 * rendering fix (lib/renderArticlePage.js's content_updated_at change) is
 * what actually closes THIS specific reproduction on its own —
 * commitToGit() already has its own byte-for-byte content-diff idempotency
 * check, which only started working correctly once re-rendering the same
 * post twice stopped producing different bytes. With ONLY that fix
 * reverted (reconcile-before-publish left in place), run 2 still produced
 * 2 commits total. With BOTH fixes reverted, also 2. The explicit
 * reconcile-before-publish check added here (processScheduledPosts()'s new
 * options.verifyArtifact, checked before calling gitPublish) is real
 * defense-in-depth — it avoids the redundant GitHub round-trips
 * commitToGit's own check would otherwise still make, and reports the
 * outcome accurately as "reconciled" rather than a generic Git no-op — but
 * it is not, by itself, what prevents the duplicate commit in this exact
 * scenario. Both fixes are included below; this test's assertions require
 * both to be present, so it fails if either is reverted.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/scheduler/run.js';

const TOKEN = 'test-scheduler-token';
const GIT_ENV = { GITHUB_TOKEN: 'ghp_test', GITHUB_OWNER: 'acme', GITHUB_REPO: 'site', GITHUB_BRANCH: 'main' };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Stateful GitHub API mock: tracks what was actually committed via
 * /git/trees, and serves that real content back on subsequent /contents/
 * reads — exactly like a real repository, so a second run's verification
 * check sees genuine proof of the first run's commit. */
function installStatefulGitFetch() {
  const observed = [];
  const committedFiles = new Map();
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    observed.push({ method, path: u.pathname, body });
    if (method === 'GET' && u.pathname.endsWith('/git/ref/heads/main')) return jsonResponse({ object: { sha: 'base-commit', type: 'commit' } });
    if (method === 'GET' && u.pathname.endsWith('/git/commits/base-commit')) return jsonResponse({ sha: 'base-commit', tree: { sha: 'base-tree' } });
    if (method === 'GET' && u.pathname.includes('/contents/')) {
      const path = decodeURIComponent(u.pathname.split('/contents/')[1]);
      if (committedFiles.has(path)) {
        return jsonResponse({ sha: 'file-sha', content: Buffer.from(committedFiles.get(path)).toString('base64') });
      }
      return jsonResponse({ message: 'Not Found' }, 404);
    }
    if (method === 'POST' && u.pathname.endsWith('/git/trees')) {
      for (const item of body.tree) committedFiles.set(item.path, item.content);
      return jsonResponse({ sha: 'new-tree' });
    }
    if (method === 'POST' && u.pathname.endsWith('/git/commits')) return jsonResponse({ sha: 'real-commit-sha' });
    if (method === 'PATCH' && u.pathname.endsWith('/git/refs/heads/main')) return jsonResponse({ ref: 'refs/heads/main' });
    return jsonResponse({ message: 'Not Found' }, 404);
  };
  return { observed, committedFiles, restore() { globalThis.fetch = origFetch; } };
}

/** Fails exactly one specific KV put() call (1-indexed); all others succeed
 * — reproduces "Git succeeded, one specific KV write failed, but the very
 * next write (rollback) succeeded normally." */
function makeSingleFailureKv({ initialTables = {}, failAt = null } = {}) {
  const backing = new Map();
  for (const [table, rows] of Object.entries(initialTables)) {
    backing.set(`table:${table}`, JSON.stringify(rows));
  }
  let writeCount = 0;
  return {
    backing,
    async get(key) { return backing.has(key) ? backing.get(key) : null; },
    async put(key, value) {
      writeCount += 1;
      if (writeCount === failAt) throw new Error('KV put() limit exceeded for the day.');
      backing.set(key, value);
    },
    async delete(key) { backing.delete(key); },
    async list() { return { keys: [...backing.keys()].map(name => ({ name })) }; },
  };
}

function makeRequest() {
  return new Request('https://rawwebsitenew.pages.dev/api/scheduler/run', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
}

function commitCreatingCalls(fetchMock) {
  return fetchMock.observed.filter(o => o.method === 'POST' && o.path.endsWith('/git/commits'));
}

test('REPRODUCTION + FIX: rollback-success duplicate-commit gap — run 1 (Git succeeds, KV write fails, rollback succeeds, final=scheduled) then run 2 (same due post) creates exactly ONE commit total, not two', async () => {
  const fetchMock = installStatefulGitFetch();
  try {
    const post = {
      id: 'campaign-rollback-success-post-1',
      slug: 'rollback-success-post',
      title: 'Rollback Success Post',
      body: 'Body.',
      status: 'scheduled',
      publish_at: '2020-01-01T00:00:00.000Z',
    };

    // --- Run 1 ---------------------------------------------------------
    // Fail exactly the 4th KV write (publishing -> published), letting the
    // rollback (writes 5+) succeed normally — this is the "rollback
    // succeeds" branch, distinct from the sustained-failure CRITICAL case.
    const kv1 = makeSingleFailureKv({ initialTables: { posts: [post] }, failAt: 4 });
    const run1 = await onRequest({ request: makeRequest(), env: { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: kv1, ...GIT_ENV } });

    assert.equal(run1.status, 424, 'run 1 must fail closed (the publish did not complete)');
    const postsAfterRun1 = JSON.parse(kv1.backing.get('table:posts'));
    assert.equal(postsAfterRun1.find(p => p.id === post.id).status, 'scheduled', 'precondition: rollback succeeded — post is scheduled again, not stuck in publishing');
    assert.equal(commitCreatingCalls(fetchMock).length, 1, 'precondition: exactly one real commit was created in run 1');

    // --- Run 2 -----------------------------------------------------------
    // KV is fully writable again. The post is due and 'scheduled' — from
    // processScheduledPosts()'s point of view this looks identical to any
    // other due post it has never seen before.
    const auditAfterRun1 = JSON.parse(kv1.backing.get('table:audit_log') || '[]');
    const kv2 = makeSingleFailureKv({ initialTables: { posts: postsAfterRun1, audit_log: auditAfterRun1 } }); // no failures
    const run2 = await onRequest({ request: makeRequest(), env: { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: kv2, ...GIT_ENV } });

    assert.equal(run2.status, 200, `expected run 2 to succeed, got ${run2.status}: ${JSON.stringify(await run2.clone().json())}`);
    const body2 = await run2.json();
    assert.deepEqual(body2.published, [post.id]);
    assert.deepEqual(body2.reconciled, [post.id], 'run 2 must report this as reconciled, not newly published');

    const postsAfterRun2 = JSON.parse(kv2.backing.get('table:posts'));
    assert.equal(postsAfterRun2.find(p => p.id === post.id).status, 'published');

    // The assertion this whole test exists for.
    assert.equal(commitCreatingCalls(fetchMock).length, 1, 'must still be exactly ONE commit-creating call across BOTH runs — no duplicate publication commit');

    // The sitemap must contain the URL exactly once.
    const sitemapXml = fetchMock.committedFiles.get('public/sitemap.xml');
    const locCount = (sitemapXml.match(/<loc>https:\/\/www\.rawsushibar\.com\/rollback-success-post\.html<\/loc>/g) || []).length;
    assert.equal(locCount, 1, 'the sitemap URL must never be duplicated');
  } finally {
    fetchMock.restore();
  }
});
