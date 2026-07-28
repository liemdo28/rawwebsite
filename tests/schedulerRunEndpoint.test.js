/**
 * tests/schedulerRunEndpoint.test.js — Regression test for the 2026-07-28
 * production incident: GitHub Actions run 30333439026 (and the controlled
 * diagnostic run 30334823506) got back HTTP 500 / Cloudflare error 1101 from
 * POST /api/scheduler/run, even though zero posts were due and there was
 * nothing to publish.
 *
 * Root cause (captured live via `wrangler pages deployment tail` during the
 * controlled diagnostic call): the Cloudflare KV namespace had hit its daily
 * write-quota limit. processScheduledPosts() completed successfully with a
 * final, correct result (processed:0, published:[], failed:[]) — but the
 * endpoint's own housekeeping audit-log write (record(store, {action:
 * 'scheduler.run', ...})) then threw "KV put() limit exceeded for the day."
 * uncaught, turning an already-successful run into a 500:
 *
 *   Error: KV put() limit exceeded for the day.
 *       at KVStore._writeTable (...)
 *       at KVStore.upsert (...)
 *       at async record (...)
 *       at async onRequest (functions/api/scheduler/run.js)
 *
 * This is NOT related to the soft-404/_validPaths.mjs work deployed just
 * before it — _middleware.js explicitly skips /api/* paths, and this run's
 * own logs confirm zero posts were due (article #2 doesn't publish until
 * 2026-07-29T18:30:00Z), so commitToGit() / addPathsToValidPathsManifest()
 * were never even reached.
 *
 * The fix (functions/api/scheduler/run.js) wraps the final scheduler.run
 * audit-log write in the same best-effort try/catch already used a few
 * lines above it for the gitPublish audit entry: a housekeeping log write
 * must never turn an already-final, correct scheduler result into a 500.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/scheduler/run.js';
import { createStore, KVStore } from '../lib/store.js';

const TOKEN = 'test-scheduler-token';

/** A KV namespace mock whose put() always throws, exactly like a Cloudflare
 * KV namespace that has exhausted its daily write quota. get() returns null
 * (empty tables), matching a normal "nothing scheduled yet" store. */
function makeQuotaExceededKv() {
  return {
    async get() { return null; },
    async put() { throw new Error('KV put() limit exceeded for the day.'); },
    async delete() { },
    async list() { return { keys: [] }; },
  };
}

/**
 * A realistic, call-counting KV namespace mock with a persistent in-memory
 * backing store (so seeded posts/audit rows round-trip correctly across
 * get/put, matching real KVStore behavior). Every get()/put() call is
 * recorded so tests can assert exact write counts (== quota consumption).
 *
 * `failPutForTables` selectively fails put() only for the given table names
 * (matching KVStore's `table:${name}` key convention) — this simulates a KV
 * namespace that is exhausted for audit-log writes specifically while the
 * real state-changing posts-table writes still succeed, which is exactly
 * the write pattern that matters for "does a quota-exhausted audit log ever
 * distort or hide the real, material outcome" (2026-07-28 incident).
 */
function makeCallCountingKv({ initialTables = {}, failPutForTables = [] } = {}) {
  const backing = new Map();
  for (const [table, rows] of Object.entries(initialTables)) {
    backing.set(`table:${table}`, JSON.stringify(rows));
  }
  const putCalls = [];
  const getCalls = [];
  return {
    backing,
    putCalls,
    getCalls,
    async get(key) {
      getCalls.push(key);
      return backing.has(key) ? backing.get(key) : null;
    },
    async put(key, value) {
      putCalls.push(key);
      const table = key.replace(/^table:/, '');
      if (failPutForTables.includes(table)) {
        throw new Error('KV put() limit exceeded for the day.');
      }
      backing.set(key, value);
    },
    async delete(key) { backing.delete(key); },
    async list() { return { keys: [...backing.keys()].map(name => ({ name })) }; },
  };
}

