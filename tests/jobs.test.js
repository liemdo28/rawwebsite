/**
 * tests/jobs.test.js — Unit tests for the job queue and processor.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../lib/store.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICY_PATH = join(__dirname, '..', 'config', 'content_policy.json');

const { enqueue, processNext, JOB_COMMANDS } = await import('../lib/jobs.js');

test('JOB_COMMANDS: contains the canonical set', () => {
  for (const c of [
    'content.post.create', 'content.post.update', 'content.post.approve',
    'content.post.reject', 'content.post.schedule', 'content.post.publish',
    'media.upload', 'menu.item.create', 'menu.item.update', 'menu.item.toggle',
    'site.sync',
  ]) {
    assert.ok(JOB_COMMANDS.includes(c));
  }
});

test('enqueue: rejects unknown command', async () => {
  const s = new MemoryStore();
  await assert.rejects(
    () => enqueue(s, { command: 'unknown.cmd' }),
    /unknown_command/
  );
});

test('processNext: enqueue + process content.post.create succeeds for clean post', async () => {
  const s = new MemoryStore();
  await enqueue(s, {
    command: 'content.post.create',
    payload: {
      title: 'Best Sushi in Stockton Tonight',
      slug: 'best-sushi-stockton-test',
      body: 'Looking for the best sushi in Stockton tonight? Visit us. Order online. Call us.',
      excerpt: 'A test post',
      primary_keyword: 'sushi in Stockton',
      cta: 'Order now',
      cta_url: 'https://example.com/order',
      location: 'raw_stockton',
    },
  });
  const processed = await processNext(s, { policyPath: POLICY_PATH });
  assert.equal(processed.status, 'succeeded');
  assert.ok(processed.result);
  assert.equal(processed.result.status, 'draft');
  assert.ok(processed.result.score >= 60, 'expected score >= 60, got ' + processed.result.score);
});

test('processNext: validation failure produces failed job', async () => {
  const s = new MemoryStore();
  await enqueue(s, { command: 'content.post.create', payload: { title: 'x' } });
  const processed = await processNext(s, { policyPath: POLICY_PATH });
  assert.equal(processed.status, 'failed');
  assert.ok(processed.error && processed.error.includes('validation_failed'));
});

test('processNext: site.sync counts and updates last_sync_at', async () => {
  const s = new MemoryStore();
  await s.upsert('posts', { title: 't', slug: 's', body: 'b', status: 'draft' });
  await enqueue(s, { command: 'site.sync' });
  const processed = await processNext(s, {});
  assert.equal(processed.status, 'succeeded');
  assert.equal(processed.result.counts.posts, 1);
  const state = await s.getState();
  assert.ok(state.last_sync_at);
});

test('processNext: media.upload records the asset', async () => {
  const s = new MemoryStore();
  await enqueue(s, {
    command: 'media.upload',
    payload: { url: 'data:image/png;base64,xxx', alt: 'sushi platter', source: 'test' },
  });
  const processed = await processNext(s, {});
  assert.equal(processed.status, 'succeeded');
  assert.equal(processed.result.alt, 'sushi platter');
});

test('processNext: menu.item.create + menu.item.toggle', async () => {
  const s = new MemoryStore();
  await enqueue(s, { command: 'menu.item.create', payload: { name: 'Edamame', location: 'raw_stockton', price: 6.5 } });
  const p1 = await processNext(s, {});
  assert.equal(p1.status, 'succeeded');
  assert.ok(p1.result.id);
  const itemId = p1.result.id;

  await enqueue(s, { command: 'menu.item.toggle', payload: { id: itemId, active: false } });
  const p2 = await processNext(s, {});
  assert.equal(p2.status, 'succeeded');
  assert.equal(p2.result.active, false);
});
