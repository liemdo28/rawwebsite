/**
 * functions/api/agent/jobs.js — Enqueue and inspect jobs.
 *
 * GET  /api/agent/jobs            List recent jobs (last 50). Public read.
 * POST /api/agent/jobs            Enqueue a new job. Admin auth required.
 *                                 Body: { command, payload, created_by? }
 *
 * Supported commands are enumerated in lib/jobs.js (JOB_COMMANDS).
 * After enqueuing, the job is also processed synchronously so the caller
 * can see the result in the same request. In production we'd want a
 * separate worker / cron to drain the queue, but synchronous processing
 * keeps the integration simple and testable.
 */

import { loadConfig } from '../../../lib/config.js';
import { createStore } from '../../../lib/store.js';
import { getClient } from '../../../lib/agentCodingClient.js';
import { enqueue, processNext, JOB_COMMANDS } from '../../../lib/jobs.js';
import {
  ok, err, readJson, verifyAdmin, withCors, handleOptions,
} from '../../../lib/auditLog.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);
  const config = loadConfig(env);
  const store = createStore(env, { dataDir: config.dataDir });
  const client = getClient(env);

  if (request.method === 'GET') {
    const jobs = await store.list('agent_jobs');
    jobs.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return withCors(ok({
      supported_commands: JOB_COMMANDS,
      jobs: jobs.slice(0, 50),
      total: jobs.length,
    }));
  }

  if (request.method !== 'POST') {
    return withCors(err('method_not_allowed', 'GET or POST only', 405));
  }

  const actor = verifyAdmin(request, config.admin.secret);
  if (!actor) {
    return withCors(err('unauthorized', 'admin Bearer token required', 401));
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return withCors(err(parsed.error, 'bad request body', 400));

  const { command, payload, created_by } = parsed.data || {};
  if (!command) return withCors(err('command_required', 'command is required', 400));
  if (!JOB_COMMANDS.includes(command)) {
    return withCors(err('unknown_command', `unsupported command: ${command}`, 400, {
      supported: JOB_COMMANDS,
    }));
  }

  let job;
  try {
    job = await enqueue(store, {
      command,
      payload: payload || {},
      created_by: created_by || actor,
    });
  } catch (e) {
    return withCors(err(e.code || 'enqueue_failed', e.message, 400));
  }

  // Process the just-enqueued job immediately so the API is synchronous.
  const processed = await processNext(store, {
    policyPath: config.policyPath,
    contentDir: config.contentDir,
    client,
  });

  return withCors(ok({
    job,
    processed,
  }));
}
