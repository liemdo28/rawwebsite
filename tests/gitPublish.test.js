/**
 * tests/gitPublish.test.js — Unit tests for the Git publish worker.
 *
 * No real network calls. The global `fetch` is replaced with a stub for the
 * duration of each test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  commitToGit,
  commitMenuToGit,
  buildGitAuditEntry,
  verifyGitConfig,
  verifyGitArtifact,
} from '../lib/gitPublish.js';
import { postToMarkdown } from '../lib/posts.js';
import { renderArticlePage, addPathsToValidPathsManifest } from '../lib/renderArticlePage.js';

const DEFAULT_VALID_PATHS_MANIFEST = 'export const VALID_PATHS = new Set(["/"]);\n';

const ENV = {
  GITHUB_TOKEN: 'ghp_test_123',
  GITHUB_OWNER: 'acme',
  GITHUB_REPO: 'website',
  GITHUB_BRANCH: 'main',
};

const NodeBuffer = Buffer;

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
  publish_at: '2026-06-05T12:00:00.000Z',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function plainJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

function contentResponse(text) {
  return jsonResponse({ sha: 'file-sha', content: NodeBuffer.from(text).toString('base64') });
}

function installGitFetch(routes) {
  const observed = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    observed.push({ method, path: u.pathname, search: u.search, body, auth: init.headers?.Authorization || init.headers?.authorization });
    for (const route of routes) {
      if (route(method, u, body)) return route.response(method, u, body);
    }
    return jsonResponse({ message: 'Not Found' }, 404);
  };
  return {
    observed,
    restore() { globalThis.fetch = origFetch; },
  };
}

function gitDataRoutes({ identical = false, failPatchStatus = null, failReadStatus = null } = {}) {
  const current = {
    'content/posts/best-sushi-stockton.md': identical ? null : '',
    'content/index.json': identical ? null : JSON.stringify({ posts: [] }, null, 2),
    'public/best-sushi-stockton.html': identical ? null : '',
    'public/sitemap.xml': identical ? null : '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n',
    'functions/_validPaths.mjs': identical ? null : DEFAULT_VALID_PATHS_MANIFEST,
  };
  return [
    Object.assign((method, u) => method === 'GET' && u.pathname.endsWith('/git/ref/heads/main'), {
      response: () => jsonResponse({ object: { sha: 'base-commit' } }),
    }),
    Object.assign((method, u) => method === 'GET' && u.pathname.endsWith('/git/commits/base-commit'), {
      response: () => jsonResponse({ sha: 'base-commit', tree: { sha: 'base-tree' } }),
    }),
    Object.assign((method, u) => method === 'GET' && u.pathname.includes('/contents/'), {
      response: (_method, u) => {
        if (failReadStatus) return jsonResponse({ message: 'read failed' }, failReadStatus);
        const path = decodeURIComponent(u.pathname.split('/contents/')[1]);
        if (!(path in current)) return jsonResponse({ message: 'Not Found' }, 404);
        if (identical) {
          if (path === 'content/posts/best-sushi-stockton.md') return contentResponse(postToMarkdown(POST));
          if (path === 'content/index.json') return contentResponse(JSON.stringify({ posts: [{ slug: POST.slug, title: POST.title, excerpt: POST.excerpt, date: POST.date, post_type: 'blog', image: '', primary_keyword: POST.primary_keyword, secondary_keywords: POST.secondary_keywords, published: true }] }, null, 2));
          if (path === 'public/best-sushi-stockton.html') return contentResponse(renderArticlePage(POST));
          if (path === 'public/sitemap.xml') return contentResponse('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>https://www.rawsushibar.com/best-sushi-stockton.html</loc>\n    <lastmod>2026-06-05</lastmod>\n  </url>\n</urlset>\n');
          if (path === 'functions/_validPaths.mjs') return contentResponse(addPathsToValidPathsManifest(DEFAULT_VALID_PATHS_MANIFEST, POST));
        }
        return contentResponse(current[path]);
      },
    }),
    Object.assign((method, u) => method === 'POST' && u.pathname.endsWith('/git/trees'), {
      response: () => jsonResponse({ sha: 'new-tree' }),
    }),
    Object.assign((method, u) => method === 'POST' && u.pathname.endsWith('/git/commits'), {
      response: () => jsonResponse({ sha: 'single-publication-commit' }),
    }),
    Object.assign((method, u) => method === 'PATCH' && u.pathname.endsWith('/git/refs/heads/main'), {
      response: () => failPatchStatus ? jsonResponse({ message: 'write failed' }, failPatchStatus) : jsonResponse({ ref: 'refs/heads/main' }),
    }),
  ];
}

test('commitToGit: returns ok:false when credentials are missing', async () => {
  const r = await commitToGit({}, POST);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'missing_github_credentials');
});

test('commitToGit: creates one publication commit with all required artifacts', async () => {
  const mock = installGitFetch(gitDataRoutes());
  try {
    const r = await commitToGit(ENV, POST, { actor: 'admin:tester' });
    assert.equal(r.ok, true, `expected ok, got error: ${r.error}`);
    assert.equal(r.commit, 'single-publication-commit');
    assert.equal(r.repository, 'acme/website');
    assert.equal(r.branch, 'main');
    assert.deepEqual(r.files, [
      'content/posts/best-sushi-stockton.md',
      'content/index.json',
      'public/best-sushi-stockton.html',
      'public/sitemap.xml',
      'functions/_validPaths.mjs',
    ]);
    // Only public/ is ever deployed (build.mjs never touches root-level loose
    // files) — a root-level {slug}.html or root-level sitemap.xml must never
    // be part of the publication commit.
    assert.ok(!r.files.includes('best-sushi-stockton.html'), 'must not write a root-level page duplicate');
    assert.ok(!r.files.includes('sitemap.xml'), 'must not write a root-level sitemap duplicate');

    const treeCalls = mock.observed.filter(o => o.method === 'POST' && o.path.endsWith('/git/trees'));
    const commitCalls = mock.observed.filter(o => o.method === 'POST' && o.path.endsWith('/git/commits'));
    const refUpdates = mock.observed.filter(o => o.method === 'PATCH' && o.path.endsWith('/git/refs/heads/main'));
    assert.equal(treeCalls.length, 1);
    assert.equal(commitCalls.length, 1);
    assert.equal(refUpdates.length, 1);
    assert.deepEqual(treeCalls[0].body.tree.map(item => item.path), r.files);
    const indexEntry = JSON.parse(treeCalls[0].body.tree.find(item => item.path === 'content/index.json').content);
    assert.equal(indexEntry.posts[0].published, true);
  } finally {
    mock.restore();
  }
});

test('commitToGit: returns ok:false on GitHub API authentication failure', async () => {
  const mock = installGitFetch([
    Object.assign((method, u) => method === 'GET' && u.pathname.endsWith('/git/ref/heads/main'), {
      response: () => jsonResponse({ message: 'Bad credentials' }, 401),
    }),
  ]);
  try {
    const r = await commitToGit(ENV, POST);
    assert.equal(r.ok, false);
    // The error now carries enough detail to diagnose which endpoint
    // failed and GitHub's own message, not just a bare status code.
    assert.match(r.error, /^github_api_error:401:GET:\/git\/ref\/heads\/main/);
    assert.match(r.error, /Bad credentials/);
  } finally {
    mock.restore();
  }
});

test('commitToGit: returns ok:false on GitHub API write failure', async () => {
  const mock = installGitFetch(gitDataRoutes({ failPatchStatus: 422 }));
  try {
    const r = await commitToGit(ENV, POST);
    assert.equal(r.ok, false);
    assert.match(r.error, /^github_api_error:422:PATCH:\/git\/refs\/heads\/main/);
    assert.match(r.error, /write failed/);
  } finally {
    mock.restore();
  }
});

test('commitToGit: returns verified no-op when all artifacts already match', async () => {
  const mock = installGitFetch(gitDataRoutes({ identical: true }));
  try {
    const r = await commitToGit(ENV, POST);
    assert.equal(r.ok, true);
    assert.equal(r.action, 'noop');
    assert.equal(r.idempotent, true);
    assert.equal(r.commit, 'base-commit');
    assert.equal(mock.observed.some(o => o.method === 'PATCH'), false);
  } finally {
    mock.restore();
  }
});

test('commitToGit: decodes existing GitHub content in Workers where Buffer is unavailable', async () => {
  const observed = [];
  const originalFetch = globalThis.fetch;
  const originalBuffer = globalThis.Buffer;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    observed.push({ method, path: u.pathname, search: u.search, body });
    if (method === 'GET' && u.pathname.endsWith('/git/ref/heads/main')) {
      return plainJsonResponse({ object: { sha: 'base-commit' } });
    }
    if (method === 'GET' && u.pathname.endsWith('/git/commits/base-commit')) {
      return plainJsonResponse({ sha: 'base-commit', tree: { sha: 'base-tree' } });
    }
    if (method === 'GET' && u.pathname.includes('/contents/')) {
      return plainJsonResponse({ sha: 'file-sha', content: NodeBuffer.from('').toString('base64') });
    }
    if (method === 'POST' && u.pathname.endsWith('/git/trees')) {
      return plainJsonResponse({ sha: 'new-tree' });
    }
    if (method === 'POST' && u.pathname.endsWith('/git/commits')) {
      return plainJsonResponse({ sha: 'single-publication-commit' });
    }
    if (method === 'PATCH' && u.pathname.endsWith('/git/refs/heads/main')) {
      return plainJsonResponse({ ref: 'refs/heads/main' });
    }
    return plainJsonResponse({ message: 'Not Found' }, 404);
  };

  try {
    globalThis.Buffer = undefined;
    const r = await commitToGit(ENV, POST);
    assert.equal(r.ok, true, `expected ok, got error: ${r.error}`);
    assert.equal(r.commit, 'single-publication-commit');
    assert.equal(observed.some(o => o.method === 'PATCH'), true);
  } finally {
    globalThis.Buffer = originalBuffer;
    globalThis.fetch = originalFetch;
  }
});

test('commitMenuToGit: PUTs menu JSON to the right path', async () => {
  const observed = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    observed.push({ method, url: u.pathname, body });
    if (method === 'GET') return jsonResponse({ message: 'Not Found' }, 404);
    return jsonResponse({ commit: { sha: 'menusha222' }, content: { sha: 'menusha222' } });
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

test('buildGitAuditEntry: records commit hash, repository, branch, actor, action', () => {
  const entry = buildGitAuditEntry(
    { ok: true, commit: 'abc123', repository: 'acme/site', branch: 'main', files: ['content/posts/x.md'], action: 'commit' },
    { actor: 'admin:joe', targetType: 'post', targetId: 'post-1' }
  );
  assert.equal(entry.actor, 'admin:joe');
  assert.equal(entry.action, 'git.commit');
  assert.equal(entry.target_type, 'post');
  assert.equal(entry.target_id, 'post-1');
  assert.equal(entry.meta.commit, 'abc123');
  assert.equal(entry.meta.repository, 'acme/site');
  assert.equal(entry.meta.branch, 'main');
  assert.equal(entry.meta.action, 'commit');
  assert.equal(entry.meta.ok, true);
  assert.deepEqual(entry.meta.files, ['content/posts/x.md']);
});

test('buildGitAuditEntry: surfaces error in meta on failure', () => {
  const entry = buildGitAuditEntry(
    { ok: false, error: 'github_api_error:401', commit: null },
    { actor: 'system', targetType: 'post', targetId: 'post-2' }
  );
  assert.equal(entry.meta.ok, false);
  assert.equal(entry.meta.error, 'github_api_error:401');
  assert.equal(entry.meta.commit, null);
});

test('verifyGitConfig: returns ok:true with repository, branch, and sha on a successful read', async () => {
  const origFetch = globalThis.fetch;
  let observedUrl, observedHeaders;
  globalThis.fetch = async (url, init) => {
    observedUrl = url;
    observedHeaders = init.headers;
    return jsonResponse({ object: { sha: 'abc123def456' } });
  };
  try {
    const r = await verifyGitConfig(ENV);
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.equal(r.repository, 'acme/website');
    assert.equal(r.branch, 'main');
    assert.equal(r.sha, 'abc123def456');
    assert.match(observedUrl, /\/repos\/acme\/website\/git\/ref\/heads\/main$/);
    assert.equal(observedHeaders.Authorization, 'Bearer ghp_test_123');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('verifyGitConfig: makes exactly one GET request and no writes', async () => {
  const origFetch = globalThis.fetch;
  let callCount = 0;
  let methods = [];
  globalThis.fetch = async (url, init) => {
    callCount++;
    methods.push(init.method || 'GET');
    return jsonResponse({ object: { sha: 'onlyread' } });
  };
  try {
    await verifyGitConfig(ENV);
    assert.equal(callCount, 1);
    assert.deepEqual(methods, ['GET']);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('verifyGitConfig: distinguishes 400/401/403/404 and includes GitHub\'s sanitized message', async () => {
  const origFetch = globalThis.fetch;
  for (const [status, body] of [[400, '{"message":"Bad request"}'], [401, '{"message":"Bad credentials"}'], [403, '{"message":"Resource not accessible by personal access token"}'], [404, '{"message":"Not Found"}']]) {
    globalThis.fetch = async () => new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
    const r = await verifyGitConfig(ENV);
    assert.equal(r.ok, false);
    assert.equal(r.status, status);
    assert.match(r.error, new RegExp(`github_api_error:${status}`));
  }
  globalThis.fetch = origFetch;
});

test('verifyGitConfig: returns ok:false without any network call when credentials are missing', async () => {
  const origFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return jsonResponse({}); };
  try {
    const r = await verifyGitConfig({});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'missing_github_credentials');
    assert.equal(called, false);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('verifyGitConfig: never includes the token or Authorization header value in its result', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ object: { sha: 'x' } });
  try {
    const r = await verifyGitConfig(ENV);
    const serialized = JSON.stringify(r);
    assert.doesNotMatch(serialized, /ghp_test_123/);
    assert.doesNotMatch(serialized, /Bearer/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

/**
 * verifyGitArtifact() — added for lib/scheduler.js's stale-'publishing' and
 * reconcile-before-publish reconciliation paths (2026-07-28 KV-quota
 * hardening follow-ups). Reads GitHub's Contents API directly, never the
 * live site — a Cloudflare Pages SPA-fallback false-200 (the 2026-07-28
 * soft-404 incident) must never be mistaken for artifact proof. Deliberately
 * strict: requires the page content to be byte-identical to
 * renderArticlePage(post) computed right now (only meaningful because
 * rendering is deterministic — see renderArticlePage.test.js), not just
 * "a file exists" or "a substring matches." Read-only: makes no POST/PATCH
 * calls, so it can never create a duplicate commit. Returns distinct
 * pageBlobSha/sitemapBlobSha/branchCommitSha fields so a blob SHA is never
 * confused with the real publication (branch/commit) SHA.
 */
