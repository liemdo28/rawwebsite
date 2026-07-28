/**
 * tests/reconcileBeforePublishBranches.test.js — Integration tests for the
 * reconcile-before-publish check in processScheduledPosts() (2026-07-28
 * follow-up audit, Part 5 branches C-F). Each test seeds a stateful GitHub
 * mock with a specific pre-existing artifact state, then runs the real
 * scheduler endpoint against a due campaign post and checks that verifyGitArtifact's
 * mismatchReason correctly routes to either the reconcile-shortcut or the
 * normal controlled publication path — never silently overwriting, never
 * inventing a commit SHA, and never leaving a duplicate sitemap entry.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/scheduler/run.js';
import { renderArticlePage } from '../lib/renderArticlePage.js';

const TOKEN = 'test-scheduler-token';
const GIT_ENV = { GITHUB_TOKEN: 'ghp_test', GITHUB_OWNER: 'acme', GITHUB_REPO: 'site', GITHUB_BRANCH: 'main' };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Stateful GitHub mock, pre-seedable with existing repo content, tracking
 * every commit-creating call and every file ever written via /git/trees. */
function installGitFetch(preExisting = {}) {
  const observed = [];
  const committedFiles = new Map(Object.entries(preExisting));
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
      if (committedFiles.has(path)) return jsonResponse({ sha: 'file-sha-' + path, content: Buffer.from(committedFiles.get(path)).toString('base64') });
      return jsonResponse({ message: 'Not Found' }, 404);
    }
    if (method === 'POST' && u.pathname.endsWith('/git/trees')) {
      for (const item of body.tree) committedFiles.set(item.path, item.content);
      return jsonResponse({ sha: 'new-tree' });
    }
    if (method === 'POST' && u.pathname.endsWith('/git/commits')) return jsonResponse({ sha: 'repair-commit-sha' });
    if (method === 'PATCH' && u.pathname.endsWith('/git/refs/heads/main')) return jsonResponse({ ref: 'refs/heads/main' });
    return jsonResponse({ message: 'Not Found' }, 404);
  };
  return { observed, committedFiles, restore() { globalThis.fetch = origFetch; } };
}

function makeCallCountingKv(initialTables = {}) {
  const backing = new Map();
  for (const [table, rows] of Object.entries(initialTables)) backing.set(`table:${table}`, JSON.stringify(rows));
  const putCalls = [];
  return {
    backing,
    putCalls,
    async get(key) { return backing.has(key) ? backing.get(key) : null; },
    async put(key, value) { putCalls.push(key); backing.set(key, value); },
    async delete(key) { backing.delete(key); },
    async list() { return { keys: [...backing.keys()].map(name => ({ name })) }; },
  };
}

function makeDuePost(overrides = {}) {
  return {
    id: 'campaign-branch-post-1',
    slug: 'branch-post',
    title: 'Branch Post',
    body: 'Body.',
    status: 'scheduled',
    publish_at: '2020-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRequest() {
  return new Request('https://x/api/scheduler/run', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
}

function commitCreatingCalls(fetchMock) {
  return fetchMock.observed.filter(o => o.method === 'POST' && o.path.endsWith('/git/commits'));
}

test('branch C: artifact exists but content is stale/mismatched — not reconciled; republished through the normal controlled path', async () => {
  const post = makeDuePost();
  const stalePage = renderArticlePage(post).replace('Body.', 'An OLD, since-edited body.');
  const fetchMock = installGitFetch({ 'public/branch-post.html': stalePage });
  try {
    const kv = makeCallCountingKv({ posts: [post] });
    const response = await onRequest({ request: makeRequest(), env: { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: kv, ...GIT_ENV } });

    assert.equal(response.status, 200, `expected 200, got ${response.status}: ${JSON.stringify(await response.clone().json())}`);
    const body = await response.json();
    assert.deepEqual(body.published, [post.id]);
    assert.deepEqual(body.reconciled, [], 'must NOT be reported as reconciled — the existing artifact did not match');

    // Republished through the normal controlled path: exactly one new commit.
    assert.equal(commitCreatingCalls(fetchMock).length, 1);
    const finalPage = fetchMock.committedFiles.get('public/branch-post.html');
    assert.equal(finalPage, renderArticlePage(post), 'the stale content must be corrected, not silently left as-is');
  } finally {
    fetchMock.restore();
  }
});

test('branch D: page exists and matches, but sitemap entry is missing — idempotent repair adds only the sitemap entry, exactly once, page content unchanged', async () => {
  const post = makeDuePost();
  const correctPage = renderArticlePage(post);
  const fetchMock = installGitFetch({
    'public/branch-post.html': correctPage,
    'public/sitemap.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n', // no entry for this post
  });
  try {
    const kv = makeCallCountingKv({ posts: [post] });
    const response = await onRequest({ request: makeRequest(), env: { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: kv, ...GIT_ENV } });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.published, [post.id]);
    assert.deepEqual(body.reconciled, [], 'a missing sitemap entry means the artifact was not fully verified — goes through the normal repair path, not the reconcile shortcut');

    const finalPage = fetchMock.committedFiles.get('public/branch-post.html');
    assert.equal(finalPage, correctPage, 'the already-correct page content must be left byte-identical, not rewritten');

    const finalSitemap = fetchMock.committedFiles.get('public/sitemap.xml');
    const locCount = (finalSitemap.match(/<loc>https:\/\/www\.rawsushibar\.com\/branch-post\.html<\/loc>/g) || []).length;
    assert.equal(locCount, 1, 'exactly one sitemap entry must exist after repair');
  } finally {
    fetchMock.restore();
  }
});

test('branch E: sitemap entry exists but the page is missing — not considered published, repaired safely', async () => {
  const post = makeDuePost();
  const fetchMock = installGitFetch({
    // No public/branch-post.html at all.
    'public/sitemap.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://www.rawsushibar.com/branch-post.html</loc><lastmod>2020-01-01</lastmod></url>\n</urlset>\n',
  });
  try {
    const kv = makeCallCountingKv({ posts: [post] });
    const response = await onRequest({ request: makeRequest(), env: { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: kv, ...GIT_ENV } });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.published, [post.id]);
    assert.deepEqual(body.reconciled, [], 'a missing page means the artifact was never actually verified as published');

    const finalPage = fetchMock.committedFiles.get('public/branch-post.html');
    assert.equal(finalPage, renderArticlePage(post), 'the missing page must be created with the correct deterministic content');

    const finalSitemap = fetchMock.committedFiles.get('public/sitemap.xml');
    const locCount = (finalSitemap.match(/<loc>https:\/\/www\.rawsushibar\.com\/branch-post\.html<\/loc>/g) || []).length;
    assert.equal(locCount, 1, 'the pre-existing sitemap entry must not be duplicated by the repair');
  } finally {
    fetchMock.restore();
  }
});

