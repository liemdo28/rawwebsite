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
import { renderArticlePage, addUrlToSitemap } from './renderArticlePage.js';

const GITHUB_API = 'https://api.github.com';

/**
 * Commit a published post to Git (creates/updates markdown file + index.json,
 * a routable static HTML page, and a sitemap.xml entry).
 *
 * The markdown + index.json alone are not enough: nothing in this project's
 * build (build.mjs just copies public/ and content/ as-is; src/pages/ is
 * empty) turns content/posts/*.md into a visitable page. Without also
 * committing public/<slug>.html, a "published" post would have no live URL.
 *
 * @param {object} env - Environment variables
 * @param {object} post - The post object to publish
 * @param {object} [options]
 * @returns {Promise<{ ok: boolean, commit?: string, repository?: string, branch?: string, files?: string[], error?: string }>}
 */
export async function commitToGit(env, post, options = {}) {
  const token = env.GITHUB_TOKEN;
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';

  if (!token || !owner || !repo) {
    return { ok: false, error: 'missing_github_credentials' };
  }

  try {
    const markdown = postToMarkdown(post);
    const filePath = `content/posts/${post.slug}.md`;
    const pagePath = `public/${post.slug}.html`;
    const pageHtml = renderArticlePage(post);
    const ref = await getBranchRef(token, owner, repo, branch);
    const baseCommit = await getCommit(token, owner, repo, ref.object.sha);
    const currentIndex = await readJsonFile(token, owner, repo, branch, 'content/index.json', { posts: [] });
    const currentSitemap = await readTextFile(token, owner, repo, branch, 'public/sitemap.xml',
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n');
    const indexJson = buildContentIndex(currentIndex, post);
    const sitemapXml = addUrlToSitemap(currentSitemap, post);

    const files = [
      { path: filePath, content: markdown },
      { path: 'content/index.json', content: JSON.stringify(indexJson, null, 2) },
      { path: pagePath, content: pageHtml },
      { path: 'public/sitemap.xml', content: sitemapXml },
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
 * Commit menu data to Git.
 *
 * @param {object} env
 * @param {object} menuData - { categories: [], items: [] }
 * @param {string} location - 'stockton'
 */
export async function commitMenuToGit(env, menuData, location, options = {}) {
  const token = env.GITHUB_TOKEN;
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';

  if (!token || !owner || !repo) {
    return { ok: false, error: 'missing_github_credentials' };
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
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'RawWebsite-GitPublish/1.0',
    },
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
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${options.path}`;

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
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'RawWebsite-GitPublish/1.0',
    },
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
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'RawWebsite-GitPublish/1.0',
    },
  });
  if (res.status === 404) return fallback;
  if (!res.ok) throw new Error(`github_api_error:${res.status}`);
  const data = await res.json();
  if (!data || typeof data.content !== 'string') return fallback;
  return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
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
    published: post.status === 'published',
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
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'RawWebsite-GitPublish/1.0',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) throw new Error(`github_api_error:${res.status}`);
  return await res.json();
}

function sanitizeGitError(error) {
  return String(error?.message || error || 'git_publish_failed')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]')
    .slice(0, 160);
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
