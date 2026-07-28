/**
 * tests/schedulerFailureMatrix.test.js — Per-write-position KV failure
 * matrix for one due-post publication (2026-07-28 KV-quota hardening
 * follow-up audit).
 *
 * The real production write sequence for one successful due-post publish
 * (functions/api/scheduler/run.js, GITHUB_TOKEN branch) is exactly 7 KV
 * put() calls, in this order:
 *
 *   1. posts: scheduled -> publishing        (lib/posts.js transitionPost, UNPROTECTED — real state)
 *   2. post.transition audit (publishing)    (lib/posts.js transitionPost, best-effort)
 *   3. git.commit audit                      (run.js gitPublish wrapper, best-effort)
 *   4. posts: publishing -> published        (lib/posts.js transitionPost, UNPROTECTED — real state)
 *   5. post.transition audit (published)     (lib/posts.js transitionPost, best-effort)
 *   6. post.auto_publish audit               (lib/scheduler.js, best-effort)
 *   7. scheduler.run audit                   (run.js, best-effort, only when processed > 0)
 *
 * Positions 1 and 4 are the two UNPROTECTED writes — they ARE the real state
 * change and must propagate on failure. Positions 2,3,5,6,7 are all
 * best-effort audit writes (hardened by the two preceding commits in this
 * incident, 5f9631f and 25f6b4f) and must never distort the real outcome.
 *
 * Each test below fails exactly one write in isolation (all others succeed)
 * and records: real Git commit made?, final post status, API response,
 * automatic retry?, manual reconciliation needed?, and which of the risk
 * categories the user asked about (false published, duplicate commit, stuck
 * publishing, missing audit evidence, 500/1101) actually occurred.
 *
 * A SEPARATE, more realistic scenario — sustained failure from position 4
 * onward (matching how a real daily quota exhaustion behaves: once hit,
 * EVERY subsequent write fails, not just one) — is tested at the bottom.
 * That is the genuinely critical "Git succeeded, KV transition failed, AND
 * rollback also failed" case; it is what lib/scheduler.js's
 * reconcileStalePublishing() (see tests/reconcileStalePublishing.test.js)
 * exists to recover from.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/scheduler/run.js';

const TOKEN = 'test-scheduler-token';
const GIT_ENV = { GITHUB_TOKEN: 'ghp_test', GITHUB_OWNER: 'acme', GITHUB_REPO: 'site', GITHUB_BRANCH: 'main' };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function installGitFetch() {
  const observed = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    observed.push({ method, path: u.pathname });
    if (method === 'GET' && u.pathname.endsWith('/git/ref/heads/main')) return jsonResponse({ object: { sha: 'base-commit' } });
    if (method === 'GET' && u.pathname.endsWith('/git/commits/base-commit')) return jsonResponse({ sha: 'base-commit', tree: { sha: 'base-tree' } });
    if (method === 'GET' && u.pathname.includes('/contents/')) return jsonResponse({ message: 'Not Found' }, 404);
    if (method === 'POST' && u.pathname.endsWith('/git/trees')) return jsonResponse({ sha: 'new-tree' });
    if (method === 'POST' && u.pathname.endsWith('/git/commits')) return jsonResponse({ sha: 'real-commit-sha' });
    if (method === 'PATCH' && u.pathname.endsWith('/git/refs/heads/main')) return jsonResponse({ ref: 'refs/heads/main' });
    return jsonResponse({ message: 'Not Found' }, 404);
  };
  return { observed, restore() { globalThis.fetch = origFetch; } };
}

/**
 * `failAt`: fail exactly this Nth put() call (1-indexed), all others succeed.
 * `failFrom`: fail this Nth put() call AND every one after it — the
 * realistic shape of a real daily quota exhaustion, where nothing
 * discriminates between individual write attempts once the limit is hit.
 */
function makeFailureMock({ initialTables = {}, failAt = null, failFrom = null } = {}) {
  const backing = new Map();
  for (const [table, rows] of Object.entries(initialTables)) {
    backing.set(`table:${table}`, JSON.stringify(rows));
  }
  const putCalls = [];
  let writeCount = 0;
  return {
    backing,
    putCalls,
    async get(key) { return backing.has(key) ? backing.get(key) : null; },
    async put(key, value) {
      writeCount += 1;
      putCalls.push({ index: writeCount, key });
      const shouldFail = (failAt != null && writeCount === failAt) || (failFrom != null && writeCount >= failFrom);
      if (shouldFail) throw new Error('KV put() limit exceeded for the day.');
      backing.set(key, value);
    },
    async delete(key) { backing.delete(key); },
    async list() { return { keys: [...backing.keys()].map(name => ({ name })) }; },
  };
}

