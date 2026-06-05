/**
 * functions/api/agent/webhook.js — Inbound webhook from Agent-coding.
 *
 * POST /api/agent/webhook
 *   Headers:
 *     X-Agent-Coding-Signature: hex HMAC-SHA256 of the raw body
 *   Body: any JSON. Treated as a job descriptor:
 *     {
 *       "command": "content.post.create",
 *       "payload": { ... },
 *       "external_id": "agent-123"   // optional, mapped to job.external_id
 *     }
 *
 * The endpoint:
 *   1. Reads the raw body (must be done before JSON.parse so the signature
 *      matches).
 *   2. Verifies the HMAC-SHA256 signature against the webhook secret.
 *   3. Enqueues the job and processes it.
 *   4. Returns the job result so Agent-coding can update its UI.
 */

import { loadConfig } from '../../../lib/config.js';
import { createStore } from '../../../lib/store.js';
import { getClient } from '../../../lib/agentCodingClient.js';
import { enqueue, processNext } from '../../../lib/jobs.js';
import { ok, err, withCors, handleOptions } from '../../../lib/auditLog.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request);
  if (request.method !== 'POST') {
    return withCors(err('method_not_allowed', 'POST only', 405));
  }

  const config = loadConfig(env);
  const client = getClient(env);

  if (!client.webhookSecret) {
    return withCors(err('webhook_not_configured',
      'AGENT_CODING_WEBHOOK_SECRET is not set', 503));
  }

  // Read raw body BEFORE parsing JSON.
  let raw;
  try {
    raw = await request.text();
  } catch (e) {
    return withCors(err('cannot_read_body', e.message, 400));
  }

  const signature = request.headers.get('x-agent-coding-signature')
    || request.headers.get('X-Agent-Coding-Signature')
    || '';
  const valid = await client.verifyWebhookSignature(raw, signature);
  if (!valid) {
    return withCors(err('invalid_signature', 'HMAC signature mismatch', 401));
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch (e) {
    return withCors(err('invalid_json', e.message, 400));
  }

  const { command, payload, external_id } = body || {};
  if (!command) return withCors(err('command_required', 'command is required', 400));

  const store = createStore(env, { dataDir: config.dataDir });
  let job;
  try {
    job = await enqueue(store, {
      command,
      payload: payload || {},
      created_by: external_id ? `agent:${external_id}` : 'webhook',
    });
  } catch (e) {
    return withCors(err(e.code || 'enqueue_failed', e.message, 400));
  }

  const processed = await processNext(store, {
    policyPath: config.policyPath,
    contentDir: config.contentDir,
    client,
  });

  return withCors(ok({
    received: true,
    external_id,
    job,
    processed,
  }));
}
