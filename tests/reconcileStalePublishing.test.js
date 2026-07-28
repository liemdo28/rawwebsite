/**
 * tests/reconcileStalePublishing.test.js — Tests for lib/scheduler.js's
 * reconcileStalePublishing() and the end-to-end recovery path it enables
 * (2026-07-28 KV-quota hardening follow-up, Parts 3 & 4).
 *
 * processScheduledPosts() only ever scans status='scheduled' — a post stuck
 * in 'publishing' from an interrupted run (a real Git commit succeeded, but
 * the KV write recording 'published', AND its rollback-to-'scheduled'
 * write, both then failed under sustained quota exhaustion — see
 * tests/schedulerFailureMatrix.test.js's CRITICAL test) would otherwise
 * never be revisited. reconcileStalePublishing() closes that gap:
 *   - stale (>10min in 'publishing') + verified artifact -> reconcile to
 *     'published', preserving the original commit SHA, no new commit.
 *   - stale + no verifiable artifact -> revert to 'scheduled' for a normal
 *     retry (which will create a fresh commit, since none exists).
 *   - scoped to campaign posts only; never touches unrelated admin posts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileStalePublishing, DEFAULT_STALE_PUBLISHING_TIMEOUT_MS } from '../lib/scheduler.js';
import { onRequest } from '../functions/api/scheduler/run.js';
import { MemoryStore, KVStore } from '../lib/store.js';

const TOKEN = 'test-scheduler-token';
const GIT_ENV = { GITHUB_TOKEN: 'ghp_test', GITHUB_OWNER: 'acme', GITHUB_REPO: 'site', GITHUB_BRANCH: 'main' };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * A stateful mock of the real GitHub REST API: tracks whatever content was
 * actually committed via the /git/trees call, and serves it back on
 * subsequent /contents/ reads — exactly like a real repository. This lets a
 * test run commitToGit() once (creating a real commit) and then run
 * verifyGitArtifact() afterward and see genuine proof of that commit,
 * without ever creating a second one.
 */
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

function makeFailureMock({ initialTables = {}, failFrom = null } = {}) {
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
      if (failFrom != null && writeCount >= failFrom) throw new Error('KV put() limit exceeded for the day.');
      backing.set(key, value);
    },
    async delete(key) { backing.delete(key); },
    async list() { return { keys: [...backing.keys()].map(name => ({ name })) }; },
  };
}

function makeRequest(now) {
  const bodyObj = now ? { now } : {};
  return new Request('https://rawwebsitenew.pages.dev/api/scheduler/run', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyObj),
  });
}

function makeStuckPost(overrides = {}) {
  return {
    id: 'campaign-stuck-post-1',
    slug: 'stuck-post',
    title: 'Stuck Post',
    body: 'Body.',
    status: 'publishing',
    publish_at: '2020-01-01T00:00:00.000Z',
    updated_at: new Date(Date.now() - DEFAULT_STALE_PUBLISHING_TIMEOUT_MS - 60_000).toISOString(), // 11 minutes ago
    ...overrides,
  };
}

// --- Unit tests for reconcileStalePublishing() directly ------------------

test('reconcileStalePublishing: a verified artifact reconciles to published, preserving the original commit SHA', async () => {
  const store = new MemoryStore();
  // replaceAll (not upsert) — upsert always stamps updated_at to "now",
  // which would defeat this fixture's deliberately-backdated staleness.
  await store.replaceAll('posts', [makeStuckPost()]);

  const result = await reconcileStalePublishing(store, {
    now: new Date(),
    verifyArtifact: async () => ({ verified: true, branchCommitSha: 'original-commit-sha', pageBlobSha: 'page-blob-sha', sitemapBlobSha: 'sitemap-blob-sha', repository: 'acme/site', branch: 'main', files: ['public/stuck-post.html', 'public/sitemap.xml'] }),
  });

  assert.deepEqual(result.reconciled, ['campaign-stuck-post-1']);
  assert.deepEqual(result.reverted, []);
  const post = await store.get('posts', 'campaign-stuck-post-1');
  assert.equal(post.status, 'published');
  assert.equal(post.meta?.git?.commit ?? undefined, undefined); // transitionPost stores meta separately from the post row itself
  const auditRows = await store.list('audit_log');
  const reconciledEntry = auditRows.find(r => r.action === 'post.reconciled_published');
  assert.ok(reconciledEntry, 'expected a post.reconciled_published audit entry');
  assert.equal(reconciledEntry.meta.commit, 'original-commit-sha', 'the original commit SHA must be preserved, not a new one');
});