function installVerifyFetch({ pageHtml, sitemapXml, refSha = 'verified-commit-sha', refType = 'commit' } = {}) {
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ method: init.method || 'GET', url: String(url) });
    if (String(url).includes('/contents/public/best-sushi-stockton.html')) {
      return pageHtml === undefined ? jsonResponse({ message: 'Not Found' }, 404) : contentResponse(pageHtml);
    }
    if (String(url).includes('/contents/public/sitemap.xml')) {
      return sitemapXml === undefined ? jsonResponse({ message: 'Not Found' }, 404) : contentResponse(sitemapXml);
    }
    if (String(url).endsWith('/git/ref/heads/main')) {
      return jsonResponse({ object: { sha: refSha, type: refType } });
    }
    return jsonResponse({ message: 'Not Found' }, 404);
  };
  return { calls, restore() { globalThis.fetch = origFetch; } };
}

test('verifyGitArtifact: verified:true with distinct pageBlobSha/sitemapBlobSha/branchCommitSha when the page is byte-identical and the sitemap has exactly one matching entry', async () => {
  const expectedHtml = renderArticlePage(POST);
  const sitemap = `<urlset><url><loc>https://www.rawsushibar.com/best-sushi-stockton.html</loc></url></urlset>`;
  const mock = installVerifyFetch({ pageHtml: expectedHtml, sitemapXml: sitemap });
  try {
    const r = await verifyGitArtifact(ENV, POST);
    assert.equal(r.verified, true);
    assert.equal(r.ok, true, 'backward-compat alias');
    assert.equal(r.branchCommitSha, 'verified-commit-sha');
    assert.equal(r.commit, 'verified-commit-sha', 'backward-compat alias, must equal branchCommitSha, never a blob sha');
    assert.equal(typeof r.pageBlobSha, 'string');
    assert.equal(typeof r.sitemapBlobSha, 'string');
    assert.notEqual(r.pageBlobSha, r.branchCommitSha, 'a blob sha must never be confused with the branch commit sha');
    assert.equal(r.repository, 'acme/website');
    assert.equal(r.branch, 'main');
    assert.deepEqual(r.files, ['public/best-sushi-stockton.html', 'public/sitemap.xml']);
    assert.ok(mock.calls.every(c => c.method === 'GET'), 'verifyGitArtifact must never write — GET requests only');
  } finally {
    mock.restore();
  }
});

