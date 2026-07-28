/**
 * lib/gitPublish.js — Git publish worker via GitHub API.
 *
 * Commits generated markdown/json content to GitHub without using filesystem.
 * Uses GitHub's REST API to create/update files directly.
 *
 * Required env vars:
 *   - GITHUB_TOKEN  — Personal access token with repo scope
 *   - GITHUB_OWNER  — Repository owner (e.g., "liemdo28")
 *   - GITHUB_REPO   — Repository name (e.g., "rawwebsite")
 *   - GITHUB_BRANCH — Target branch (default: "main")
 */

import { postToMarkdown } from './posts.js';
import { renderArticlePage, addUrlToSitemap, addPathsToValidPathsManifest } from './renderArticlePage.js';

const GITHUB_API = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const SITE_URL = 'https://www.rawsushibar.com'; // must match lib/renderArticlePage.js's SITE

/**
 * Trim GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO/GITHUB_BRANCH and default the
 * branch to 'main'. Trimming happens here, once, so every call site — the
 * fetch(), the Authorization header, the URL — sees the same clean values.
 * Never logs or returns the token.
 */
export function normalizeGitEnv(env) {
  const clean = (v) => String(v ?? '').trim();
  return {
    token: clean(env.GITHUB_TOKEN),
    owner: clean(env.GITHUB_OWNER),
    repo: clean(env.GITHUB_REPO),
    branch: clean(env.GITHUB_BRANCH) || 'main',
  };
}

/** True if trimming alone can't fix it — an embedded CR/LF would corrupt an HTTP header. */
export function hasInvalidHeaderChars(value) {
  return /[\r\n]/.test(value);
}

/**
 * Shared GitHub REST headers. Content-Type is only included when the
 * request actually has a JSON body — never on a bodyless GET.
 */
export function githubHeaders(token, { hasBody = false } = {}) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': 'rawwebsite-scheduler',
  };
  if (hasBody) headers['Content-Type'] = 'application/json';
  return headers;
}

/**
 * Commit a published post to Git (creates/updates markdown file + index.json,
 * a routable static HTML page, a sitemap.xml entry, and the routing
 * manifest _middleware.js uses to tell real pages from soft-404s).
 *
 * The markdown + index.json alone are not enough: nothing in this project's
 * build (build.mjs just copies public/ and content/ as-is; src/pages/ is
 * empty) turns content/posts/*.md into a visitable page. Without also
 * committing public/<slug>.html, a "published" post would have no live URL.
 * And without updating functions/_validPaths.mjs in the same commit, the
 * newly-published page would be incorrectly served a real 404 by
 * _middleware.js until someone next ran the full manifest generator (see
 * scripts/generate-valid-paths.mjs and the 2026-07-28 soft-404 incident).
 *
 * @param {object} env - Environment variables
 * @param {object} post - The post object to publish
 * @param {object} [options]
 * @returns {Promise<{ ok: boolean, commit?: string, repository?: string, branch?: string, files?: string[], error?: string }>}
 */
