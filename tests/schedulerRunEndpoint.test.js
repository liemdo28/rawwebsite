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
