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

const GITHUB_API = 'https://api.github.com';

/**
 * Commit a published post to Git (creates/updates markdown file + index.json).
 *
 * @param {object} env - Environment variables
 * @param {object} post - The post object to publish
 * @param {object} [options]
 * @returns {Promise<{ ok: boolean, commit?: string, error?: string }>}
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
    // Generate markdown content
    const markdown = postToMarkdown(post);
    const filePath = `content/posts/${post.slug}.md`;

    // Get current file SHA (if exists) for update
    const existingSha = await getFileSha(token, owner, repo, branch, filePath);

    // Create/update the markdown file
    const commitResult = await createOrUpdateFile(token, owner, repo, branch, {
      path: filePath,
      content: markdown,
      message: `Publish post: ${post.title}`,
      sha: existingSha,
      committer: {
        name: 'RawWebsite Bot',
        email: 'bot@rawsushibar.com',
      },
    });

    // Also update content/index.json
    const indexResult = await updateContentIndex(token, owner, repo, branch, post);

    return {
      ok: true,
      commit: commitResult.commit?.sha || commitResult.content?.sha,
      files: [filePath, 'content/index.json'],
      actor: options.actor || 'system',
      action: existingSha ? 'update' : 'create',
    };
  } catch (e) {
    return { ok: false, error: e.message };
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
 * Update content/index.json with the new post entry.
 */
async function updateContentIndex(token, owner, repo, branch, post) {
  const filePath = 'content/index.json';

  // Fetch existing index
  let index = { posts: [] };
  const existingSha = await getFileSha(token, owner, repo, branch, filePath);

  if (existingSha) {
    const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'RawWebsite-GitPublish/1.0',
      },
    });
    if (res.ok) {
      const data = await res.json();
      try {
        index = JSON.parse(atob(data.content));
      } catch { /* use empty */ }
    }
  }

  if (!Array.isArray(index.posts)) index.posts = [];

  // Build post entry for index
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

  // Update or add entry
  const existingIdx = index.posts.findIndex(p => p.slug === post.slug);
  if (existingIdx === -1) {
    index.posts.unshift(entry);
  } else {
    index.posts[existingIdx] = entry;
  }

  // Write back
  return await createOrUpdateFile(token, owner, repo, branch, {
    path: filePath,
    content: JSON.stringify(index, null, 2),
    message: `Update content index: ${post.slug}`,
    sha: existingSha,
    committer: {
      name: 'RawWebsite Bot',
      email: 'bot@rawsushibar.com',
    },
  });
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
      files: result.files,
      action: result.action,
      ok: result.ok,
      error: result.error,
    },
  };
}
