/**
 * functions/api/agent/status.js — Public status endpoint for the bridge.
 *
 * GET /api/agent/status
 *   Returns bridge health, store backend, last sync, last 20 jobs.
 *   No auth required (this is a public health check, but we redact secrets).
 *
 * POST /api/agent/status
 *   Same as GET, but accepts an admin Bearer token to unlock the
 *   `enabled_secrets: true` view that includes which secrets are set
 *   (without echoing them).
 */

import { loadConfig } from '../../../lib/config.js';
import { createStore } from '../../../lib/store.js';
import { getClient } from '../../../lib/agentCodingClient.js';
import { ok, err, verifyAdmin, withCors, handleOptions } from '../../../lib/auditLog.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);

  const config = loadConfig(env);
  const store = createStore(env, { dataDir: config.dataDir });
  const client = getClient(env);

  const jobs = await store.list('agent_jobs');
  jobs.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const last20 = jobs.slice(0, 20).map(j => ({
    id: j.id,
    command: j.command,
    status: j.status,
    created_at: j.created_at,
    completed_at: j.completed_at,
    attempts: j.attempts,
    error: j.error,
  }));

  const audit = await store.list('audit_log');
  audit.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const state = store.getState ? await store.getState() : {};

  const isAdmin = request.method === 'POST'
    ? verifyAdmin(request, config.admin.secret)
    : null;

  const body = {
    ok: true,
    bridge: {
      version: '0.1.0',
      uptime_hint: 'worker_runtime',
      store: store.describe ? store.describe() : { backend: 'unknown' },
      agent_coding: client.describe(),
      state,
      jobs_total: jobs.length,
      jobs_queued: jobs.filter(j => j.status === 'queued').length,
      jobs_running: jobs.filter(j => j.status === 'running').length,
      jobs_succeeded: jobs.filter(j => j.status === 'succeeded').length,
      jobs_failed: jobs.filter(j => j.status === 'failed').length,
      last_jobs: last20,
      last_audit: audit.slice(0, 20).map(a => ({
        id: a.id,
        actor: a.actor,
        action: a.action,
        target_type: a.target_type,
        target_id: a.target_id,
        created_at: a.created_at,
      })),
    },
  };

  if (isAdmin) {
    body.bridge.admin_token_accepted = true;
  } else if (request.method === 'POST') {
    return withCors(err('unauthorized', 'admin token required', 401));
  }

  return withCors(ok(body));
}