function makeDuePost(id = 'campaign-test-due-post-1') {
  return {
    id,
    slug: 'test-due-post',
    title: 'Test Due Post',
    body: 'Body content for the due post fixture.',
    excerpt: 'Excerpt.',
    status: 'scheduled',
    publish_at: '2020-01-01T00:00:00.000Z',
    location: 'raw_stockton',
    primary_keyword: 'test keyword',
    secondary_keywords: [],
    image: '',
    date: '2020-01-01',
  };
}

function makeRequest() {
  return new Request('https://rawwebsitenew.pages.dev/api/scheduler/run', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
}

function storedStatus(kv, id) {
  const posts = JSON.parse(kv.backing.get('table:posts') || '[]');
  return posts.find(p => p.id === id)?.status;
}

function commitWasMade(fetchMock) {
  return fetchMock.observed.some(o => o.method === 'POST' && o.path.endsWith('/git/commits'));
}

// ---------------------------------------------------------------------------
// Position 1: posts: scheduled -> publishing (UNPROTECTED, the first write)
// ---------------------------------------------------------------------------
test('failure matrix, position 1 (scheduled->publishing write): fails before any Git call — safe, automatic retry, no commit', async () => {
  const fetchMock = installGitFetch();
  try {
    const post = makeDuePost();
    const kv = makeFailureMock({ initialTables: { posts: [post] }, failAt: 1 });
    const env = { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: kv, ...GIT_ENV };

    const response = await onRequest({ request: makeRequest(), env });

    assert.equal(response.status, 424);
    const body = await response.json();
    assert.equal(body.failed.length, 1);
    assert.equal(commitWasMade(fetchMock), false, 'no Git commit should ever be attempted — the publishing transition never succeeded');
    assert.equal(storedStatus(kv, post.id), 'scheduled', 'post must remain scheduled — safe to retry automatically next poll');
  } finally {
    fetchMock.restore();
  }
});

// ---------------------------------------------------------------------------
// Position 2: post.transition audit (publishing) — best-effort
// ---------------------------------------------------------------------------
test('failure matrix, position 2 (publishing-transition audit): best-effort — publish proceeds normally, only that one audit entry is lost', async () => {
  const fetchMock = installGitFetch();
  try {
    const post = makeDuePost();
    const kv = makeFailureMock({ initialTables: { posts: [post] }, failAt: 2 });
    const env = { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: kv, ...GIT_ENV };

    const response = await onRequest({ request: makeRequest(), env });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.published, [post.id]);
    assert.equal(commitWasMade(fetchMock), true);
    assert.equal(storedStatus(kv, post.id), 'published');
    const actions = JSON.parse(kv.backing.get('table:audit_log')).map(r => r.action);
    assert.deepEqual(actions, ['git.commit', 'post.transition', 'post.auto_publish', 'scheduler.run'], 'the publishing-transition audit entry is the only one missing');
  } finally {
    fetchMock.restore();
  }
});

// ---------------------------------------------------------------------------
// Position 3: git.commit audit — best-effort
// ---------------------------------------------------------------------------
test('failure matrix, position 3 (git.commit audit): best-effort — publish proceeds normally, only the commit SHA audit trail entry is lost', async () => {
  const fetchMock = installGitFetch();
  try {
    const post = makeDuePost();
    const kv = makeFailureMock({ initialTables: { posts: [post] }, failAt: 3 });
    const env = { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: kv, ...GIT_ENV };

    const response = await onRequest({ request: makeRequest(), env });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.published, [post.id]);
    assert.equal(commitWasMade(fetchMock), true);
    assert.equal(storedStatus(kv, post.id), 'published');
    const actions = JSON.parse(kv.backing.get('table:audit_log')).map(r => r.action);
    assert.deepEqual(actions, ['post.transition', 'post.transition', 'post.auto_publish', 'scheduler.run'], 'the git.commit audit entry is the only one missing');
  } finally {
    fetchMock.restore();
  }
});

// ---------------------------------------------------------------------------
// Position 4: posts: publishing -> published (UNPROTECTED, the critical write)
// ---------------------------------------------------------------------------
test('failure matrix, position 4 (publishing->published write, single-shot): rollback succeeds, post reverts to scheduled for retry — a real commit already exists though', async () => {
  const fetchMock = installGitFetch();
  try {
    const post = makeDuePost();
    const kv = makeFailureMock({ initialTables: { posts: [post] }, failAt: 4 });
    const env = { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: kv, ...GIT_ENV };

    const response = await onRequest({ request: makeRequest(), env });

    assert.equal(response.status, 424);
    const body = await response.json();
    assert.equal(body.failed.length, 1);
    assert.equal(commitWasMade(fetchMock), true, 'the Git commit already happened before this write failed');
    assert.equal(storedStatus(kv, post.id), 'scheduled', 'rollback succeeded here (only position 4 failed) — safe to retry, though note: a retry will call commitToGit again');
    // Not asserted further here (out of this test's scope, documented in
    // the final report): commitToGit's own idempotency check compares
    // rendered file content, and per-post `updated_at` can differ between
    // attempts, so a retry here is not guaranteed to be a true Git no-op —
    // this is pre-existing commitToGit behavior, unrelated to this pass.
  } finally {
    fetchMock.restore();
  }
});

