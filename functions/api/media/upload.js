/**
 * functions/api/media/upload.js — Media upload endpoint with R2 support.
 *
 * POST /api/media/upload
 *   Content-Type: multipart/form-data
 *   Field "file": the binary
 *   Field "alt" : alt text (required for accessibility)
 *   Optional fields: "source" (free-text source label)
 *   Admin auth required.
 *
 * Behavior:
 *   - If R2 bucket (MEDIA_BUCKET) is available, uploads to R2.
 *   - Otherwise, falls back to base64 data URL storage.
 *   - Validates MIME type (image/jpeg, png, webp, gif, svg+xml).
 *   - Validates size (5 MB max).
 *   - Stores metadata in JSON store.
 *
 * GET /api/media/upload
 *   Lists media rows (most recent first).
 *
 * DELETE /api/media/upload?id=...
 *   Deletes a media item (and R2 object if applicable).
 */

import { loadConfig } from '../../../lib/config.js';
import { createStore } from '../../../lib/store.js';
import { record } from '../../../lib/auditLog.js';
import {
  ok, err, verifyAdmin, withCors, handleOptions,
} from '../../../lib/auditLog.js';
import {
  uploadToR2, deleteFromR2, replaceInR2, isR2Available,
  ALLOWED_MIMES, MAX_BYTES,
} from '../../../lib/mediaR2.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);
  const config = loadConfig(env);
  const store = createStore(env, { dataDir: config.dataDir });

  // GET: List media
  if (request.method === 'GET') {
    const rows = await store.list('media');
    rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return withCors(ok({ media: rows.slice(0, 100), total: rows.length }));
  }

  // DELETE: Remove media
  if (request.method === 'DELETE') {
    const actor = verifyAdmin(request, config.admin.secret);
    if (!actor) return withCors(err('unauthorized', 'admin Bearer token required', 401));

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return withCors(err('id_required', 'id query param required', 400));

    const existing = await store.get('media', id);
    if (!existing) return withCors(err('not_found', 'media not found', 404));

    // Delete from R2 if applicable
    if (existing.r2_key && isR2Available(env.MEDIA_BUCKET)) {
      await deleteFromR2(env.MEDIA_BUCKET, existing.r2_key);
    }

    await store.remove('media', id);
    await record(store, {
      actor, action: 'media.delete', target_type: 'media', target_id: id,
      meta: { r2_key: existing.r2_key },
    });

    return withCors(ok({ deleted: id }));
  }

  // POST: Upload media
  if (request.method !== 'POST') {
    return withCors(err('method_not_allowed', 'GET, POST, or DELETE only', 405));
  }

  const actor = verifyAdmin(request, config.admin.secret);
  if (!actor) return withCors(err('unauthorized', 'admin Bearer token required', 401));

  const ct = request.headers.get('content-type') || '';
  if (!ct.toLowerCase().includes('multipart/form-data')) {
    return withCors(err('expected_multipart', 'Content-Type must be multipart/form-data', 400));
  }

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return withCors(err('cannot_parse_form', e.message, 400));
  }

  const file = form.get('file');
  const alt = String(form.get('alt') || '').trim();
  const source = String(form.get('source') || 'manual');
  const replaceId = form.get('replace_id'); // Optional: replace existing media

  if (!file || typeof file === 'string') {
    return withCors(err('file_required', '"file" field is required', 400));
  }
  if (!alt) {
    return withCors(err('alt_required', '"alt" is required for accessibility', 400));
  }
  if (file.size > MAX_BYTES) {
    return withCors(err('file_too_large', `file exceeds ${MAX_BYTES} bytes`, 413));
  }
  if (!ALLOWED_MIMES.has(file.type)) {
    return withCors(err('mime_not_allowed', `MIME type ${file.type} is not allowed`, 415, {
      allowed: [...ALLOWED_MIMES],
    }));
  }

  const buf = new Uint8Array(await file.arrayBuffer());

  // Handle replacement if requested
  let oldR2Key = null;
  if (replaceId) {
    const existing = await store.get('media', replaceId);
    if (existing && existing.r2_key) {
      oldR2Key = existing.r2_key;
    }
  }

  // Try R2 first if available
  if (isR2Available(env.MEDIA_BUCKET)) {
    let r2Result;
    if (oldR2Key) {
      r2Result = await replaceInR2(env.MEDIA_BUCKET, oldR2Key, {
        data: buf,
        mime: file.type,
        slug: file.name || 'upload',
        alt,
      });
    } else {
      r2Result = await uploadToR2(env.MEDIA_BUCKET, {
        data: buf,
        mime: file.type,
        slug: file.name || 'upload',
        alt,
      });
    }

    if (!r2Result.ok) {
      return withCors(err('r2_upload_failed', r2Result.error, 500));
    }

    const row = {
      id: replaceId || ((typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'media-' + Date.now()),
      url: r2Result.url,
      r2_key: r2Result.key,
      alt,
      source,
      mime: file.type,
      size: file.size,
      width: null,
      height: null,
      storage: 'r2',
      created_by: actor,
    };

    const saved = await store.upsert('media', row);
    await record(store, {
      actor,
      action: replaceId ? 'media.replace' : 'media.upload',
      target_type: 'media',
      target_id: saved.id,
      meta: { 
        mime: file.type, 
        size: file.size, 
        source,
        storage: 'r2',
        r2_key: r2Result.key,
        replaced_key: r2Result.deletedKey,
      },
    });

    return withCors(ok({ media: saved, storage: 'r2' }), 201);
  }

  // Fallback to base64 data URL storage
  let b64 = '';
  for (let i = 0; i < buf.length; i += 0x8000) {
    b64 += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  }
  const dataUrl = `data:${file.type};base64,${btoa(b64)}`;

  const row = {
    id: replaceId || ((typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'media-' + Date.now()),
    url: dataUrl,
    alt,
    source,
    mime: file.type,
    size: file.size,
    width: null,
    height: null,
    storage: 'dataurl',
    created_by: actor,
  };

  // If replacing, remove old entry
  if (replaceId) {
    await store.remove('media', replaceId);
  }

  const saved = await store.upsert('media', row);
  await record(store, {
    actor,
    action: replaceId ? 'media.replace' : 'media.upload',
    target_type: 'media',
    target_id: saved.id,
    meta: { 
      mime: file.type, 
      size: file.size, 
      source,
      storage: 'dataurl',
    },
  });

  return withCors(ok({ media: saved, storage: 'dataurl' }), 201);
}
