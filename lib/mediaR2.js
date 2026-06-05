/**
 * lib/mediaR2.js — Cloudflare R2 media storage.
 *
 * Replaces base64 data URL storage with R2 object storage.
 * Maintains MIME whitelist and 5 MB cap from original implementation.
 *
 * Required env binding:
 *   - MEDIA_BUCKET — R2 bucket binding (configure in wrangler.toml)
 */

/**
 * Allowed MIME types for upload.
 */
export const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

/**
 * Maximum file size in bytes (5 MB).
 */
export const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Generate a unique key for R2 storage.
 *
 * @param {string} slug - Optional slug/filename hint
 * @param {string} mime - MIME type for extension
 */
export function generateMediaKey(slug, mime) {
  const ext = mimeToExtension(mime);
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const safeName = slug
    ? slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 50)
    : 'media';
  return `media/${safeName}-${timestamp}-${random}${ext}`;
}

/**
 * Convert MIME type to file extension.
 */
function mimeToExtension(mime) {
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
  };
  return map[mime] || '.bin';
}

/**
 * Upload a file to R2.
 *
 * @param {R2Bucket} bucket - The R2 bucket binding
 * @param {object} options
 * @param {ArrayBuffer|Uint8Array} options.data - File data
 * @param {string} options.mime - MIME type
 * @param {string} [options.slug] - Optional name hint
 * @param {string} [options.alt] - Alt text (stored in metadata)
 * @returns {Promise<{ ok: boolean, key?: string, url?: string, error?: string }>}
 */
export async function uploadToR2(bucket, options) {
  const { data, mime, slug, alt } = options;

  // Validate MIME type
  if (!ALLOWED_MIMES.has(mime)) {
    return { ok: false, error: `mime_not_allowed: ${mime}` };
  }

  // Validate size
  const size = data.byteLength || data.length;
  if (size > MAX_BYTES) {
    return { ok: false, error: `file_too_large: ${size} > ${MAX_BYTES}` };
  }

  const key = generateMediaKey(slug, mime);

  try {
    await bucket.put(key, data, {
      httpMetadata: {
        contentType: mime,
      },
      customMetadata: {
        alt: alt || '',
        uploadedAt: new Date().toISOString(),
      },
    });

    // R2 public URL pattern (requires public access enabled on bucket)
    // For custom domain: https://media.rawsushibar.com/{key}
    // For R2.dev URL: https://{account}.r2.dev/{bucket}/{key}
    // For Pages Functions, use the signed URL approach or proxy
    const url = `/api/media/${key}`;

    return { ok: true, key, url, size, mime };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Get a file from R2.
 *
 * @param {R2Bucket} bucket
 * @param {string} key
 * @returns {Promise<{ ok: boolean, data?: R2ObjectBody, metadata?: object, error?: string }>}
 */
export async function getFromR2(bucket, key) {
  try {
    const object = await bucket.get(key);
    if (!object) {
      return { ok: false, error: 'not_found' };
    }

    return {
      ok: true,
      data: object,
      metadata: {
        key,
        size: object.size,
        etag: object.etag,
        uploaded: object.uploaded,
        httpMetadata: object.httpMetadata,
        customMetadata: object.customMetadata,
      },
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Delete a file from R2.
 *
 * @param {R2Bucket} bucket
 * @param {string} key
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function deleteFromR2(bucket, key) {
  try {
    await bucket.delete(key);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Replace a file in R2 (delete old, upload new).
 *
 * @param {R2Bucket} bucket
 * @param {string} oldKey - Key of file to delete
 * @param {object} newFile - New file options (same as uploadToR2)
 * @returns {Promise<{ ok: boolean, key?: string, url?: string, deletedKey?: string, error?: string }>}
 */
export async function replaceInR2(bucket, oldKey, newFile) {
  // Upload new file first
  const uploadResult = await uploadToR2(bucket, newFile);
  if (!uploadResult.ok) {
    return uploadResult;
  }

  // Delete old file (best effort)
  if (oldKey) {
    try {
      await bucket.delete(oldKey);
    } catch { /* ignore delete errors */ }
  }

  return {
    ...uploadResult,
    deletedKey: oldKey,
  };
}

/**
 * List media files in R2 (paginated).
 *
 * @param {R2Bucket} bucket
 * @param {object} [options]
 * @param {string} [options.prefix] - Key prefix filter
 * @param {number} [options.limit] - Max results (default 100)
 * @param {string} [options.cursor] - Pagination cursor
 */
export async function listFromR2(bucket, options = {}) {
  try {
    const result = await bucket.list({
      prefix: options.prefix || 'media/',
      limit: options.limit || 100,
      cursor: options.cursor,
    });

    return {
      ok: true,
      objects: result.objects.map(obj => ({
        key: obj.key,
        size: obj.size,
        etag: obj.etag,
        uploaded: obj.uploaded,
      })),
      truncated: result.truncated,
      cursor: result.cursor,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Check if R2 bucket is available (for graceful fallback).
 *
 * @param {unknown} bucket
 */
export function isR2Available(bucket) {
  return bucket && typeof bucket.put === 'function';
}
