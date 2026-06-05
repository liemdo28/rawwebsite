/**
 * functions/_scheduled.js — Cloudflare Cron Trigger Handler.
 *
 * This file exports the `scheduled` event handler that Cloudflare Workers
 * invokes on the cron schedule defined in wrangler.toml.
 *
 * Schedule: every 5 minutes (cron: 5 * * * *)
 *
 * Tasks:
 *   1. Process scheduled posts (publish when scheduled_at <= now)
 *   2. Optionally commit published content to Git
 */

import { loadConfig } from '../lib/config.js';
import { createStore } from '../lib/store.js';
import { processScheduledPosts } from '../lib/scheduler.js';
import { commitToGit } from '../lib/gitPublish.js';
import { record } from '../lib/auditLog.js';

/**
 * Cloudflare Workers scheduled event handler.
 *
 * @param {ScheduledEvent} event
 * @param {Env} env
 * @param {ExecutionContext} ctx
 */
export async function scheduled(event, env, ctx) {
  const config = loadConfig(env);
  const store = createStore(env, { dataDir: config.dataDir });

  const startTime = Date.now();
  let result;

  try {
    // Build gitPublish function if GitHub credentials are available
    const gitPublish = (env.GITHUB_TOKEN && env.GITHUB_OWNER && env.GITHUB_REPO)
      ? async (post) => {
          return await commitToGit(env, post);
        }
      : null;

    result = await processScheduledPosts(store, { gitPublish });

    // Record cron execution
    await record(store, {
      actor: 'cron',
      action: 'scheduler.run',
      target_type: 'system',
      target_id: 'cron-trigger',
      meta: {
        cron: event.cron,
        scheduled_time: new Date(event.scheduledTime).toISOString(),
        duration_ms: Date.now() - startTime,
        processed: result.processed,
        published: result.published.length,
        failed: result.failed.length,
      },
    });

    console.log(`[scheduler] Processed ${result.processed} posts. Published: ${result.published.length}, Failed: ${result.failed.length}`);
  } catch (e) {
    // Record cron failure
    await record(store, {
      actor: 'cron',
      action: 'scheduler.error',
      target_type: 'system',
      target_id: 'cron-trigger',
      meta: {
        cron: event.cron,
        error: e.message,
        duration_ms: Date.now() - startTime,
      },
    });

    console.error(`[scheduler] Error: ${e.message}`);
    throw e; // Re-throw to mark the cron run as failed
  }
}

// Export for Cloudflare Pages Functions
export default { scheduled };
