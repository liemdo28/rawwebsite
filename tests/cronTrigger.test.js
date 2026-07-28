/**
 * tests/cronTrigger.test.js — Unit tests for the Cloudflare cron trigger handler.
 *
 * Verifies that functions/_scheduled.js:
 *   - Exports a `scheduled` function (the Cloudflare Workers entry point).
 *   - Calls processScheduledPosts with the correct store and gitPublish option.
 *   - Records an audit log entry on success (scheduler.run).
 *   - Records an audit log entry on failure (scheduler.error).
 *   - Does NOT throw when processScheduledPosts returns (errors are handled).
 *
 * The tests call the module's exported `scheduled` function directly,
 * passing a mock ScheduledEvent and a mock Env. The store is injected via
 * env._store so the test can pre-populate it with data.
 * No real network calls.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../lib/store.js';
import { transitionPost } from '../lib/posts.js';

// We import the module as a dynamic import so that top-level `await` in the
// module doesn't block other test files.
const scheduledModule = await import('../functions/_scheduled.js');

test('_scheduled exports a scheduled function', () => {
  assert.equal(typeof scheduledModule.scheduled, 'function');
});

test('scheduled: fails closed without GitHub publisher and records audit entry', async () => {
  const store = new MemoryStore();

  // Create a post that is already due for publishing
  const post = await store.upsert('posts', {
    slug: 'cron-test-post',
    title: 'Cron Test Post',
    body: 'Body for cron test.',
    status: 'scheduled',
    publish_at: new Date(Date.now() - 60000).toISOString(), // 1 minute ago
  });

  // Build a minimal mock env — inject the store via env._store so the
  // scheduled function uses our pre-populated instance.
  const env = {
    _store: store,
    STORE_BACKEND: 'memory',
    RAWWEBSITE_ADMIN_SECRET: 'dev-admin-secret',
    GITHUB_TOKEN: undefined,
    GITHUB_OWNER: undefined,
    GITHUB_REPO: undefined,
    RAWWEBSITE_KV: undefined,
  };

  const mockEvent = {
    cron: '*/5 * * * *',
    scheduledTime: Date.now(),
  };

  const ctx = { waitUntil: () => {} };

  await scheduledModule.scheduled(mockEvent, env, ctx);

  // Verify post was restored to a retryable state instead of falsely published.
  const updated = await store.get('posts', post.id);
  assert.equal(updated.status, 'scheduled');

  // Verify audit log entry was recorded
  const auditRows = await store.list('audit_log');
  const schedulerRun = auditRows.find(
    r => r.action === 'scheduler.run' && r.target_type === 'system'
  );
  assert.ok(schedulerRun, 'expected scheduler.run audit entry');
  assert.equal(schedulerRun.actor, 'cron');
  assert.ok(schedulerRun.meta.processed >= 1);
  assert.equal(schedulerRun.meta.published, 0);
  assert.ok(schedulerRun.meta.failed >= 1);
});

test('scheduled: records audit entry even when no posts are due', async () => {
  const store = new MemoryStore();

  // Create a post scheduled for the future (not due yet)
  await store.upsert('posts', {
    slug: 'future-cron-post',
    title: 'Future Cron Post',
    body: 'Body.',
    status: 'scheduled',
    publish_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
  });

  const env = {
    _store: store,
    STORE_BACKEND: 'memory',
    RAWWEBSITE_ADMIN_SECRET: 'dev-admin-secret',
    GITHUB_TOKEN: undefined,
    GITHUB_OWNER: undefined,
    GITHUB_REPO: undefined,
  };

  const mockEvent = {
    cron: '*/5 * * * *',
    scheduledTime: Date.now(),
  };

  const ctx = { waitUntil: () => {} };

  await scheduledModule.scheduled(mockEvent, env, ctx);

  const auditRows = await store.list('audit_log');
  const schedulerRun = auditRows.find(r => r.action === 'scheduler.run');
  assert.ok(schedulerRun, 'expected scheduler.run audit entry even with 0 processed');
  assert.equal(schedulerRun.meta.processed, 0);
  assert.equal(schedulerRun.meta.published, 0);
});

test('scheduled: calls injected gitPublish and publishes only after verified artifact', async () => {
  const store = new MemoryStore();

  const post = await store.upsert('posts', {
    slug: 'git-cron-test',
    title: 'Git Cron Test',
    body: 'Body.',
    status: 'scheduled',
    publish_at: new Date(Date.now() - 60000).toISOString(),
  });

  const env = {
    _store: store,
    STORE_BACKEND: 'memory',
    RAWWEBSITE_ADMIN_SECRET: 'dev-admin-secret',
    GITHUB_TOKEN: 'ghp_fake',
    GITHUB_OWNER: 'acme',
    GITHUB_REPO: 'website',
    GITHUB_BRANCH: 'main',
    _gitPublish: async () => ({
      ok: true,
      commit: 'cron-commit',
      repository: 'acme/website',
      branch: 'main',
      files: ['content/posts/git-cron-test.md', 'content/index.json', 'public/git-cron-test.html', 'public/sitemap.xml'],
    }),
  };

  const mockEvent = {
    cron: '*/5 * * * *',
    scheduledTime: Date.now(),
  };

  const ctx = { waitUntil: () => {} };

  await scheduledModule.scheduled(mockEvent, env, ctx);

  const updated = await store.get('posts', post.id);
  assert.equal(updated.status, 'published');
});

test('scheduled: full workflow — draft → scheduled → cron auto-publishes', async () => {
  const store = new MemoryStore();

  // Step 1: Create a draft post
  const post = await store.upsert('posts', {
    slug: 'full-cron-workflow',
    title: 'Full Cron Workflow',
    body: 'Testing the complete workflow.',
    status: 'draft',
  });

  // Step 2: Move through the workflow to scheduled
  await transitionPost(store, post.id, 'pending_review');
  await transitionPost(store, post.id, 'approved');
  await store.upsert('posts', {
    ...(await store.get('posts', post.id)),
    publish_at: new Date(Date.now() - 1000).toISOString(),
  });
  await transitionPost(store, post.id, 'scheduled');

  const env = {
    _store: store,
    STORE_BACKEND: 'memory',
    RAWWEBSITE_ADMIN_SECRET: 'dev-admin-secret',
    _gitPublish: async () => ({
      ok: true,
      commit: 'workflow-commit',
      repository: 'acme/website',
      branch: 'main',
      files: ['content/posts/full-cron-workflow.md', 'content/index.json', 'public/full-cron-workflow.html', 'public/sitemap.xml'],
    }),
  };

  const mockEvent = {
    cron: '*/5 * * * *',
    scheduledTime: Date.now(),
  };

  const ctx = { waitUntil: () => {} };

  await scheduledModule.scheduled(mockEvent, env, ctx);

  const updated = await store.get('posts', post.id);
  assert.equal(updated.status, 'published');
  assert.ok(updated.published_at, 'published_at should be set');

  // Verify audit log has the auto_publish entry
  const auditRows = await store.list('audit_log');
  const autoPublish = auditRows.find(r => r.action === 'post.auto_publish');
  assert.ok(autoPublish, 'expected post.auto_publish audit entry');
  assert.equal(autoPublish.target_id, post.id);
  assert.equal(autoPublish.actor, 'scheduler');
});
