/**
 * lib/jobs.js — Agent-coding job queue + processor.
 *
 * A "job" is a single command from Agent-coding (or from the admin) that
 * the bridge needs to execute against the website. The lifecycle:
 *
 *   queued → running → succeeded | failed
 *                  ↘ rejected (cancelled by operator)
 *
 * Supported job commands:
 *   - content.post.create       Create a draft post.
 *   - content.post.update       Update a draft post.
 *   - content.post.approve      Move a post to `approved`.
 *   - content.post.reject       Move a post to `rejected`.
 *   - content.post.schedule     Move a post to `scheduled` with publish_at.
 *   - content.post.publish      Move a post to `published` and write to disk.
 *   - media.upload              Register a media asset (already uploaded).
 *   - menu.item.create          Create a menu item.
 *   - menu.item.update          Update a menu item.
 *   - menu.item.toggle          Toggle menu item active flag.
 *   - site.sync                 Report the current state to Agent-coding.
 *
 * Each job records an audit_log entry, an agent_jobs row, and (when
 * configured) reports the result back to Agent-coding via the client.
 */

import { record } from './auditLog.js';
import {
  validatePost,
  transitionPost,
  scoreAgainstPolicy,
  publishToDisk,
} from './posts.js';

export const JOB_COMMANDS = [
  'content.post.create',
  'content.post.update',
  'content.post.approve',
  'content.post.reject',
  'content.post.schedule',
  'content.post.publish',
  'media.upload',
  'menu.item.create',
  'menu.item.update',
  'menu.item.toggle',
  'page.create',
  'page.update',
  'page.approve',
  'page.reject',
  'page.publish',
  'page.rollback',
  'theme.update',
  'seo.update',
  'redirect.create',
  'redirect.bulk_import',
  'analytics.update',
  'site.sync',
];

function newId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return prefix + '-' + crypto.randomUUID();
  }
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Enqueue a new job. Returns the row. The job will be picked up by
 * `processNext` (or `processAll`) on the next tick.
 *
 * @param {any} store
 * @param {{ command: string, payload?: any, created_by?: string, meta?: Record<string, unknown> }} job
 */
export async function enqueue(store, job) {
  if (!JOB_COMMANDS.includes(job.command)) {
    throw Object.assign(new Error('unknown_command'), { code: 'unknown_command', command: job.command });
  }
  const row = {
    id: newId('job'),
    command: job.command,
    payload: job.payload || {},
    status: 'queued',
    attempts: 0,
    last_attempt_at: null,
    result: null,
    error: null,
    created_by: job.created_by || 'system',
    created_at: new Date().toISOString(),
    completed_at: null,
  };
  await store.upsert('agent_jobs', row);
  await record(store, {
    actor: row.created_by,
    action: 'job.enqueue',
    target_type: 'agent_job',
    target_id: row.id,
    meta: { command: job.command },
  });
  return row;
}

/**
 * Process the next queued job. Returns the (possibly updated) row, or null
 * if there are no queued jobs.
 *
 * @param {any} store
 * @param {{ policyPath?: string, contentDir?: string, client?: { reportJobResult: Function } }} [ctx]
 */
export async function processNext(store, ctx = {}) {
  const jobs = await store.list('agent_jobs');
  const next = jobs.find(j => j.status === 'queued');
  if (!next) return null;
  return await _runJob(store, next, ctx);
}

/**
 * Process all queued jobs. Returns { processed, results }.
 *
 * @param {any} store
 * @param {any} [ctx]
 */
export async function processAll(store, ctx = {}) {
  const results = [];
  let processed = 0;
  while (true) {
    const job = await processNext(store, ctx);
    if (!job) break;
    results.push({ id: job.id, command: job.command, status: job.status, error: job.error });
    processed++;
    if (processed > 1000) break;
  }
  return { processed, results };
}