const DUE_POST = {
  id: 'test-due-post-1',
  slug: 'test-due-post',
  title: 'Test Due Post',
  body: 'Body content for the due post fixture.',
  excerpt: 'Excerpt.',
  status: 'scheduled',
  publish_at: '2020-01-01T00:00:00.000Z', // always in the past
  location: 'raw_stockton',
  primary_keyword: 'test keyword',
  secondary_keywords: [],
  image: '',
  date: '2020-01-01',
};

function makeRequest(body = {}) {
  return new Request('https://rawwebsitenew.pages.dev/api/scheduler/run', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'X-GitHub-Run-Id': '30334823506',
      'X-GitHub-Actor': 'liemdo28',
    },
    body: JSON.stringify(body),
  });
}

test('POST /api/scheduler/run: a KV write-quota failure on the housekeeping audit log does not crash an otherwise-successful run (no due posts)', async () => {
  const env = {
    RAWWEBSITE_SCHEDULER_TOKEN: TOKEN,
    RAWWEBSITE_KV: makeQuotaExceededKv(),
  };

  const response = await onRequest({ request: makeRequest(), env });

  assert.equal(response.status, 200, 'a KV audit-log write failure must not surface as a 500/1101');
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.processed, 0);
  assert.deepEqual(body.published, []);
  assert.deepEqual(body.failed, []);
});

test('POST /api/scheduler/run: rejects requests without a valid scheduler token', async () => {
  const env = {
    RAWWEBSITE_SCHEDULER_TOKEN: TOKEN,
    RAWWEBSITE_KV: makeQuotaExceededKv(),
  };
  const request = new Request('https://rawwebsitenew.pages.dev/api/scheduler/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

  const response = await onRequest({ request, env });
  assert.equal(response.status, 401);
});

test('POST /api/scheduler/run: rejects non-POST methods', async () => {
  const env = { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: makeQuotaExceededKv() };
  const request = new Request('https://rawwebsitenew.pages.dev/api/scheduler/run', { method: 'GET' });
  const response = await onRequest({ request, env });
  assert.equal(response.status, 405);
});

/**
 * 2026-07-28 KV-quota hardening pass — write-amplification tests.
 *
 * The 5-minute GitHub Actions cron means a pure no-op poll (nothing due)
 * happens ~288 times/day. Before this pass, every poll unconditionally
 * wrote a scheduler.run audit entry, burning ~29% of Cloudflare KV's
 * free-tier 1,000-write/day budget on runs where nothing happened at all —
 * the proximate cause of the original 1101 incident. These tests prove the
 * fix (skip the scheduler.run audit write when processed:0) actually
 * results in zero KV put() calls for a no-op poll, that meaningful events
 * still get audited, and that a quota-exhausted audit log can never distort
 * or hide the real, material outcome of an actual due-post publish attempt.
 */

test('quota: a no-due scheduler request makes zero KV write calls', async () => {
  const kv = makeCallCountingKv();
  const env = { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: kv };

  const response = await onRequest({ request: makeRequest(), env });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.processed, 0);
  assert.deepEqual(kv.putCalls, [], 'a pure no-op poll must not perform any KV put() calls');
});

test('quota: repeating the no-due request does not mutate posts or audit_log', async () => {
  const kv = makeCallCountingKv();
  const env = { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: kv };

  await onRequest({ request: makeRequest(), env });
  await onRequest({ request: makeRequest(), env });

  assert.deepEqual(kv.putCalls, [], 'repeated no-op polling must never accumulate KV writes');
  assert.equal(kv.backing.size, 0, 'no table should have been created by no-op polling');
});