test('reconcileStalePublishing: no verifiable artifact reverts to scheduled for a normal retry', async () => {
  const store = new MemoryStore();
  await store.replaceAll('posts', [makeStuckPost()]);

  const result = await reconcileStalePublishing(store, {
    now: new Date(),
    verifyArtifact: async () => ({ ok: false, error: 'artifact_missing_page' }),
  });

  assert.deepEqual(result.reconciled, []);
  assert.deepEqual(result.reverted, ['campaign-stuck-post-1']);
  const post = await store.get('posts', 'campaign-stuck-post-1');
  assert.equal(post.status, 'scheduled');
  const auditRows = await store.list('audit_log');
  assert.ok(auditRows.some(r => r.action === 'post.reconciled_reverted'));
});

test('reconcileStalePublishing: a post still fresh in publishing (under the stale timeout) is left untouched', async () => {
  const store = new MemoryStore();
  await store.upsert('posts', makeStuckPost({ updated_at: new Date().toISOString() })); // just now, not stale

  const result = await reconcileStalePublishing(store, {
    now: new Date(),
    verifyArtifact: async () => ({ ok: true, commit: 'x', repository: 'acme/site', branch: 'main', files: [] }),
  });

  assert.deepEqual(result, { checked: 0, reconciled: [], reverted: [] });
  const post = await store.get('posts', 'campaign-stuck-post-1');
  assert.equal(post.status, 'publishing', 'a fresh (non-stale) publishing post must never be touched — it may be mid-flight right now');
});

test('reconcileStalePublishing: a non-campaign post stuck in publishing is left untouched (scoped to campaign posts only)', async () => {
  const store = new MemoryStore();
  await store.upsert('posts', makeStuckPost({ id: 'admin-post-1' }));

  const result = await reconcileStalePublishing(store, {
    now: new Date(),
    verifyArtifact: async () => ({ ok: true, commit: 'x', repository: 'acme/site', branch: 'main', files: [] }),
  });

  assert.deepEqual(result, { checked: 0, reconciled: [], reverted: [] });
  const post = await store.get('posts', 'admin-post-1');
  assert.equal(post.status, 'publishing');
});

test('reconcileStalePublishing: a not-yet-due post (publish_at in the future) is never reconciled early, even if somehow marked publishing', async () => {
  const store = new MemoryStore();
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await store.upsert('posts', makeStuckPost({ publish_at: future }));

  const result = await reconcileStalePublishing(store, {
    now: new Date(),
    verifyArtifact: async () => ({ ok: true, commit: 'x', repository: 'acme/site', branch: 'main', files: [] }),
  });

  assert.deepEqual(result, { checked: 0, reconciled: [], reverted: [] });
});

test('reconcileStalePublishing: verifyArtifact throwing is treated as unverified and does not crash', async () => {
  const store = new MemoryStore();
  await store.replaceAll('posts', [makeStuckPost()]);

  const result = await reconcileStalePublishing(store, {
    now: new Date(),
    verifyArtifact: async () => { throw new Error('network_error'); },
  });

  assert.deepEqual(result.reverted, ['campaign-stuck-post-1']);
  const post = await store.get('posts', 'campaign-stuck-post-1');
  assert.equal(post.status, 'scheduled');
});

test('reconcileStalePublishing: a KV failure during reconciliation itself does not throw, and leaves the post for the next run', async () => {
  // makeFailureMock seeds `backing` with raw JSON directly (no upsert-style
  // stamping), so the fixture's backdated updated_at survives here.
  const kv = makeFailureMock({ initialTables: { posts: [makeStuckPost()] }, failFrom: 1 }); // every write fails
  const store = new KVStore(kv); // reconcileStalePublishing needs the Store interface, not the raw namespace binding
  const result = await reconcileStalePublishing(store, {
    now: new Date(),
    verifyArtifact: async () => ({ ok: true, commit: 'x', repository: 'acme/site', branch: 'main', files: [] }),
  });
  assert.equal(result.checked, 1);
  assert.deepEqual(result.reconciled, [], 'the write failed, so it cannot be counted as reconciled');
  const posts = JSON.parse(kv.backing.get('table:posts'));
  assert.equal(posts[0].status, 'publishing', 'left stuck for the next reconciliation attempt, not lost or corrupted');
});

test('reconcileStalePublishing: no verifyArtifact function provided treats every stale post as unverified (fails closed, never assumes success)', async () => {
  const store = new MemoryStore();
  await store.replaceAll('posts', [makeStuckPost()]);
  const result = await reconcileStalePublishing(store, { now: new Date() }); // no verifyArtifact
  assert.deepEqual(result.reverted, ['campaign-stuck-post-1']);
});

// --- End-to-end: the full critical scenario through the real endpoint ----

