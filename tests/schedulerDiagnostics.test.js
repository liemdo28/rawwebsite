/**
 * tests/schedulerDiagnostics.test.js — Diagnostics endpoint checks.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequest } from '../functions/api/scheduler/diagnostics.js';

const ENV = {
  RAWWEBSITE_SCHEDULER_TOKEN: 'scheduler-secret',
  GITHUB_TOKEN: 'ghp_test_123',
  GITHUB_OWNER: 'acme',
  GITHUB_REPO: 'website',
  GITHUB_BRANCH: 'main',
};

function request() {
  return new Request('https://example.com/api/scheduler/diagnostics', {
    headers: { Authorization: 'Bearer scheduler-secret' },
  });
}

test('scheduler diagnostics: returns 200 only when Git config verifies', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ object: { sha: 'abc123' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  try {
    const response = await onRequest({ request: request(), env: ENV });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.repository, 'acme/website');
    assert.equal(body.branch, 'main');
    assert.equal(body.sha, 'abc123');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scheduler diagnostics: fails closed when Git config does not verify', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Bad request' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });

  try {
    const response = await onRequest({ request: request(), env: ENV });
    const body = await response.json();
    assert.equal(response.status, 424);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'git_config_invalid');
    assert.equal(body.repository, 'acme/website');
    assert.equal(body.branch, 'main');
    assert.match(body.git_error, /github_api_error:400/);
    assert.match(body.message, /failed verification/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