test('quota: one successful due publication makes only the required state/audit writes', async () => {
  const kv = makeCallCountingKv({ initialTables: { posts: [DUE_POST] } });
  const env = {
    RAWWEBSITE_SCHEDULER_TOKEN: TOKEN,
    RAWWEBSITE_KV: kv,
    // Test-only gitPublish injection (same convention as tests/scheduler.test.js) —
    // bypasses the GITHUB_TOKEN-based wrapper in run.js, so no extra
    // git.commit audit write is attempted; this test counts exactly the
    // writes processScheduledPosts + transitionPost + the final scheduler.run
    // audit entry perform for one due, successfully-publishing post.
    _gitPublish: async (post) => ({
      ok: true,
      commit: 'test-commit-sha',
      repository: 'acme/site',
      branch: 'main',
      files: [`public/${post.slug}.html`, 'public/sitemap.xml', 'functions/_validPaths.mjs'],
    }),
  };

  const response = await onRequest({ request: makeRequest(), env });

  assert.equal(response.status, 200, `expected 200, got ${response.status}`);
  const body = await response.json();
  assert.equal(body.processed, 1);
  assert.deepEqual(body.published, [DUE_POST.id]);
  assert.deepEqual(body.failed, []);
  // publishing->published transition (2 posts + 2 audit) + post.auto_publish
  // audit (1) + the final scheduler.run audit (1, since processed > 0) = 6.
  assert.equal(kv.putCalls.length, 6, `expected exactly 6 KV put() calls, got ${kv.putCalls.length}: ${kv.putCalls.join(', ')}`);
});

test('quota: audit failure does not mask a publication failure', async () => {
  const kv = makeCallCountingKv({
    initialTables: { posts: [DUE_POST] },
    failPutForTables: ['audit_log'], // posts-table writes succeed; every audit write fails
  });
  const env = {
    RAWWEBSITE_SCHEDULER_TOKEN: TOKEN,
    RAWWEBSITE_KV: kv,
    _gitPublish: async () => ({ ok: false, error: 'git_publish_failed' }), // a REAL publish failure, unrelated to audit
  };

  const response = await onRequest({ request: makeRequest(), env });

  assert.equal(response.status, 424, 'a real git-publish failure must still surface as a structured failure, not a false 200');
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.processed, 1);
  assert.deepEqual(body.published, []);
  assert.equal(body.failed.length, 1);
  assert.equal(body.failed[0].id, DUE_POST.id);
});

test('quota: audit failure does not create error 1101 after an otherwise valid no-op request', async () => {
  const env = { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: makeQuotaExceededKv() };

  // Should not throw at all — a thrown exception here would fail the test
  // the same way an uncaught exception produced Cloudflare error 1101.
  const response = await onRequest({ request: makeRequest(), env });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.processed, 0);
});

test('quota: article statuses remain correct under simulated KV quota exhaustion (audit_log writes fail, posts writes succeed)', async () => {
  const kv = makeCallCountingKv({
    initialTables: { posts: [DUE_POST] },
    failPutForTables: ['audit_log'],
  });
  const env = {
    RAWWEBSITE_SCHEDULER_TOKEN: TOKEN,
    RAWWEBSITE_KV: kv,
    _gitPublish: async (post) => ({
      ok: true,
      commit: 'test-commit-sha',
      repository: 'acme/site',
      branch: 'main',
      files: [`public/${post.slug}.html`, 'public/sitemap.xml', 'functions/_validPaths.mjs'],
    }),
  };

  const response = await onRequest({ request: makeRequest(), env });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.published, [DUE_POST.id]);

  // The posts table (the real source of truth) must reflect the actual,
  // correct outcome regardless of every audit_log write having failed
  // throughout the entire run.
  const storedPosts = JSON.parse(kv.backing.get('table:posts'));
  const storedPost = storedPosts.find(p => p.id === DUE_POST.id);
  assert.ok(storedPost, 'the due post must still be present in the posts table');
  assert.equal(storedPost.status, 'published');
});

test('quota: createStore never falls back to FileStore/node:fs when a KV binding is present, matching run.js\'s exact call shape', () => {
  // run.js always calls createStore(env, { dataDir: config.dataDir }), and
  // loadConfig() always defaults dataDir to './data' — so a KV binding must
  // still win even though dataDir is also always set.
  const env = { RAWWEBSITE_KV: makeCallCountingKv() };
  const store = createStore(env, { dataDir: './data' });
  assert.ok(store instanceof KVStore, 'expected KVStore to be selected, not FileStore/MemoryStore');
});