test('end-to-end CRITICAL: Git succeeds but transition+rollback both fail (run 1, stuck publishing) -> the next run reconciles to published WITHOUT a duplicate commit (run 2)', async () => {
  const fetchMock = installStatefulGitFetch();
  try {
    const post = {
      id: 'campaign-e2e-post-1',
      slug: 'e2e-post',
      title: 'E2E Post',
      body: 'Body.',
      status: 'scheduled',
      publish_at: '2020-01-01T00:00:00.000Z',
    };

    // Run 1: KV writes fail from position 4 onward (sustained, matching a
    // real quota exhaustion) — Git commit succeeds for real, but the
    // publishing->published transition AND its rollback both fail.
    const kv1 = makeFailureMock({ initialTables: { posts: [post] }, failFrom: 4 });
    const run1 = await onRequest({ request: makeRequest(), env: { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: kv1, ...GIT_ENV } });
    assert.equal(run1.status, 424);

    const postsAfterRun1 = JSON.parse(kv1.backing.get('table:posts'));
    assert.equal(postsAfterRun1.find(p => p.id === post.id).status, 'publishing', 'precondition: stuck in publishing after run 1');
    const commitCallsAfterRun1 = fetchMock.observed.filter(o => o.method === 'POST' && o.path.endsWith('/git/commits')).length;
    assert.equal(commitCallsAfterRun1, 1);

    // Run 2: KV is writable again (quota reset), and "now" is far enough
    // past run 1's write to make the stuck post look stale.
    const auditAfterRun1 = JSON.parse(kv1.backing.get('table:audit_log') || '[]');
    const kv2 = makeFailureMock({ initialTables: { posts: postsAfterRun1, audit_log: auditAfterRun1 } }); // no failures this time
    const future = new Date(Date.now() + DEFAULT_STALE_PUBLISHING_TIMEOUT_MS + 5 * 60_000).toISOString();
    const run2 = await onRequest({ request: makeRequest(future), env: { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: kv2, ...GIT_ENV } });

    assert.equal(run2.status, 200, `expected run 2 to succeed, got ${run2.status}: ${JSON.stringify(await run2.clone().json())}`);
    const body2 = await run2.json();
    assert.deepEqual(body2.reconciliation.reconciled, [post.id]);
    assert.deepEqual(body2.reconciliation.reverted, []);

    const postsAfterRun2 = JSON.parse(kv2.backing.get('table:posts'));
    assert.equal(postsAfterRun2.find(p => p.id === post.id).status, 'published', 'post must end up published — its real commit was verified');

    // The one assertion that matters most: still only ONE commit-creating
    // call across BOTH runs. Reconciliation is read-only against GitHub.
    const totalCommitCalls = fetchMock.observed.filter(o => o.method === 'POST' && o.path.endsWith('/git/commits')).length;
    assert.equal(totalCommitCalls, 1, 'reconciliation must never create a duplicate publication commit');

    // The sitemap must contain the URL exactly once (never duplicated).
    const sitemapXml = fetchMock.committedFiles.get('public/sitemap.xml');
    const locCount = (sitemapXml.match(/<loc>https:\/\/www\.rawsushibar\.com\/e2e-post\.html<\/loc>/g) || []).length;
    assert.equal(locCount, 1, 'the sitemap URL must never be duplicated by reconciliation');
  } finally {
    fetchMock.restore();
  }
});

test('end-to-end: a stale stuck post with NO verifiable Git artifact (commit never actually happened) is reverted to scheduled and retried cleanly, creating exactly one real commit', async () => {
  const fetchMock = installStatefulGitFetch();
  try {
    const stuckPost = makeStuckPost({ id: 'campaign-never-committed-1', slug: 'never-committed', publish_at: '2020-01-01T00:00:00.000Z' });
    // No prior commit was ever made for this post — committedFiles stays empty.
    const kv = makeFailureMock({ initialTables: { posts: [stuckPost] } });
    const future = new Date(Date.now() + DEFAULT_STALE_PUBLISHING_TIMEOUT_MS + 5 * 60_000).toISOString();

    const response = await onRequest({ request: makeRequest(future), env: { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: kv, ...GIT_ENV } });

    assert.equal(response.status, 200, `expected 200, got ${response.status}`);
    const body = await response.json();
    assert.deepEqual(body.reconciliation.reverted, [stuckPost.id]);
    // Reverted to scheduled by reconciliation, then immediately picked up by
    // the normal due-post scan in the SAME request (since it's now due and
    // scheduled) and published for real.
    assert.deepEqual(body.published, [stuckPost.id]);

    const posts = JSON.parse(kv.backing.get('table:posts'));
    assert.equal(posts.find(p => p.id === stuckPost.id).status, 'published');

    const commitCalls = fetchMock.observed.filter(o => o.method === 'POST' && o.path.endsWith('/git/commits')).length;
    assert.equal(commitCalls, 1, 'exactly one real commit should have been created');
  } finally {
    fetchMock.restore();
  }
});