test('verifyGitArtifact: mismatchReason artifact_missing_page when the page file does not exist (no commit ever happened)', async () => {
  const mock = installVerifyFetch({}); // both page and sitemap undefined -> 404
  try {
    const r = await verifyGitArtifact(ENV, POST);
    assert.equal(r.verified, false);
    assert.equal(r.mismatchReason, 'artifact_missing_page');
  } finally {
    mock.restore();
  }
});

test('verifyGitArtifact: mismatchReason artifact_missing_canonical when the page exists but is not this post\'s canonical page (e.g. a stale/different page left at this path)', async () => {
  const mock = installVerifyFetch({ pageHtml: '<html><body>unrelated content, no canonical link at all</body></html>' });
  try {
    const r = await verifyGitArtifact(ENV, POST);
    assert.equal(r.verified, false);
    assert.equal(r.mismatchReason, 'artifact_missing_canonical');
    assert.equal(typeof r.pageBlobSha, 'string', 'the blob sha of the mismatched page should still be reported for diagnosis');
  } finally {
    mock.restore();
  }
});

test('verifyGitArtifact: mismatchReason artifact_content_mismatch when the page has the right canonical URL but stale/edited body content', async () => {
  const stalePage = renderArticlePage(POST).replace('A long body about sushi in Stockton.', 'An OLD, since-edited body.');
  const mock = installVerifyFetch({ pageHtml: stalePage });
  try {
    const r = await verifyGitArtifact(ENV, POST);
    assert.equal(r.verified, false);
    assert.equal(r.mismatchReason, 'artifact_content_mismatch');
  } finally {
    mock.restore();
  }
});

