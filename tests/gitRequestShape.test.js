/**
 * tests/gitRequestShape.test.js — Request-construction correctness for the
 * GitHub REST calls in lib/gitPublish.js.
 *
 * These tests exist because a production 400 (GET /repos/{owner}/{repo}/
 * git/ref/heads/{branch}, empty response body) surfaced with correct-looking
 * GITHUB_OWNER/GITHUB_REPO. Rather than assume the token is invalid, this
 * file proves — or disproves — that the request itself is well-formed:
 * exact URL, no body on GET, safe headers, no CR/LF injection, and that
 * untrimmed/empty credentials never reach fetch() at all.
 *
 * No real network calls; the token value is never asserted or logged.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyGitConfig,
  normalizeGitEnv,
  hasInvalidHeaderChars,
  githubHeaders,
} from '../lib/gitPublish.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('githubHeaders: exact header set for a bodyless GET', () => {
  const headers = githubHeaders('tok_abc123', { hasBody: false });
  assert.deepEqual(Object.keys(headers).sort(), [
    'Accept',
    'Authorization',
    'User-Agent',
    'X-GitHub-Api-Version',
  ].sort());
  assert.equal(headers.Authorization, 'Bearer tok_abc123');
  assert.equal(headers.Accept, 'application/vnd.github+json');
  assert.equal(headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.equal(headers['User-Agent'], 'rawwebsite-scheduler');
  assert.equal('Content-Type' in headers, false, 'no Content-Type on a bodyless request');
});

test('githubHeaders: adds Content-Type only when the request has a body', () => {
  const headers = githubHeaders('tok_abc123', { hasBody: true });
  assert.equal(headers['Content-Type'], 'application/json');
});

test('githubHeaders: Authorization scheme is exactly "Bearer <token>", nothing else appended', () => {
  const headers = githubHeaders('tok_abc123');
  assert.match(headers.Authorization, /^Bearer tok_abc123$/);
});

test('githubHeaders: no header value contains CR or LF', () => {
  const headers = githubHeaders('tok_abc123', { hasBody: true });
  for (const [name, value] of Object.entries(headers)) {
    assert.doesNotMatch(String(value), /[\r\n]/, `header ${name} must not contain CR/LF`);
  }
});

test('normalizeGitEnv: trims leading/trailing whitespace and newlines from every field', () => {
  const result = normalizeGitEnv({
    GITHUB_TOKEN: '  tok_abc123\n',
    GITHUB_OWNER: '\tliemdo28 ',
    GITHUB_REPO: ' rawwebsite\r\n',
    GITHUB_BRANCH: '  main  ',
  });
  assert.equal(result.token, 'tok_abc123');
  assert.equal(result.owner, 'liemdo28');
  assert.equal(result.repo, 'rawwebsite');
  assert.equal(result.branch, 'main');
});

test('normalizeGitEnv: defaults branch to "main" when unset, missing, or whitespace-only', () => {
  assert.equal(normalizeGitEnv({}).branch, 'main');
  assert.equal(normalizeGitEnv({ GITHUB_BRANCH: '' }).branch, 'main');
  assert.equal(normalizeGitEnv({ GITHUB_BRANCH: '   ' }).branch, 'main');
});

test('normalizeGitEnv: null/undefined fields normalize to empty strings, not "null"/"undefined"', () => {
  const result = normalizeGitEnv({ GITHUB_TOKEN: undefined, GITHUB_OWNER: null, GITHUB_REPO: undefined });
  assert.equal(result.token, '');
  assert.equal(result.owner, '');
  assert.equal(result.repo, '');
});

test('hasInvalidHeaderChars: detects an embedded newline or carriage return after trimming would not remove it', () => {
  assert.equal(hasInvalidHeaderChars('tok_abc\n123'), true);
  assert.equal(hasInvalidHeaderChars('tok_abc\r123'), true);
  assert.equal(hasInvalidHeaderChars('tok_abc123'), false);
});

test('verifyGitConfig: constructs the exact expected URL, method, and header set for a real repo/branch', async () => {
  const origFetch = globalThis.fetch;
  let observedUrl, observedMethod, observedHeaders, observedBody;
  globalThis.fetch = async (url, init) => {
    observedUrl = url;
    observedMethod = init.method;
    observedHeaders = init.headers;
    observedBody = init.body;
    return jsonResponse({ object: { sha: 'deadbeef' } });
  };
  try {
    const r = await verifyGitConfig({
      GITHUB_TOKEN: 'tok_abc123',
      GITHUB_OWNER: 'liemdo28',
      GITHUB_REPO: 'rawwebsite',
      GITHUB_BRANCH: 'main',
    });
    assert.equal(r.ok, true);
    assert.equal(observedUrl, 'https://api.github.com/repos/liemdo28/rawwebsite/git/ref/heads/main');
    assert.equal(new URL(observedUrl).origin, 'https://api.github.com');
    assert.equal(new URL(observedUrl).pathname, '/repos/liemdo28/rawwebsite/git/ref/heads/main');
    assert.equal(observedMethod, 'GET');
    assert.equal(observedBody, undefined, 'GET must not have a body');
    assert.equal(observedHeaders.Authorization, 'Bearer tok_abc123');
    assert.equal(observedHeaders.Accept, 'application/vnd.github+json');
    assert.equal(observedHeaders['X-GitHub-Api-Version'], '2022-11-28');
    assert.equal(observedHeaders['User-Agent'], 'rawwebsite-scheduler');
    assert.equal('Content-Type' in observedHeaders, false);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('verifyGitConfig: trims whitespace/newlines from configured values before building the request', async () => {
  const origFetch = globalThis.fetch;
  let observedUrl, observedHeaders;
  globalThis.fetch = async (url, init) => {
    observedUrl = url;
    observedHeaders = init.headers;
    return jsonResponse({ object: { sha: 'deadbeef' } });
  };
  try {
    const r = await verifyGitConfig({
      GITHUB_TOKEN: '  tok_abc123\n',
      GITHUB_OWNER: ' liemdo28 ',
      GITHUB_REPO: '\trawwebsite\r\n',
      GITHUB_BRANCH: ' main ',
    });
    assert.equal(r.ok, true);
    assert.equal(r.repository, 'liemdo28/rawwebsite', 'repository must not carry stray whitespace');
    assert.equal(r.branch, 'main');
    assert.equal(observedUrl, 'https://api.github.com/repos/liemdo28/rawwebsite/git/ref/heads/main');
    assert.equal(observedHeaders.Authorization, 'Bearer tok_abc123', 'token must be trimmed before use');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('verifyGitConfig: rejects whitespace-only token/owner/repo as missing, before any fetch', async () => {
  const origFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return jsonResponse({}); };
  try {
    const r = await verifyGitConfig({ GITHUB_TOKEN: '   ', GITHUB_OWNER: 'liemdo28', GITHUB_REPO: 'rawwebsite' });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'missing_github_credentials');
    assert.equal(called, false, 'no network call should happen for a whitespace-only token');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('verifyGitConfig: rejects an owner/repo/token containing an embedded CR or LF before any fetch', async () => {
  const origFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return jsonResponse({}); };
  try {
    const r = await verifyGitConfig({
      GITHUB_TOKEN: 'tok_abc\n123',
      GITHUB_OWNER: 'liemdo28',
      GITHUB_REPO: 'rawwebsite',
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'invalid_github_credentials_format');
    assert.equal(called, false, 'a malformed credential must never reach fetch()');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('verifyGitConfig: never returns or logs the token, even on success', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ object: { sha: 'deadbeef' } });
  try {
    const r = await verifyGitConfig({
      GITHUB_TOKEN: 'tok_super_secret_value',
      GITHUB_OWNER: 'liemdo28',
      GITHUB_REPO: 'rawwebsite',
    });
    const serialized = JSON.stringify(r);
    assert.doesNotMatch(serialized, /tok_super_secret_value/);
    assert.doesNotMatch(serialized, /Bearer/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('verifyGitConfig: owner/repo/branch containing URL-unsafe characters are percent-encoded in the request path', async () => {
  const origFetch = globalThis.fetch;
  let observedUrl;
  globalThis.fetch = async (url) => {
    observedUrl = url;
    return jsonResponse({ object: { sha: 'x' } });
  };
  try {
    await verifyGitConfig({
      GITHUB_TOKEN: 'tok_abc123',
      GITHUB_OWNER: 'liemdo28',
      GITHUB_REPO: 'rawwebsite',
      GITHUB_BRANCH: 'feature/x y',
    });
    assert.equal(observedUrl, 'https://api.github.com/repos/liemdo28/rawwebsite/git/ref/heads/feature%2Fx%20y');
  } finally {
    globalThis.fetch = origFetch;
  }
});
