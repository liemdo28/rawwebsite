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

  const result = await processScheduledPosts(store);

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

  const result = await processScheduledPosts(store);

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

  const result = await processScheduledPosts(store);

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
  const result = await processScheduledPosts(store, { now: publishTime });

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
  const result = await processScheduledPosts(store);
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
    return { ok: true, commit: 'abc123' };
  };

  const result = await processScheduledPosts(store, { gitPublish });

  assert.equal(result.published.length, 1);
  assert.ok(gitPublishCalled);
  assert.equal(gitPublishPost.slug, 'git-callback-test');
});