test('verifyGitArtifact: mismatchReason artifact_missing_sitemap_entry when the page matches exactly but the sitemap has no entry for it', async () => {
  const mock = installVerifyFetch({ pageHtml: renderArticlePage(POST), sitemapXml: '<urlset></urlset>' });
  try {
    const r = await verifyGitArtifact(ENV, POST);
    assert.equal(r.verified, false);
    assert.equal(r.mismatchReason, 'artifact_missing_sitemap_entry');
    assert.equal(typeof r.sitemapBlobSha, 'string');
  } finally {
    mock.restore();
  }
});

test('verifyGitArtifact: mismatchReason artifact_duplicate_sitemap_entry when the sitemap contains the URL more than once', async () => {
  const dupeSitemap = '<urlset>' + '<url><loc>https://www.rawsushibar.com/best-sushi-stockton.html</loc></url>'.repeat(2) + '</urlset>';
  const mock = installVerifyFetch({ pageHtml: renderArticlePage(POST), sitemapXml: dupeSitemap });
  try {
    const r = await verifyGitArtifact(ENV, POST);
    assert.equal(r.verified, false);
    assert.equal(r.mismatchReason, 'artifact_duplicate_sitemap_entry');
  } finally {
    mock.restore();
  }
});

test('verifyGitArtifact: mismatchReason branch_commit_sha_unverifiable when the ref does not resolve to a commit object (fails closed, never invents a commit sha)', async () => {
  const mock = installVerifyFetch({
    pageHtml: renderArticlePage(POST),
    sitemapXml: '<urlset><url><loc>https://www.rawsushibar.com/best-sushi-stockton.html</loc></url></urlset>',
    refType: 'tag', // not 'commit' — e.g. a lightweight/annotated tag response shape
  });
  try {
    const r = await verifyGitArtifact(ENV, POST);
    assert.equal(r.verified, false);
    assert.equal(r.mismatchReason, 'branch_commit_sha_unverifiable');
    assert.equal(r.branchCommitSha, undefined, 'must never invent or return a commit sha when it cannot be verified as a real commit object');
  } finally {
    mock.restore();
  }
});

test('verifyGitArtifact: verified:false without any network call when credentials are missing', async () => {
  const origFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return jsonResponse({}); };
  try {
    const r = await verifyGitArtifact({}, POST);
    assert.equal(r.verified, false);
    assert.equal(r.error, 'missing_github_credentials');
    assert.equal(called, false);
  } finally {
    globalThis.fetch = origFetch;
  }
});