export async function commitToGit(env, post, options = {}) {
  const { token, owner, repo, branch } = normalizeGitEnv(env);

  if (!token || !owner || !repo) {
    return { ok: false, error: 'missing_github_credentials' };
  }
  if (hasInvalidHeaderChars(token) || hasInvalidHeaderChars(owner) || hasInvalidHeaderChars(repo) || hasInvalidHeaderChars(branch)) {
    return { ok: false, error: 'invalid_github_credentials_format' };
  }

  try {
    const markdown = postToMarkdown(post);
    const filePath = `content/posts/${post.slug}.md`;
    // Only public/ is ever deployed: build.mjs copies public/ -> dist/ (twice)
    // plus functions/, content/, lib/, config/ — it never touches root-level
    // loose files. A root-level {slug}.html or root-level sitemap.xml would
    // be committed but never served, so this only writes the public/ copy.
    const publicPagePath = `public/${post.slug}.html`;
    const pageHtml = renderArticlePage(post);
    const ref = await getBranchRef(token, owner, repo, branch);
    const baseCommit = await getCommit(token, owner, repo, ref.object.sha);
    const currentIndex = await readJsonFile(token, owner, repo, branch, 'content/index.json', { posts: [] });
    const currentPublicSitemap = await readTextFile(token, owner, repo, branch, 'public/sitemap.xml',
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n');
    const currentValidPaths = await readTextFile(token, owner, repo, branch, 'functions/_validPaths.mjs',
      'export const VALID_PATHS = new Set(["/"]);\n');
    const indexJson = buildContentIndex(currentIndex, post);
    const publicSitemapXml = addUrlToSitemap(currentPublicSitemap, post);
    const validPathsManifest = addPathsToValidPathsManifest(currentValidPaths, post);

    const files = [
      { path: filePath, content: markdown },
      { path: 'content/index.json', content: JSON.stringify(indexJson, null, 2) },
      { path: publicPagePath, content: pageHtml },
      { path: 'public/sitemap.xml', content: publicSitemapXml },
      { path: 'functions/_validPaths.mjs', content: validPathsManifest },
    ];

    const changedFiles = [];
    for (const file of files) {
      const current = await readTextFile(token, owner, repo, branch, file.path, null);
      if (current !== file.content) changedFiles.push(file);
    }

    if (changedFiles.length === 0) {
      return {
        ok: true,
        commit: ref.object.sha,
        repository: `${owner}/${repo}`,
        branch,
        files: files.map(file => file.path),
        actor: options.actor || 'system',
        action: 'noop',
        idempotent: true,
      };
    }

    const tree = await createTree(token, owner, repo, baseCommit.tree.sha, changedFiles);
    const commit = await createCommit(token, owner, repo, {
      message: `Publish post: ${post.title}`,
      tree: tree.sha,
      parents: [ref.object.sha],
    });
    await updateRef(token, owner, repo, branch, commit.sha);

    return {
      ok: true,
      commit: commit.sha,
      repository: `${owner}/${repo}`,
      branch,
      files: files.map(file => file.path),
      actor: options.actor || 'system',
      action: 'commit',
    };
  } catch (e) {
    return { ok: false, error: sanitizeGitError(e) };
  }
}

/**
 * Read a file's decoded text content AND its blob SHA (unlike readTextFile,
 * which discards the SHA — needed here so callers can never confuse a blob
 * SHA with a branch/commit SHA). Returns null if the file doesn't exist.
 */
async function readFileWithSha(token, owner, repo, branch, path) {
  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: githubHeaders(token, { hasBody: false }) });
  if (res.status === 404) return null;
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.text();
      detail = body ? `:${body.slice(0, 200)}` : '';
    } catch { /* ignore */ }
    throw new Error(`github_api_error:${res.status}:GET:contents/${path}${detail}`);
  }
  const data = await res.json();
  if (!data || typeof data.content !== 'string' || typeof data.sha !== 'string') return null;
  return { content: decodeBase64Utf8(data.content), sha: data.sha };
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Verify that a post's expected Git artifact genuinely exists in the repo
 * AND matches the exact deterministic expected content — used by
 * lib/scheduler.js's reconciliation paths (stale-'publishing' recovery, and
 * reconcile-before-publish for due 'scheduled' posts whose commit already
 * happened in a prior, interrupted run) to confirm a real, correct publish
 * already exists before skipping commitToGit, so a duplicate publication
 * commit is never created.
 *
 * Deliberately strict — none of these alone are treated as proof:
 *   - the file merely existing / GitHub Contents API returning 200;
 *   - a sitemap substring match (could match a different, similar URL, or a
 *     stale entry from before the article was ever meaningfully edited);
 *   - a live-site HTTP 200 (Cloudflare Pages' SPA-fallback can return 200
 *     with homepage content for a path that was never actually published —
 *     see the 2026-07-28 soft-404 incident). verifyGitArtifact never fetches
 *     the live site at all, only GitHub's Contents API directly.
 *
 * What "verified" actually requires:
 *   - the page file exists at the exact expected path (public/{slug}.html)
 *     for the configured repository + branch;
 *   - it contains the correct canonical URL (rules out a stale/different
 *     page having been left at this path);
 *   - its content is BYTE-IDENTICAL to renderArticlePage(post) computed
 *     right now — this is only meaningful because rendering is deterministic
 *     (see lib/renderArticlePage.js's content_updated_at fix); this single
 *     check subsumes title/slug/body identity, since any of those differing
 *     would make the byte comparison fail;
 *   - the sitemap contains the exact canonical URL as ONE complete <loc>
 *     entry — zero is "not published," more than one is a duplicate, and
 *     both fail closed rather than being treated as success;
 *   - the branch ref resolves to a real commit object (GitHub's ref API
 *     response includes object.type; only 'commit' is accepted) — a blob
 *     SHA is never returned or labeled as the publication commit SHA.
 *
 * Read-only: makes no POST/PATCH calls, so it can never create a commit.
 *
 * @param {object} env
 * @param {object} post
 * @returns {Promise<{
 *   verified: boolean, ok?: boolean, mismatchReason?: string, error?: string,
 *   branchCommitSha?: string, commit?: string,
 *   pageBlobSha?: string, sitemapBlobSha?: string,
 *   repository?: string, branch?: string, files?: string[],
 * }>}
 */
export async function verifyGitArtifact(env, post) {
  const { token, owner, repo, branch } = normalizeGitEnv(env);
  const repository = owner && repo ? `${owner}/${repo}` : undefined;

  if (!token || !owner || !repo) {
    return { verified: false, error: 'missing_github_credentials' };
  }
  if (hasInvalidHeaderChars(token) || hasInvalidHeaderChars(owner) || hasInvalidHeaderChars(repo) || hasInvalidHeaderChars(branch)) {
    return { verified: false, error: 'invalid_github_credentials_format' };
  }

  try {
    const publicPagePath = `public/${post.slug}.html`;
    const page = await readFileWithSha(token, owner, repo, branch, publicPagePath);
    if (!page) {
      return { verified: false, mismatchReason: 'artifact_missing_page', repository, branch };
    }

    const canonicalUrl = `${SITE_URL}/${post.slug}.html`;
    if (!page.content.includes(`<link rel="canonical" href="${canonicalUrl}">`)) {
      return { verified: false, mismatchReason: 'artifact_missing_canonical', pageBlobSha: page.sha, repository, branch };
    }

    const expectedPageHtml = renderArticlePage(post);
    if (page.content !== expectedPageHtml) {
      return { verified: false, mismatchReason: 'artifact_content_mismatch', pageBlobSha: page.sha, repository, branch };
    }

    const sitemap = await readFileWithSha(token, owner, repo, branch, 'public/sitemap.xml');
    if (!sitemap) {
      return { verified: false, mismatchReason: 'artifact_missing_sitemap', pageBlobSha: page.sha, repository, branch };
    }
    const locMatches = sitemap.content.match(new RegExp(`<loc>${escapeRegExp(canonicalUrl)}</loc>`, 'g')) || [];
    if (locMatches.length === 0) {
      return { verified: false, mismatchReason: 'artifact_missing_sitemap_entry', pageBlobSha: page.sha, sitemapBlobSha: sitemap.sha, repository, branch };
    }
    if (locMatches.length > 1) {
      return { verified: false, mismatchReason: 'artifact_duplicate_sitemap_entry', pageBlobSha: page.sha, sitemapBlobSha: sitemap.sha, repository, branch };
    }

    const ref = await getBranchRef(token, owner, repo, branch);
    if (!ref?.object?.sha || ref.object.type !== 'commit') {
      return { verified: false, mismatchReason: 'branch_commit_sha_unverifiable', pageBlobSha: page.sha, sitemapBlobSha: sitemap.sha, repository, branch };
    }

    return {
      verified: true,
      ok: true, // backward-compat alias for existing callers/tests
      branchCommitSha: ref.object.sha,
      commit: ref.object.sha, // backward-compat alias — always the real commit SHA, never a blob SHA
      pageBlobSha: page.sha,
      sitemapBlobSha: sitemap.sha,
      repository,
      branch,
      files: [publicPagePath, 'public/sitemap.xml'],
    };
  } catch (e) {
    return { verified: false, error: sanitizeGitError(e) };
  }
}

/**
 * Read-only credential/configuration check: confirms GITHUB_TOKEN can read
 * GITHUB_OWNER/GITHUB_REPO's GITHUB_BRANCH ref via a single harmless GET.
 * Uses the exact same config resolution as commitToGit (env.GITHUB_TOKEN,
 * env.GITHUB_OWNER, env.GITHUB_REPO, env.GITHUB_BRANCH || 'main') so a
 * passing result means commitToGit will resolve the same repository/branch.
 *
 * Makes no commits, trees, blobs, branches, issues, or any other write.
 * Never returns the token or an Authorization header value.
 *
 * @param {object} env
 * @returns {Promise<{ ok: boolean, status?: number, repository: string, branch: string, sha?: string, error?: string }>}
 */
export async function verifyGitConfig(env) {
  const { token, owner, repo, branch } = normalizeGitEnv(env);
  const repository = `${owner || '(unset)'}/${repo || '(unset)'}`;

  if (!token || !owner || !repo) {
    return { ok: false, repository, branch, error: 'missing_github_credentials' };
  }
  if (hasInvalidHeaderChars(token) || hasInvalidHeaderChars(owner) || hasInvalidHeaderChars(repo) || hasInvalidHeaderChars(branch)) {
    return { ok: false, repository, branch, error: 'invalid_github_credentials_format' };
  }

  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: githubHeaders(token, { hasBody: false }),
    });
  } catch (e) {
    return { ok: false, repository, branch, error: `network_error:${sanitizeGitError(e)}` };
  }

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.text();
      detail = body ? `:${body.slice(0, 200)}` : '';
    } catch { /* ignore */ }
    return {
      ok: false,
      status: res.status,
      repository,
      branch,
      error: sanitizeGitError(`github_api_error:${res.status}${detail}`),
    };
  }

  const data = await res.json();
  return {
    ok: true,
    status: res.status,
    repository,
    branch,
    sha: data?.object?.sha || null,
  };
}

