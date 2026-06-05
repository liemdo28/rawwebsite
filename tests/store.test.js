/**
 * tests/store.test.js — Unit tests for the store layer.
 * Run with: npm test (uses Node's built-in test runner).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const { MemoryStore, FileStore, createStore } = await import('../lib/store.js');

test('MemoryStore: list, get, upsert, remove', async () => {
  const s = new MemoryStore();
  assert.equal((await s.list('posts')).length, 0);
  const row = await s.upsert('posts', { slug: 'a', title: 'A', body: '...' });
  assert.ok(row.id);
  assert.equal((await s.list('posts')).length, 1);
  const got = await s.get('posts', row.id);
  assert.equal(got.slug, 'a');
  await s.upsert('posts', { id: row.id, title: 'A2' });
  assert.equal((await s.list('posts')).length, 1);
  const got2 = await s.get('posts', row.id);
  assert.equal(got2.title, 'A2');
  // untouched fields preserved
  assert.equal(got2.slug, 'a');
  const removed = await s.remove('posts', row.id);
  assert.equal(removed, true);
  assert.equal((await s.list('posts')).length, 0);
});

test('MemoryStore: unknown table throws', async () => {
  const s = new MemoryStore();
  await assert.rejects(() => s.list('bogus'), /Unknown table/);
});

test('FileStore: persists across instances', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rws-'));
  try {
    const s1 = new FileStore(dir);
    await s1._ensure();
    const row = await s1.upsert('posts', { slug: 'persist', title: 'P' });
    assert.ok(row.id);

    // New instance reads the same file
    const s2 = new FileStore(dir);
    await s2._ensure();
    const got = await s2.get('posts', row.id);
    assert.equal(got.slug, 'persist');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createStore: picks FileStore when dataDir is provided', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rws-'));
  try {
    const s = createStore({}, { dataDir: dir });
    assert.ok(s instanceof FileStore);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createStore: falls back to MemoryStore in Workers-like env', () => {
  const s = createStore({});
  assert.ok(s instanceof MemoryStore);
});
