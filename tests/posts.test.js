/**
 * tests/posts.test.js — Unit tests for post validation + state machine.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../lib/store.js';
const { validatePost, transitionPost, POST_STATUSES } = await import('../lib/posts.js');

test('validatePost: rejects bad slug', () => {
  const r = validatePost({ title: 'Hello world', slug: 'A B C!', body: 'x' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('slug_invalid'));
});

test('validatePost: rejects short title', () => {
  const r = validatePost({ title: 'Hi', slug: 'good-slug', body: 'x' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('title_required_min_3'));
});

test('validatePost: rejects invalid status', () => {
  const r = validatePost({
    title: 'Hello world', slug: 'good-slug', body: 'x', status: 'weird-status',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('status_invalid'));
});

test('validatePost: rejects invalid location', () => {
  const r = validatePost({
    title: 'Hello world', slug: 'good-slug', body: 'x', location: 'san-francisco',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('location_invalid'));
});

test('validatePost: accepts well-formed post', () => {
  const r = validatePost({
    title: 'Hello world', slug: 'good-slug', body: 'This is the body of the post.',
    location: 'raw_stockton', cta_url: 'https://example.com/order',
  });
  assert.equal(r.ok, true);
});

test('transitionPost: enforces allowed transitions', async () => {
  const s = new MemoryStore();
  const row = await s.upsert('posts', { slug: 'a', title: 'A', body: '...', status: 'draft' });
  // draft → pending_review (allowed)
  const r1 = await transitionPost(s, row.id, 'pending_review', { actor: 'test' });
  assert.equal(r1.status, 'pending_review');
  // pending_review → published (NOT allowed)
  await assert.rejects(
    () => transitionPost(s, row.id, 'published', { actor: 'test' }),
    /invalid_transition/
  );
  // pending_review → approved (allowed)
  const r3 = await transitionPost(s, row.id, 'approved', { actor: 'test' });
  assert.equal(r3.status, 'approved');
  // approved → publishing (allowed)
  const r4 = await transitionPost(s, row.id, 'publishing', { actor: 'test' });
  assert.equal(r4.status, 'publishing');
  // publishing → published (allowed)
  const r5 = await transitionPost(s, row.id, 'published', { actor: 'test' });
  assert.equal(r5.status, 'published');
  assert.ok(r5.published_at, 'published_at should be set');
});

test('transitionPost: rejects unknown post', async () => {
  const s = new MemoryStore();
  await assert.rejects(
    () => transitionPost(s, 'nonexistent', 'approved'),
    /not_found/
  );
});

test('POST_STATUSES: contains all expected states', () => {
  for (const s of ['draft', 'pending_review', 'approved', 'scheduled',
                   'publishing', 'published', 'rejected', 'failed']) {
    assert.ok(POST_STATUSES.includes(s));
  }
});
