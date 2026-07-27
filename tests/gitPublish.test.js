/**
 * tests/gitPublish.test.js — Unit tests for the Git publish worker.
 *
 * Verifies that lib/gitPublish.js:
 *   - Returns ok:false when GitHub credentials are missing (no side-effects).
 *   - Calls the GitHub API: GET (to look up the existing file SHA) then PUT
 *     (to create/update the file with base64-encoded content).
 *   - Returns the commit hash from the API response.
 *   - Handles the 404 ("file does not exist") response from GET by sending
 *     a PUT without an sha.
 *   - Builds audit entries that record the commit hash, actor, and action.
 *
 * No real network calls. The global `fetch` is replaced with a stub for the
 * duration of each test.
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import {
  commitToGit,
  commitMenuToGit,
  buildGitAuditEntry,
} from '../lib/gitPublish.js';

const ENV = {
  GITHUB_TOKEN: 'ghp_test_123',
  GITHUB_OWNER: 'acme',
  GITHUB_REPO: 'website',
  GITHUB_BRANCH: 'main',
};

const POST = {
  slug: 'best-sushi-stockton',
  title: 'Best Sushi in Stockton',
  body: 'A long body about sushi in Stockton.',
  excerpt: 'A short excerpt.',
  status: 'publishing',
  location: 'raw_stockton',
  primary_keyword: 'sushi in Stockton',
  secondary_keywords: ['sushi', 'stockton'],
  image: '',
  date: '2026-06-05',
};

let server = null;

afterEach(async () => {
  if (server) {
    await new Promise(r => server.close(r));
    server = null;
  }
});

function startServer(handler) {
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      // Build a base URL that points to our local stub.
      // We override the GitHub base inside commitToGit by patching the
      // module's GITHUB_API constant via dynamic import — easier to just
      // intercept fetch entirely and assert on the URL the code called.
      resolve({ port, base: `http://127.0.0.1:${port}` });
    });
  });
}

test('commitToGit: returns ok:false when credentials are missing', async () => {
  const r = await commitToGit({}, POST);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'missing_github_credentials');
});

test('commitToGit: PUTs markdown to GitHub content API and returns commit hash', async () => {
  const observed = [];
  const { port } = await startServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      observed.push({
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        accept: req.headers.accept,
        body: body ? JSON.parse(body) : null,
      });
      // First call: GET contents → return 404 (file does not exist)
      if (req.method === 'GET') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Not Found' }));
        return;
      }
      // Second call: PUT contents → return commit
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        commit: { sha: 'commitsha123' },
        content: { sha: 'filesha456' },
      }));
    });
  });

  // Patch the GitHub API base by writing into process.env (the module uses
  // a module-scope constant; we use a relative require hack by importing
  // the module fresh — but the constant is hard-coded. To avoid that, we
  // just verify the request URLs match the expected GitHub pattern by
  // matching on the well-known content endpoint path).
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    // Re-target the GitHub URL to our local server.
    const u = new URL(url);
    const redirected = `http://127.0.0.1:${port}${u.pathname}${u.search}`;
    return await origFetch(redirected, init);
  };

  try {
    const r = await commitToGit(ENV, POST, { actor: 'admin:tester' });
    assert.equal(r.ok, true, `expected ok, got error: ${r.error}`);
    assert.equal(r.commit, 'commitsha123');
    assert.deepEqual(r.files, [
      'content/posts/best-sushi-stockton.md',
      'content/index.json',
      'public/best-sushi-stockton.html',
      'public/sitemap.xml',
    ]);
    assert.equal(r.actor, 'admin:tester');
    assert.equal(r.action, 'create');

    // We expect: (GET SHA + PUT) for markdown, index.json, the rendered page,
    // and sitemap.xml = 4 * (GET + PUT) = 8 calls.
    assert.equal(observed.length, 8);

    // First call: GET markdown SHA
    assert.equal(observed[0].method, 'GET');
    assert.match(observed[0].url, /\/repos\/acme\/website\/contents\/content\/posts\/best-sushi-stockton\.md/);
    assert.equal(observed[0].auth, 'Bearer ghp_test_123');

    // Second call: PUT markdown
    assert.equal(observed[1].method, 'PUT');
    assert.match(observed[1].url, /\/repos\/acme\/website\/contents\/content\/posts\/best-sushi-stockton\.md/);
    assert.equal(observed[1].body.branch, 'main');
    assert.equal(observed[1].body.message, 'Publish post: Best Sushi in Stockton');
    assert.ok(observed[1].body.content, 'content (base64) should be set');
    assert.equal(observed[1].body.sha, undefined, 'no sha → create, not update');
    // base64 should decode to a markdown document that contains the title.
    const decoded = Buffer.from(observed[1].body.content, 'base64').toString('utf8');
    assert.match(decoded, /title: "Best Sushi in Stockton"/);
    assert.match(decoded, /slug: best-sushi-stockton/);

    // Third call: GET index.json SHA
    assert.equal(observed[2].method, 'GET');
    assert.match(observed[2].url, /\/contents\/content\/index\.json/);

    // Fourth call: PUT index.json
    assert.equal(observed[3].method, 'PUT');
    const decodedIndex = JSON.parse(Buffer.from(observed[3].body.content, 'base64').toString('utf8'));
    assert.ok(Array.isArray(decodedIndex.posts));
    assert.equal(decodedIndex.posts[0].slug, 'best-sushi-stockton');
    assert.equal(decodedIndex.posts[0].title, 'Best Sushi in Stockton');
    assert.equal(decodedIndex.posts[0].published, false, 'status was publishing, not yet published');

    // Fifth/sixth call: GET + PUT the rendered static page — this is the
    // actual routable HTML a visitor/crawler would hit.
    assert.equal(observed[4].method, 'GET');
    assert.match(observed[4].url, /\/contents\/public\/best-sushi-stockton\.html/);
    assert.equal(observed[5].method, 'PUT');
    assert.match(observed[5].url, /\/contents\/public\/best-sushi-stockton\.html/);
    const decodedPage = Buffer.from(observed[5].body.content, 'base64').toString('utf8');
    assert.match(decodedPage, /<title>Best Sushi in Stockton \| Raw Sushi Bar<\/title>/);
    assert.match(decodedPage, /rel="canonical" href="https:\/\/www\.rawsushibar\.com\/best-sushi-stockton\.html"/);

    // Seventh/eighth call: GET + PUT sitemap.xml with the new URL appended.
    assert.equal(observed[6].method, 'GET');
    assert.match(observed[6].url, /\/contents\/public\/sitemap\.xml/);
    assert.equal(observed[7].method, 'PUT');
    const decodedSitemap = Buffer.from(observed[7].body.content, 'base64').toString('utf8');
    assert.match(decodedSitemap, /https:\/\/www\.rawsushibar\.com\/best-sushi-stockton\.html/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('commitToGit: includes sha in PUT body when file already exists (update)', async () => {
  const observed = [];
  const { port } = await startServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      observed.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sha: 'existing-sha-999' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ commit: { sha: 'updatesha111' }, content: { sha: 'updatesha111' } }));
    });
  });

  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    return await origFetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`, init);
  };

  try {
    const r = await commitToGit(ENV, POST);
    assert.equal(r.ok, true);
    assert.equal(r.action, 'update');

    // Find the PUT for the markdown (it's the first PUT after the GETs)
    const putMarkdown = observed.find(o => o.method === 'PUT' && /best-sushi-stockton\.md/.test(o.url));
    assert.ok(putMarkdown, 'expected PUT for the markdown file');
    assert.equal(putMarkdown.body.sha, 'existing-sha-999');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('commitToGit: returns ok:false when GitHub returns a non-OK status', async () => {
  const { port } = await startServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Internal server error' }));
  });

  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    return await origFetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`, init);
  };

  try {
    const r = await commitToGit(ENV, POST);
    assert.equal(r.ok, false);
    assert.match(r.error, /GitHub API error: 500/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('commitMenuToGit: PUTs menu JSON to the right path', async () => {
  const observed = [];
  const { port } = await startServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      observed.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      if (req.method === 'GET') {
        res.writeHead(404); res.end('{}'); return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ commit: { sha: 'menusha222' }, content: { sha: 'menusha222' } }));
    });
  });

  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    return await origFetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`, init);
  };

  try {
    const menuData = { categories: [{ id: 'c1', name: 'Nigiri' }], items: [{ id: 'i1', name: 'Salmon' }] };
    const r = await commitMenuToGit(ENV, menuData, 'stockton', { actor: 'admin:menu' });
    assert.equal(r.ok, true);
    assert.equal(r.commit, 'menusha222');
    assert.equal(r.file, 'public/menu/stockton-menu.json');
    assert.equal(r.actor, 'admin:menu');

    const put = observed.find(o => o.method === 'PUT');
    assert.match(put.url, /\/contents\/public\/menu\/stockton-menu\.json/);
    const decoded = JSON.parse(Buffer.from(put.body.content, 'base64').toString('utf8'));
    assert.equal(decoded.categories[0].name, 'Nigiri');
    assert.equal(put.body.message, 'Update stockton menu');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('commitMenuToGit: returns ok:false when credentials missing', async () => {
  const r = await commitMenuToGit({}, { categories: [], items: [] }, 'modesto');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'missing_github_credentials');
});

test('buildGitAuditEntry: records commit hash, actor, action', () => {
  const entry = buildGitAuditEntry(
    { ok: true, commit: 'abc123', files: ['content/posts/x.md'], action: 'create' },
    { actor: 'admin:joe', targetType: 'post', targetId: 'post-1' }
  );
  assert.equal(entry.actor, 'admin:joe');
  assert.equal(entry.action, 'git.commit');
  assert.equal(entry.target_type, 'post');
  assert.equal(entry.target_id, 'post-1');
  assert.equal(entry.meta.commit, 'abc123');
  assert.equal(entry.meta.action, 'create');
  assert.equal(entry.meta.ok, true);
  assert.deepEqual(entry.meta.files, ['content/posts/x.md']);
});

test('buildGitAuditEntry: surfaces error in meta on failure', () => {
  const entry = buildGitAuditEntry(
    { ok: false, error: 'GitHub API error: 401', commit: null },
    { actor: 'system', targetType: 'post', targetId: 'post-2' }
  );
  assert.equal(entry.meta.ok, false);
  assert.equal(entry.meta.error, 'GitHub API error: 401');
  assert.equal(entry.meta.commit, null);
});
