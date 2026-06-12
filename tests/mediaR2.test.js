/**
 * tests/mediaR2.test.js — Unit tests for Cloudflare R2 media storage.
 *
 * Verifies that lib/mediaR2.js:
 *   - Rejects MIME types that are not on the whitelist.
 *   - Rejects files larger than the 5 MB cap.
 *   - Generates a stable-shape key under the `media/` prefix.
 *   - Uploads the bytes to a mock R2 bucket and returns the key/url.
 *   - Deletes by key and reports ok when the bucket accepts the delete.
 *   - Replaces (upload new → delete old) and reports the deleted key.
 *   - Lists objects via the bucket.list() abstraction.
 *   - Correctly reports availability via isR2Available().
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  uploadToR2,
  getFromR2,
  deleteFromR2,
  replaceInR2,
  listFromR2,
  isR2Available,
  generateMediaKey,
  ALLOWED_MIMES,
  MAX_BYTES,
} from '../lib/mediaR2.js';

/**
 * Build a mock R2 bucket that records every operation. The real R2 binding
 * in Cloudflare is a `R2Bucket` with `put`, `get`, `delete`, `list` methods;
 * we just need to exercise the code paths in lib/mediaR2.js.
 */
function makeMockBucket(overrides = {}) {
  const calls = [];
  const store = new Map();
  return {
    calls,
    bucket: {
      async put(key, data, opts) {
        calls.push({ op: 'put', key, size: data.byteLength || data.length, opts });
        if (overrides.put && (await overrides.put(key, data, opts)) === false) {
          throw new Error('mock_put_failed');
        }
        store.set(key, { data, opts });
        return { key, etag: 'etag-' + store.size };
      },
      async get(key) {
        calls.push({ op: 'get', key });
        if (overrides.get) return await overrides.get(key);
        const o = store.get(key);
        if (!o) return null;
        return {
          key,
          size: o.data.byteLength || o.data.length,
          etag: 'etag-' + key,
          uploaded: new Date(),
          httpMetadata: o.opts?.httpMetadata,
          customMetadata: o.opts?.customMetadata,
          async arrayBuffer() { return o.data.buffer || o.data; },
          async text() { return new TextDecoder().decode(o.data); },
        };
      },
      async delete(key) {
        calls.push({ op: 'delete', key });
        if (overrides.delete) return await overrides.delete(key);
        store.delete(key);
      },
      async list(opts) {
        calls.push({ op: 'list', opts });
        if (overrides.list) return await overrides.list(opts);
        const prefix = opts?.prefix || '';
        const limit = opts?.limit || 100;
        const objects = [];
        for (const [k, v] of store.entries()) {
          if (k.startsWith(prefix)) {
            objects.push({ key: k, size: v.data.byteLength || v.data.length, etag: 'etag-' + k, uploaded: new Date() });
          }
        }
        return { objects: objects.slice(0, limit), truncated: objects.length > limit, cursor: undefined };
      },
    },
  };
}

test('isR2Available: true when bucket has put()', () => {
  const { bucket } = makeMockBucket();
  assert.equal(isR2Available(bucket), true);
});

test('isR2Available: false when bucket is missing or invalid', () => {
  // isR2Available returns a falsy value (null or false) for invalid inputs.
  // Use ok(!...) for falsy checks, not strictEqual against false.
  assert.ok(!isR2Available(null));
  assert.ok(!isR2Available(undefined));
  assert.ok(!isR2Available({}));
  assert.ok(!isR2Available('not-a-bucket'));
});

test('ALLOWED_MIMES contains the canonical image types', () => {
  for (const t of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']) {
    assert.ok(ALLOWED_MIMES.has(t), `missing ${t}`);
  }
});

test('MAX_BYTES is exactly 5 MB', () => {
  assert.equal(MAX_BYTES, 5 * 1024 * 1024);
});

test('generateMediaKey: produces media/ prefix and correct extension', () => {
  const key = generateMediaKey('sushi-platter', 'image/jpeg');
  assert.ok(key.startsWith('media/'), `expected media/ prefix, got: ${key}`);
  assert.ok(key.endsWith('.jpg'), `expected .jpg extension, got: ${key}`);
  assert.ok(key.includes('sushi-platter'), `expected slug in key, got: ${key}`);
});

test('generateMediaKey: handles png extension', () => {
  const key = generateMediaKey('nigiri-photo', 'image/png');
  assert.ok(key.endsWith('.png'), `expected .png, got: ${key}`);
});

test('generateMediaKey: falls back to .bin for unknown mime', () => {
  const key = generateMediaKey('doc', 'application/pdf');
  assert.ok(key.endsWith('.bin'), `expected .bin, got: ${key}`);
});

test('uploadToR2: rejects disallowed MIME type', async () => {
  const { bucket } = makeMockBucket();
  const buf = new Uint8Array([0xFF, 0xD8]);
  const r = await uploadToR2(bucket, { data: buf, mime: 'application/pdf', slug: 'test' });
  assert.equal(r.ok, false);
  assert.match(r.error, /mime_not_allowed/);
});

test('uploadToR2: rejects file larger than 5 MB', async () => {
  const { bucket } = makeMockBucket();
  //6 MB buffer
  const buf = new Uint8Array(6 * 1024 * 1024);
  const r = await uploadToR2(bucket, { data: buf, mime: 'image/jpeg', slug: 'test' });
  assert.equal(r.ok, false);
  assert.match(r.error, /file_too_large/);
});