/**
 * Commit menu data to Git.
 *
 * @param {object} env
 * @param {object} menuData - { categories: [], items: [] }
 * @param {string} location - 'stockton'
 */
export async function commitMenuToGit(env, menuData, location, options = {}) {
  const { token, owner, repo, branch } = normalizeGitEnv(env);

  if (!token || !owner || !repo) {
    return { ok: false, error: 'missing_github_credentials' };
  }
  if (hasInvalidHeaderChars(token) || hasInvalidHeaderChars(owner) || hasInvalidHeaderChars(repo) || hasInvalidHeaderChars(branch)) {
    return { ok: false, error: 'invalid_github_credentials_format' };
  }

  try {
    const filePath = `public/menu/${location}-menu.json`;
    const content = JSON.stringify(menuData, null, 2);
    const existingSha = await getFileSha(token, owner, repo, branch, filePath);

    const result = await createOrUpdateFile(token, owner, repo, branch, {
      path: filePath,
      content,
      message: `Update ${location} menu`,
      sha: existingSha,
      committer: {
        name: 'RawWebsite Bot',
        email: 'bot@rawsushibar.com',
      },
    });

    return {
      ok: true,
      commit: result.commit?.sha || result.content?.sha,
      file: filePath,
      actor: options.actor || 'system',
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Get the SHA of an existing file (returns null if not found).
 */
async function getFileSha(token, owner, repo, branch, path) {
  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, {
    headers: githubHeaders(token, { hasBody: false }),
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.sha;
}

/**
 * Create or update a file in the repository.
 */
async function createOrUpdateFile(token, owner, repo, branch, options) {
  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${options.path}`;

  // Content must be base64 encoded
  const contentBase64 = btoa(unescape(encodeURIComponent(options.content)));

  const body = {
    message: options.message,
    content: contentBase64,
    branch,
    committer: options.committer,
  };

  if (options.sha) {
    body.sha = options.sha;
  }

  const res = await fetch(url, {
    method: 'PUT',
    headers: githubHeaders(token, { hasBody: true }),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error: ${res.status} ${text}`);
  }

  return await res.json();
}

/**
 * Read a text file from GitHub contents API.
 */
async function readTextFile(token, owner, repo, branch, path, fallback = '') {
  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, {
    headers: githubHeaders(token, { hasBody: false }),
  });
  if (res.status === 404) return fallback;
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.text();
      detail = body ? `:${body.slice(0, 200)}` : '';
    } catch { /* ignore */ }
    throw new Error(`github_api_error:${res.status}:GET:contents/${path}${detail}`);
  }
  const data = await res.json();
  if (!data || typeof data.content !== 'string') return fallback;
  return decodeBase64Utf8(data.content);
}

