/**
 * tests/agentCodingClient.test.js — Unit tests for the Agent-coding client.
 *
 * Uses Node's global `fetch` mock via test.runOnly / t.mock isn't yet
 * stable across runtimes; we use a real test server (a tiny http.createServer)
 * to verify the HMAC and retry logic.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const { getClient, AgentCodingClient } = await import('../lib/agentCodingClient.js');

test('describe: shows not-configured when no env', () => {
  const c = getClient({});
  const d = c.describe();
  assert.equal(d.enabled, false);
  assert.equal(d.has_api_key, false);
  assert.equal(d.has_webhook_secret, false);
});

test('describe: enabled when both base + key present', () => {
  const c = getClient({
    AGENT_CODING_API_BASE_URL: 'https://agent.example.com',
    AGENT_CODING_API_KEY: 'secret-123',
  });
  const d = c.describe();
  assert.equal(d.enabled, true);
  assert.equal(d.has_api_key, true);
});

test('reportJobResult: returns not_configured when disabled', async () => {
  const c = getClient({});
  const r = await c.reportJobResult('job-1', { status: 'succeeded' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'agent_coding_not_configured');
});

test('reportJobResult: POSTs to /jobs/:id/result with Bearer auth', async () => {
  let observed = null;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      observed = {
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        ua: req.headers['user-agent'],
        body: JSON.parse(body),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  try {
    const c = new AgentCodingClient({
      apiBaseUrl: 'http://127.0.0.1:' + port,
      apiKey: 'sk-test-123',
      webhookSecret: 'whs-456',
    });
    const r = await c.reportJobResult('job-abc', { status: 'succeeded', result: { id: 1 } });
    assert.equal(r.ok, true);
    assert.equal(observed.method, 'POST');
    assert.equal(observed.url, '/jobs/job-abc/result');
    assert.equal(observed.auth, 'Bearer sk-test-123');
    assert.match(observed.ua, /rawwebsite-agent-bridge/);
    assert.equal(observed.body.status, 'succeeded');
  } finally {
    server.close();
  }
});

test('verifyWebhookSignature: matches when HMAC is correct', async () => {
  const c = new AgentCodingClient({
    apiBaseUrl: 'http://example.com',
    apiKey: '',
    webhookSecret: 'shared-secret',
  });
  const body = JSON.stringify({ command: 'content.post.create' });
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode('shared-secret'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const sig = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  const ok = await c.verifyWebhookSignature(body, sig);
  assert.equal(ok, true);
});

test('verifyWebhookSignature: rejects wrong secret', async () => {
  const c = new AgentCodingClient({
    apiBaseUrl: 'http://example.com',
    apiKey: '',
    webhookSecret: 'shared-secret',
  });
  const ok = await c.verifyWebhookSignature('{}', '0123456789abcdef');
  assert.equal(ok, false);
});