test('branch F: artifact content is exact but the branch ref does not resolve to a real commit object — fails closed, never invents a commit sha, still safely publishes through the normal path', async () => {
  const post = makeDuePost();
  const correctPage = renderArticlePage(post);
  const correctSitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://www.rawsushibar.com/branch-post.html</loc><lastmod>2020-01-01</lastmod></url>\n</urlset>\n`;
  const fetchMock = installGitFetch({ 'public/branch-post.html': correctPage, 'public/sitemap.xml': correctSitemap });
  // Override the ref response specifically to have no 'type' field (not a verifiable commit object).
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if ((init.method || 'GET') === 'GET' && u.pathname.endsWith('/git/ref/heads/main')) {
      return jsonResponse({ object: { sha: 'base-commit' } }); // same sha commitToGit's own /git/commits/{sha} lookup expects, just no 'type' field
    }
    return origFetch(url, init);
  };
  try {
    const kv = makeCallCountingKv({ posts: [post] });
    const response = await onRequest({ request: makeRequest(), env: { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: kv, ...GIT_ENV } });

    assert.equal(response.status, 200, `expected 200, got ${response.status}: ${JSON.stringify(await response.clone().json())}`);
    const body = await response.json();
    assert.deepEqual(body.published, [post.id]);
    assert.deepEqual(body.reconciled, [], 'an unverifiable branch commit sha must fail closed on the RECONCILE shortcut — never invent a commit sha for that path');

    const storedPosts = JSON.parse(kv.backing.get('table:posts'));
    assert.equal(storedPosts.find(p => p.id === post.id).status, 'published', 'still safely published through the normal, controlled commitToGit path, which does not depend on the ref type check');
  } finally {
    globalThis.fetch = origFetch;
    fetchMock.restore();
  }
});

test('write-count: an existing-artifact scheduled reconciliation performs exactly 6 KV writes and 0 GitHub writes (no commit, no tree, no ref update)', async () => {
  const post = makeDuePost();
  const fetchMock = installGitFetch({
    'public/branch-post.html': renderArticlePage(post),
    'public/sitemap.xml': `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://www.rawsushibar.com/branch-post.html</loc><lastmod>2020-01-01</lastmod></url>\n</urlset>\n`,
  });
  try {
    const kv = makeCallCountingKv({ posts: [post] });
    const response = await onRequest({ request: makeRequest(), env: { RAWWEBSITE_SCHEDULER_TOKEN: TOKEN, RAWWEBSITE_KV: kv, ...GIT_ENV } });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.reconciled, [post.id], 'precondition: this must actually take the reconcile shortcut for the write count to be meaningful');

    // posts: scheduled->publishing, post.transition audit, posts: publishing->published,
    // post.transition audit, post.reconciled_published audit, scheduler.run audit = 6.
    // No git.commit audit — gitPublish/commitToGit is never invoked on this path.
    assert.equal(kv.putCalls.length, 6, `expected exactly 6 KV writes, got ${kv.putCalls.length}: ${kv.putCalls.join(', ')}`);

    const writeCalls = fetchMock.observed.filter(o => o.method === 'POST' || o.method === 'PATCH');
    assert.deepEqual(writeCalls, [], 'expected zero GitHub write calls — reconciliation is fully read-only against Git');

    const readCalls = fetchMock.observed.filter(o => o.method === 'GET');
    assert.equal(readCalls.length, 3, `expected exactly 3 GitHub reads (page, sitemap, ref), got ${readCalls.length}`);
  } finally {
    fetchMock.restore();
  }
});