// ---------------------------------------------------------------------------
// Position 5: post.transition audit (published) — best-effort
// ---------------------------------------------------------------------------
test('failure matrix, position 5 (published-transition audit): best-effort — publish proceeds normally, only that one audit entry is lost', async () => {
  const fetchMock = installGitFetch();
  try {
    const post = makeDuePost();
    const kv = makeFailureMock({ initialTables: { posts: [post] }, failAt: 5 });
    const env = { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: kv, ...GIT_ENV };

    const response = await onRequest({ request: makeRequest(), env });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.published, [post.id]);
    assert.equal(commitWasMade(fetchMock), true);
    assert.equal(storedStatus(kv, post.id), 'published');
    const actions = JSON.parse(kv.backing.get('table:audit_log')).map(r => r.action);
    assert.deepEqual(actions, ['post.transition', 'git.commit', 'post.auto_publish', 'scheduler.run']);
  } finally {
    fetchMock.restore();
  }
});

// ---------------------------------------------------------------------------
// Position 6: post.auto_publish audit — best-effort
// ---------------------------------------------------------------------------
test('failure matrix, position 6 (post.auto_publish audit): best-effort — publish proceeds normally, only that one audit entry is lost', async () => {
  const fetchMock = installGitFetch();
  try {
    const post = makeDuePost();
    const kv = makeFailureMock({ initialTables: { posts: [post] }, failAt: 6 });
    const env = { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: kv, ...GIT_ENV };

    const response = await onRequest({ request: makeRequest(), env });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.published, [post.id]);
    assert.equal(commitWasMade(fetchMock), true);
    assert.equal(storedStatus(kv, post.id), 'published');
    const actions = JSON.parse(kv.backing.get('table:audit_log')).map(r => r.action);
    assert.deepEqual(actions, ['post.transition', 'git.commit', 'post.transition', 'scheduler.run']);
  } finally {
    fetchMock.restore();
  }
});

// ---------------------------------------------------------------------------
// Position 7: scheduler.run audit — best-effort
// ---------------------------------------------------------------------------
test('failure matrix, position 7 (scheduler.run audit): best-effort — publish proceeds normally, only the run-summary audit entry is lost', async () => {
  const fetchMock = installGitFetch();
  try {
    const post = makeDuePost();
    const kv = makeFailureMock({ initialTables: { posts: [post] }, failAt: 7 });
    const env = { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: kv, ...GIT_ENV };

    const response = await onRequest({ request: makeRequest(), env });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.published, [post.id]);
    assert.equal(commitWasMade(fetchMock), true);
    assert.equal(storedStatus(kv, post.id), 'published');
    const actions = JSON.parse(kv.backing.get('table:audit_log')).map(r => r.action);
    assert.deepEqual(actions, ['post.transition', 'git.commit', 'post.transition', 'post.auto_publish']);
  } finally {
    fetchMock.restore();
  }
});

// ---------------------------------------------------------------------------
// The CRITICAL scenario: sustained failure from position 4 onward — matches
// how a real daily KV quota exhaustion actually behaves (every write fails
// from the moment the limit is hit, not just one specific write). This is
// exactly "Git commit succeeds, final KV transition fails, AND the rollback
// write also fails because quota remains exhausted."
// ---------------------------------------------------------------------------
test('failure matrix, CRITICAL: sustained failure from position 4 (Git succeeds, transition AND rollback both fail) leaves the post stuck in publishing — not falsely published, not a crash, not a duplicate commit yet', async () => {
  const fetchMock = installGitFetch();
  try {
    const post = makeDuePost();
    const kv = makeFailureMock({ initialTables: { posts: [post] }, failFrom: 4 });
    const env = { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: kv, ...GIT_ENV };

    const response = await onRequest({ request: makeRequest(), env });

    // The request itself must not crash (no 500/1101) even though every
    // write from position 4 onward — including both rollback attempts and
    // every audit write — failed.
    assert.equal(response.status, 424, 'must fail closed with a structured response, not crash');
    const body = await response.json();
    assert.equal(body.failed.length, 1);

    assert.equal(commitWasMade(fetchMock), true, 'the real Git commit already happened before any of this failed');
    assert.equal(storedStatus(kv, post.id), 'publishing', 'stuck in publishing — this is the state reconcileStalePublishing() exists to recover');
  } finally {
    fetchMock.restore();
  }
});