test('uploadToR2: accepts valid JPEG and returns key + url', async () => {
  const { bucket, calls } = makeMockBucket();
  const buf = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]);
  const r = await uploadToR2(bucket, { data: buf, mime: 'image/jpeg', slug: 'sushi-platter', alt: 'Fresh sushi' });
  assert.equal(r.ok, true);
  assert.ok(r.key, 'key should be set');
  assert.ok(r.url, 'url should be set');
  assert.equal(r.mime, 'image/jpeg');
  assert.equal(r.size, 8);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].op, 'put');
  assert.ok(calls[0].key.startsWith('media/'));
  assert.equal(calls[0].opts.httpMetadata.contentType, 'image/jpeg');
  assert.equal(calls[0].opts.customMetadata.alt, 'Fresh sushi');
});

test('uploadToR2: accepts WebP, PNG, GIF, SVG', async () => {
  const types = [
    ['image/webp', '.webp'],
    ['image/png', '.png'],
    ['image/gif', '.gif'],
    ['image/svg+xml', '.svg'],
  ];
  for (const [mime, ext] of types) {
    const { bucket } = makeMockBucket();
    const buf = new Uint8Array([0x00, 0x00]);
    const r = await uploadToR2(bucket, { data: buf, mime, slug: 'test-' + mime });
    assert.equal(r.ok, true, `expected ok for ${mime}, got: ${r.error}`);
    assert.ok(r.key.endsWith(ext), `expected ${ext}, got: ${r.key}`);
  }
});

test('uploadToR2: calls bucket.put with httpMetadata and customMetadata', async () => {
  const { bucket, calls } = makeMockBucket();
  const buf = new Uint8Array([0x89, 0x50, 0x4E]);
  await uploadToR2(bucket, { data: buf, mime: 'image/png', slug: 'nigiri', alt: 'Nigiri plate' });
  assert.equal(calls[0].opts.httpMetadata.contentType, 'image/png');
  assert.equal(calls[0].opts.customMetadata.alt, 'Nigiri plate');
  assert.ok(calls[0].opts.customMetadata.uploadedAt);
});

test('getFromR2: returns ok:false when not found', async () => {
  const { bucket } = makeMockBucket();
  const r = await getFromR2(bucket, 'media/nonexistent.jpg');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not_found');
});

test('getFromR2: returns object + metadata when found', async () => {
  const { bucket } = makeMockBucket();
  const buf = new Uint8Array([0xFF, 0xD8]);
  await bucket.put('media/test.jpg', buf, {
    httpMetadata: { contentType: 'image/jpeg' },
    customMetadata: { alt: 'Test alt' },
  });
  const r = await getFromR2(bucket, 'media/test.jpg');
  assert.equal(r.ok, true);
  assert.equal(r.metadata.key, 'media/test.jpg');
  assert.equal(r.metadata.size, 2);
  assert.equal(r.metadata.httpMetadata.contentType, 'image/jpeg');
  assert.equal(r.metadata.customMetadata.alt, 'Test alt');
});

test('deleteFromR2: returns ok:true and calls bucket.delete', async () => {
  const { bucket, calls } = makeMockBucket();
  await bucket.put('media/old.jpg', new Uint8Array([0xFF]));
  const r = await deleteFromR2(bucket, 'media/old.jpg');
  assert.equal(r.ok, true);
  assert.equal(calls.find(c => c.op === 'delete' && c.key === 'media/old.jpg')?.op, 'delete');
});

test('deleteFromR2: returns ok:true even when key not found (idempotent)', async () => {
  const { bucket } = makeMockBucket();
  const r = await deleteFromR2(bucket, 'media/never-existed.jpg');
  assert.equal(r.ok, true);
});

test('replaceInR2: uploads new file then deletes old, returns both keys', async () => {
  const { bucket, calls } = makeMockBucket();
  await bucket.put('media/old-photo.jpg', new Uint8Array([0x01]));
  const newBuf = new Uint8Array([0x02, 0x03, 0x04]);
  const r = await replaceInR2(bucket, 'media/old-photo.jpg', {
    data: newBuf,
    mime: 'image/png',
    slug: 'new-photo',
    alt: 'New photo',
  });
  assert.equal(r.ok, true);
  assert.ok(r.key.startsWith('media/'));
  assert.ok(r.key.endsWith('.png'));
  assert.equal(r.deletedKey, 'media/old-photo.jpg');
  // New file should be in store
  const getR = await getFromR2(bucket, r.key);
  assert.equal(getR.ok, true);
  // Old file should be gone
  const oldR = await getFromR2(bucket, 'media/old-photo.jpg');
  assert.equal(oldR.ok, false);
});

test('replaceInR2: uploads new file even when old key is null', async () => {
  const { bucket } = makeMockBucket();
  const r = await replaceInR2(bucket, null, {
    data: new Uint8Array([0x05]),
    mime: 'image/gif',
    slug: 'brand-new',
    alt: 'New',
  });
  assert.equal(r.ok, true);
  assert.ok(r.key.includes('brand-new'));
  assert.equal(r.deletedKey, null);
});

test('listFromR2: returns objects with prefix filter', async () => {
  const { bucket } = makeMockBucket();
  await bucket.put('media/a.jpg', new Uint8Array([0x01]));
  await bucket.put('media/b.png', new Uint8Array([0x02]));
  await bucket.put('other/c.jpg', new Uint8Array([0x03]));
  const r = await listFromR2(bucket, { prefix: 'media/' });
  assert.equal(r.ok, true);
  assert.equal(r.objects.length, 2);
  assert.ok(r.objects.every(o => o.key.startsWith('media/')));
});

test('listFromR2: respects limit', async () => {
  const { bucket } = makeMockBucket();
  for (let i = 0; i < 5; i++) {
    await bucket.put(`media/file${i}.jpg`, new Uint8Array([i]));
  }
  const r = await listFromR2(bucket, { prefix: 'media/', limit: 3 });
  assert.equal(r.objects.length, 3);
});
