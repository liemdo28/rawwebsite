/**
 * tests/scheduler.test.js — Unit tests for scheduled publishing.
 *
 * Tests the draft → scheduled → published workflow including:
 * - Setting a post to scheduled with publish_at
 * - Auto-publishing when publish_at <= now
 * - Failed publish scenarios
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../lib/store.js';
import { transitionPost } from '../lib/posts.js';
import {
  processScheduledPosts,
  schedulePost,
  listScheduledPosts,
} from '../lib/scheduler.js';

test('schedulePost: schedules a post with future publish_at', async () => {
  const store = new MemoryStore();
  
  // Create a draft post
  const post = await store.upsert('posts', {
    slug: 'test-schedule',
    title: 'Test Scheduled Post',
    body: 'This is a test post that will be scheduled.',
    status: 'draft',
  });

  // Transition to approved (required before scheduling)
  await transitionPost(store, post.id, 'pending_review');
  await transitionPost(store, post.id, 'approved');

  // Schedule for future
  const futureDate = new Date(Date.now() + 3600000); // 1 hour from now
  const scheduled = await schedulePost(store, post.id, futureDate);

  assert.equal(scheduled.status, 'scheduled');
  assert.ok(scheduled.publish_at);
  assert.equal(new Date(scheduled.publish_at).getTime(), futureDate.getTime());
});

test('processScheduledPosts: publishes posts with past publish_at', async () => {
  const store = new MemoryStore();

  // Create and schedule a post with past publish_at
  const post = await store.upsert('posts', {
    slug: 'test-past-schedule',
    title: 'Past Scheduled Post',
    body: 'This post should be auto-published.',
    status: 'scheduled',
    publish_at: new Date(Date.now() - 60000).toISOString(), // 1 minute ago
  });

  const result = await processScheduledPosts(store, { requireGitPublish: false });

  assert.equal(result.processed, 1);
  assert.equal(result.published.length, 1);
  assert.ok(result.published.includes(post.id));
  assert.equal(result.failed.length, 0);

  // Verify post is now published
  const updated = await store.get('posts', post.id);
  assert.equal(updated.status, 'published');
  assert.ok(updated.published_at);
});

test('processScheduledPosts: does not publish future posts', async () => {
  const store = new MemoryStore();

  // Create a post scheduled for the future
  const post = await store.upsert('posts', {
    slug: 'test-future-schedule',
    title: 'Future Scheduled Post',
    body: 'This post should NOT be auto-published yet.',
    status: 'scheduled',
    publish_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
  });

  const result = await processScheduledPosts(store, { requireGitPublish: false });

  assert.equal(result.processed, 0);
  assert.equal(result.published.length, 0);

  // Verify post is still scheduled
  const updated = await store.get('posts', post.id);
  assert.equal(updated.status, 'scheduled');
});

test('processScheduledPosts: handles multiple posts', async () => {
  const store = new MemoryStore();

  // Create multiple scheduled posts (2 past, 1 future)
  const pastPost1 = await store.upsert('posts', {
    slug: 'past-1',
    title: 'Past Post 1',
    body: 'Body 1',
    status: 'scheduled',
    publish_at: new Date(Date.now() - 120000).toISOString(), // 2 min ago
  });

  const pastPost2 = await store.upsert('posts', {
    slug: 'past-2',
    title: 'Past Post 2',
    body: 'Body 2',
    status: 'scheduled',
    publish_at: new Date(Date.now() - 60000).toISOString(), // 1 min ago
  });

  const futurePost = await store.upsert('posts', {
    slug: 'future-1',
    title: 'Future Post',
    body: 'Body 3',
    status: 'scheduled',
    publish_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
  });

  const result = await processScheduledPosts(store, { requireGitPublish: false });

  assert.equal(result.processed, 2);
  assert.equal(result.published.length, 2);
  assert.ok(result.published.includes(pastPost1.id));
  assert.ok(result.published.includes(pastPost2.id));

  // Verify statuses
  assert.equal((await store.get('posts', pastPost1.id)).status, 'published');
  assert.equal((await store.get('posts', pastPost2.id)).status, 'published');
  assert.equal((await store.get('posts', futurePost.id)).status, 'scheduled');
});

test('processScheduledPosts: respects custom now parameter', async () => {
  const store = new MemoryStore();

  const publishTime = new Date('2026-06-05T12:00:00Z');

  const post = await store.upsert('posts', {
    slug: 'test-custom-now',
    title: 'Custom Now Post',
    body: 'Test body',
    status: 'scheduled',
    publish_at: new Date('2026-06-05T11:00:00Z').toISOString(),
  });

  // Process with a custom "now" that is after publish_at
  const result = await processScheduledPosts(store, { now: publishTime, requireGitPublish: false });

  assert.equal(result.processed, 1);
  assert.equal(result.published.length, 1);
});

test('listScheduledPosts: returns sorted scheduled posts', async () => {
  const store = new MemoryStore();

  await store.upsert('posts', {
    slug: 'later',
    title: 'Later Post',
    body: 'Body',
    status: 'scheduled',
    publish_at: new Date('2026-06-10').toISOString(),
  });

  await store.upsert('posts', {
    slug: 'sooner',
    title: 'Sooner Post',
    body: 'Body',
    status: 'scheduled',
    publish_at: new Date('2026-06-05').toISOString(),
  });

  await store.upsert('posts', {
    slug: 'draft',
    title: 'Draft Post',
    body: 'Body',
    status: 'draft',
  });

  const scheduled = await listScheduledPosts(store);

  assert.equal(scheduled.length, 2);
  assert.equal(scheduled[0].slug, 'sooner');
  assert.equal(scheduled[1].slug, 'later');
});

test('schedulePost: rejects invalid publish_at', async () => {
  const store = new MemoryStore();

  const post = await store.upsert('posts', {
    slug: 'invalid-date',
    title: 'Invalid Date Post',
    body: 'Body',
    status: 'approved',
  });

  await assert.rejects(
    () => schedulePost(store, post.id, 'not-a-date'),
    /invalid_publish_at/
  );
});

test('schedulePost: rejects non-existent post', async () => {
  const store = new MemoryStore();

  await assert.rejects(
    () => schedulePost(store, 'nonexistent-id', new Date()),
    /not_found/
  );
});

test('full workflow: draft → pending_review → approved → scheduled → published', async () => {
  const store = new MemoryStore();

  // Step 1: Create draft
  const post = await store.upsert('posts', {
    slug: 'full-workflow-test',
    title: 'Full Workflow Test',
    body: 'Testing the complete publish workflow.',
    status: 'draft',
  });
  assert.equal(post.status, 'draft');

  // Step 2: Submit for review
  const pending = await transitionPost(store, post.id, 'pending_review');
  assert.equal(pending.status, 'pending_review');

  // Step 3: Approve
  const approved = await transitionPost(store, post.id, 'approved');
  assert.equal(approved.status, 'approved');

  // Step 4: Schedule (with past time for immediate publish)
  await store.upsert('posts', {
    ...approved,
    publish_at: new Date(Date.now() - 1000).toISOString(),
  });
  const scheduled = await transitionPost(store, post.id, 'scheduled');
  assert.equal(scheduled.status, 'scheduled');

  // Step 5: Auto-publish via scheduler
  const result = await processScheduledPosts(store, { requireGitPublish: false });
  assert.equal(result.published.length, 1);

  // Verify final state
  const final = await store.get('posts', post.id);
  assert.equal(final.status, 'published');
  assert.ok(final.published_at);
});

test('processScheduledPosts: calls gitPublish callback', async () => {
  const store = new MemoryStore();

  const post = await store.upsert('posts', {
    slug: 'git-callback-test',
    title: 'Git Callback Test',
    body: 'Testing gitPublish callback',
    status: 'scheduled',
    publish_at: new Date(Date.now() - 1000).toISOString(),
  });

  let gitPublishCalled = false;
  let gitPublishPost = null;

  const gitPublish = async (p) => {
    gitPublishCalled = true;
    gitPublishPost = p;
    return { ok: true, commit: 'abc123', repository: 'acme/website', branch: 'main', files: ['content/posts/git-callback-test.md', 'content/index.json', 'git-callback-test.html', 'sitemap.xml', 'public/git-callback-test.html', 'public/sitemap.xml'] };
  };

  const result = await processScheduledPosts(store, { gitPublish });

  assert.equal(result.published.length, 1);
  assert.ok(gitPublishCalled);
  assert.equal(gitPublishPost.slug, 'git-callback-test');
});

test('processScheduledPosts: fails closed when GitHub configuration is missing', async () => {
  const store = new MemoryStore();
  const post = await store.upsert('posts', {
    slug: 'missing-github-config',
    title: 'Missing GitHub Config',
    body: 'Body',
    status: 'scheduled',
    publish_at: new Date(Date.now() - 1000).toISOString(),
  });

  const result = await processScheduledPosts(store);

  assert.equal(result.processed, 1);
  assert.deepEqual(result.published, []);
  assert.equal(result.failed[0].id, post.id);
  assert.match(result.failed[0].error, /git_publish_required/);
  assert.equal((await store.get('posts', post.id)).status, 'scheduled');
});

test('processScheduledPosts: gitPublish=null cannot publish', async () => {
  const store = new MemoryStore();
  const post = await store.upsert('posts', {
    slug: 'null-git-publish',
    title: 'Null Git Publish',
    body: 'Body',
    status: 'scheduled',
    publish_at: new Date(Date.now() - 1000).toISOString(),
  });

  const result = await processScheduledPosts(store, { gitPublish: null });

  assert.equal(result.published.length, 0);
  assert.equal(result.failed.length, 1);
  assert.equal((await store.get('posts', post.id)).status, 'scheduled');
});

test('processScheduledPosts: GitHub API authentication failure leaves post retryable', async () => {
  const store = new MemoryStore();
  const post = await store.upsert('posts', {
    slug: 'auth-failure',
    title: 'Auth Failure',
    body: 'Body',
    status: 'scheduled',
    publish_at: new Date(Date.now() - 1000).toISOString(),
  });

  const result = await processScheduledPosts(store, {
    gitPublish: async () => ({ ok: false, error: 'github_api_error:401' }),
  });

  assert.deepEqual(result.published, []);
  assert.match(result.failed[0].error, /github_api_error:401|git_publish_failed/);
  assert.equal((await store.get('posts', post.id)).status, 'scheduled');
});

test('processScheduledPosts: GitHub API write failure leaves post retryable', async () => {
  const store = new MemoryStore();
  const post = await store.upsert('posts', {
    slug: 'write-failure',
    title: 'Write Failure',
    body: 'Body',
    status: 'scheduled',
    publish_at: new Date(Date.now() - 1000).toISOString(),
  });

  const result = await processScheduledPosts(store, {
    gitPublish: async () => ({ ok: false, error: 'github_api_error:422' }),
  });

  assert.equal(result.published.length, 0);
  assert.equal(result.failed.length, 1);
  assert.equal((await store.get('posts', post.id)).status, 'scheduled');
});

test('processScheduledPosts: renderer failure does not publish', async () => {
  const store = new MemoryStore();
  const post = await store.upsert('posts', {
    slug: 'renderer-failure',
    title: 'Renderer Failure',
    body: 'Body',
    status: 'scheduled',
    publish_at: new Date(Date.now() - 1000).toISOString(),
  });

  const result = await processScheduledPosts(store, {
    gitPublish: async () => { throw Object.assign(new Error('render_article_failed'), { code: 'render_article_failed' }); },
  });

  assert.deepEqual(result.published, []);
  assert.match(result.failed[0].error, /render_article_failed/);
  assert.equal((await store.get('posts', post.id)).status, 'scheduled');
});

test('processScheduledPosts: sitemap failure does not publish', async () => {
  const store = new MemoryStore();
  const post = await store.upsert('posts', {
    slug: 'sitemap-failure',
    title: 'Sitemap Failure',
    body: 'Body',
    status: 'scheduled',
    publish_at: new Date(Date.now() - 1000).toISOString(),
  });

  const result = await processScheduledPosts(store, {
    gitPublish: async () => ({ ok: false, error: 'sitemap_update_failed' }),
  });

  assert.deepEqual(result.published, []);
  assert.match(result.failed[0].error, /sitemap_update_failed|git_publish_failed/);
  assert.equal((await store.get('posts', post.id)).status, 'scheduled');
});

test('processScheduledPosts: missing live artifact info cannot reach published', async () => {
  const store = new MemoryStore();
  const post = await store.upsert('posts', {
    slug: 'no-live-artifact',
    title: 'No Live Artifact',
    body: 'Body',
    status: 'scheduled',
    publish_at: new Date(Date.now() - 1000).toISOString(),
  });

  const result = await processScheduledPosts(store, {
    gitPublish: async () => ({ ok: true, commit: 'abc', repository: 'acme/site', branch: 'main', files: ['content/posts/no-live-artifact.md'] }),
  });

  assert.deepEqual(result.published, []);
  assert.match(result.failed[0].error, /git_publish_missing_live_artifacts/);
  assert.equal((await store.get('posts', post.id)).status, 'scheduled');
});

test('processScheduledPosts: successful commit publishes with git metadata', async () => {
  const store = new MemoryStore();
  const post = await store.upsert('posts', {
    slug: 'successful-commit',
    title: 'Successful Commit',
    body: 'Body',
    status: 'scheduled',
    publish_at: new Date(Date.now() - 1000).toISOString(),
  });

  const result = await processScheduledPosts(store, {
    gitPublish: async () => ({
      ok: true,
      commit: 'commit-ok',
      repository: 'acme/site',
      branch: 'main',
      files: ['content/posts/successful-commit.md', 'content/index.json', 'successful-commit.html', 'sitemap.xml', 'public/successful-commit.html', 'public/sitemap.xml'],
    }),
  });

  assert.deepEqual(result.published, [post.id]);
  assert.equal(result.failed.length, 0);
  assert.equal((await store.get('posts', post.id)).status, 'published');
});

test('processScheduledPosts: retry after partial failure can publish later', async () => {
  const store = new MemoryStore();
  const post = await store.upsert('posts', {
    slug: 'partial-retry',
    title: 'Partial Retry',
    body: 'Body',
    status: 'scheduled',
    publish_at: new Date(Date.now() - 1000).toISOString(),
  });

  const first = await processScheduledPosts(store, {
    gitPublish: async () => ({ ok: false, error: 'github_api_error:500' }),
  });
  assert.equal(first.failed.length, 1);
  assert.equal((await store.get('posts', post.id)).status, 'scheduled');

  const second = await processScheduledPosts(store, {
    gitPublish: async () => ({
      ok: true,
      commit: 'retry-commit',
      repository: 'acme/site',
      branch: 'main',
      files: ['content/posts/partial-retry.md', 'content/index.json', 'partial-retry.html', 'sitemap.xml', 'public/partial-retry.html', 'public/sitemap.xml'],
    }),
  });
  assert.deepEqual(second.published, [post.id]);
});

test('processScheduledPosts: already-published artifact idempotent retry can publish once', async () => {
  const store = new MemoryStore();
  const post = await store.upsert('posts', {
    slug: 'idempotent-retry',
    title: 'Idempotent Retry',
    body: 'Body',
    status: 'scheduled',
    publish_at: new Date(Date.now() - 1000).toISOString(),
  });

  const result = await processScheduledPosts(store, {
    gitPublish: async () => ({
      ok: true,
      commit: 'current-head',
      repository: 'acme/site',
      branch: 'main',
      action: 'noop',
      idempotent: true,
      files: ['content/posts/idempotent-retry.md', 'content/index.json', 'idempotent-retry.html', 'sitemap.xml', 'public/idempotent-retry.html', 'public/sitemap.xml'],
    }),
  });

  assert.deepEqual(result.published, [post.id]);
  assert.equal((await store.get('posts', post.id)).status, 'published');
});