async function _runJob(store, job, ctx) {
  const startedAt = new Date().toISOString();
  const updated = {
    ...job,
    status: 'running',
    attempts: (job.attempts || 0) + 1,
    last_attempt_at: startedAt,
  };
  await store.upsert('agent_jobs', updated);

  let result = null;
  let error = null;
  try {
    result = await _executeCommand(store, job, ctx);
  } catch (e) {
    error = e && e.message ? e.message : String(e);
  }
  const finalRow = {
    ...updated,
    status: error ? 'failed' : 'succeeded',
    result,
    error,
    completed_at: new Date().toISOString(),
  };
  await store.upsert('agent_jobs', finalRow);
  await record(store, {
    actor: 'job_runner',
    action: 'job.complete',
    target_type: 'agent_job',
    target_id: finalRow.id,
    meta: { command: finalRow.command, status: finalRow.status, error },
  });

  // Best-effort report to Agent-coding.
  try {
    if (ctx.client && typeof ctx.client.reportJobResult === 'function') {
      await ctx.client.reportJobResult(finalRow.id, {
        status: finalRow.status,
        result,
        error: error || undefined,
        completed_at: finalRow.completed_at,
      });
    }
  } catch { /* swallow */ }
  return finalRow;
}

async function _executeCommand(store, job, ctx) {
  const { command, payload } = job;
  switch (command) {
    case 'content.post.create': {
      const v = validatePost(payload);
      if (!v.ok) throw new Error('validation_failed: ' + v.errors.join(','));
      const score = scoreAgainstPolicy(ctx.policyPath, v.value);
      const post = {
        ...v.value,
        status: v.value.status || 'draft',
        score: score.score,
        hard_blocks: score.hard_blocks,
        soft_failures: score.soft_failures,
      };
      return await store.upsert('posts', post);
    }
    case 'content.post.update': {
      if (!payload.id) throw new Error('id_required');
      const existing = await store.get('posts', payload.id);
      if (!existing) throw new Error('not_found');
      const merged = { ...existing, ...payload.patch, id: existing.id };
      const score = scoreAgainstPolicy(ctx.policyPath, merged);
      return await store.upsert('posts', {
        ...merged,
        score: score.score,
        hard_blocks: score.hard_blocks,
        soft_failures: score.soft_failures,
      });
    }
    case 'content.post.approve':
    case 'content.post.reject':
    case 'content.post.schedule':
    case 'content.post.publish': {
      if (!payload.id) throw new Error('id_required');
      const targetStatus = ({
        'content.post.approve': 'approved',
        'content.post.reject': 'rejected',
        'content.post.schedule': 'scheduled',
        'content.post.publish': 'publishing',
      })[command];
      const post = await transitionPost(store, payload.id, targetStatus, {
        actor: 'job_runner',
        meta: { job_id: job.id },
      });
      if (command === 'content.post.publish') {
        const written = ctx.contentDir
          ? await publishToDisk(ctx.contentDir, post)
          : { ok: false, reason: 'no_content_dir' };
        const finalPost = await transitionPost(store, post.id, written.ok ? 'published' : 'failed', {
          actor: 'job_runner',
          meta: { write: written },
        });
        return { post: finalPost, written };
      }
      return { post };
    }
    case 'media.upload': {
      if (!payload.url) throw new Error('url_required');
      return await store.upsert('media', payload);
    }
    case 'menu.item.create':
    case 'menu.item.update': {
      if (!payload.id) payload.id = newId('menu');
      return await store.upsert('menu_items', payload);
    }
    case 'menu.item.toggle': {
      if (!payload.id) throw new Error('id_required');
      const existing = await store.get('menu_items', payload.id);
      if (!existing) throw new Error('not_found');
      return await store.upsert('menu_items', {
        ...existing,
        active: typeof payload.active === 'boolean' ? payload.active : !existing.active,
      });
    }
    case 'site.sync': {
      const posts = await store.list('posts');
      const media = await store.list('media');
      const categories = await store.list('menu_categories');
      const items = await store.list('menu_items');
      if (store.setState) {
        await store.setState({ last_sync_at: new Date().toISOString() });
      }
      return {
        counts: {
          posts: posts.length,
          media: media.length,
          menu_categories: categories.length,
          menu_items: items.length,
        },
        synced_at: new Date().toISOString(),
      };
    }
    default:
      throw new Error('unsupported_command: ' + command);
  }
}