async function readJsonFile(token, owner, repo, branch, path, fallback) {
  const text = await readTextFile(token, owner, repo, branch, path, null);
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function buildContentIndex(index, post) {
  const next = index && typeof index === 'object' ? { ...index } : { posts: [] };
  if (!Array.isArray(next.posts)) next.posts = [];
  const entry = {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt || '',
    date: (post.date || post.publish_at || new Date().toISOString()).toString().slice(0, 10),
    post_type: post.post_type || 'blog',
    image: post.image || '',
    primary_keyword: post.primary_keyword || '',
    secondary_keywords: post.secondary_keywords || [],
    published: true,
  };
  const existingIdx = next.posts.findIndex(p => p.slug === post.slug);
  if (existingIdx === -1) {
    next.posts.unshift(entry);
  } else {
    next.posts[existingIdx] = entry;
  }
  return next;
}

async function getBranchRef(token, owner, repo, branch) {
  const res = await gitJson(token, owner, repo, `/git/ref/heads/${encodeURIComponent(branch)}`);
  if (!res?.object?.sha) throw new Error('github_ref_missing');
  return res;
}

async function getCommit(token, owner, repo, sha) {
  const res = await gitJson(token, owner, repo, `/git/commits/${sha}`);
  if (!res?.tree?.sha) throw new Error('github_commit_missing_tree');
  return res;
}

async function createTree(token, owner, repo, baseTree, files) {
  return await gitJson(token, owner, repo, '/git/trees', {
    method: 'POST',
    body: {
      base_tree: baseTree,
      tree: files.map(file => ({
        path: file.path,
        mode: '100644',
        type: 'blob',
        content: file.content,
      })),
    },
  });
}

async function createCommit(token, owner, repo, options) {
  const res = await gitJson(token, owner, repo, '/git/commits', {
    method: 'POST',
    body: {
      message: options.message,
      tree: options.tree,
      parents: options.parents,
      committer: {
        name: 'RawWebsite Bot',
        email: 'bot@rawsushibar.com',
      },
    },
  });
  if (!res?.sha) throw new Error('github_commit_create_failed');
  return res;
}

async function updateRef(token, owner, repo, branch, sha) {
  await gitJson(token, owner, repo, `/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: { sha, force: false },
  });
}

async function gitJson(token, owner, repo, path, options = {}) {
  const res = await fetch(`${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`, {
    method: options.method || 'GET',
    headers: githubHeaders(token, { hasBody: !!options.body }),
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    // Surface which endpoint and what GitHub actually said (its error
    // bodies never echo back the Authorization header) — a bare status
    // code is not enough to diagnose auth vs. malformed-request vs.
    // permission problems.
    let detail = '';
    try {
      const body = await res.text();
      detail = body ? `:${body.slice(0, 200)}` : '';
    } catch { /* ignore */ }
    throw new Error(`github_api_error:${res.status}:${options.method || 'GET'}:${path}${detail}`);
  }
  return await res.json();
}

function sanitizeGitError(error) {
  return String(error?.message || error || 'git_publish_failed')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]')
    .replace(/gh[ps]_[A-Za-z0-9]+/g, '[redacted-token]')
    .slice(0, 400);
}

function decodeBase64Utf8(content) {
  const normalized = String(content || '').replace(/\n/g, '');
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(normalized, 'base64').toString('utf8');
  }

  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Record a git commit in the audit log.
 */
export function buildGitAuditEntry(result, options = {}) {
  return {
    actor: options.actor || 'system',
    action: 'git.commit',
    target_type: options.targetType || 'post',
    target_id: options.targetId,
    meta: {
      commit: result.commit,
      repository: result.repository,
      branch: result.branch,
      files: result.files,
      action: result.action,
      ok: result.ok,
      error: result.error,
    },
  };
}
