/**
 * lib/agentCodingClient.js — Outbound HTTP client for the Agent-coding service.
 *
 * The bridge is responsible for:
 *   - Sending job results back to Agent-coding after a job is processed.
 *   - Reporting sync status to the Agent-coding dashboard.
 *   - Polling Agent-coding for queued jobs (optional; webhook is preferred).
 *
 * Implementation notes:
 *   - Cloudflare Workers exposes `fetch()` + `crypto.subtle` globally.
 *   - Node 18+ also exposes both globals. We use them to stay runtime-agnostic.
 *   - The API key is sent as `Authorization: Bearer <key>`.
 *   - We cap retries to 3 to keep Worker CPU time low.
 */

import { readSecret, timingSafeEqual } from './config.js';

/**
 * Build a client from a Cloudflare env binding or process.env.
 * @param {Record<string, unknown>} [env]
 */
export function getClient(env = {}) {
  const apiBaseUrl = readSecret(env, 'AGENT_CODING_API_BASE_URL') || '';
  const apiKey = readSecret(env, 'AGENT_CODING_API_KEY') || '';
  const webhookSecret = readSecret(env, 'AGENT_CODING_WEBHOOK_SECRET') || '';
  return new AgentCodingClient({ apiBaseUrl, apiKey, webhookSecret });
}

export class AgentCodingClient {
  /**
   * @param {{ apiBaseUrl: string, apiKey: string, webhookSecret: string }} config
   */
  constructor(config) {
    this.apiBaseUrl = (config.apiBaseUrl || '').replace(/\/+$/, '');
    this.apiKey = config.apiKey || '';
    this.webhookSecret = config.webhookSecret || '';
    this.enabled = Boolean(this.apiBaseUrl && this.apiKey);
  }

  /** @returns {{ enabled: boolean, api_base_url: string, has_api_key: boolean, has_webhook_secret: boolean }} */
  describe() {
    return {
      enabled: this.enabled,
      api_base_url: this.apiBaseUrl,
      has_api_key: Boolean(this.apiKey),
      has_webhook_secret: Boolean(this.webhookSecret),
    };
  }

  /**
   * Push a job result back to Agent-coding.
   * @param {string} jobId
   * @param {{ status: string, result?: unknown, error?: string }} payload
   * @returns {Promise<{ ok: boolean, status: number, body?: unknown, error?: string }>}
   */
  async reportJobResult(jobId, payload) {
    if (!this.enabled) return { ok: false, status: 0, error: 'agent_coding_not_configured' };
    const url = `${this.apiBaseUrl}/jobs/${encodeURIComponent(jobId)}/result`;
    return this.postJson(url, payload, 3);
  }

  /**
   * Sync a draft post to Agent-coding for review.
   * @param {Record<string, unknown>} draft
   */
  async syncDraft(draft) {
    if (!this.enabled) return { ok: false, status: 0, error: 'agent_coding_not_configured' };
    return this.postJson(`${this.apiBaseUrl}/drafts`, draft, 3);
  }

  /**
   * POST JSON with bounded retries (exponential backoff).
   * @param {string} url
   * @param {unknown} body
   * @param {number} maxRetries
   */
  async postJson(url, body, maxRetries = 3) {
    let lastError = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            'User-Agent': 'rawwebsite-agent-bridge/0.1',
          },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
        if (res.status >= 200 && res.status < 300) {
          return { ok: true, status: res.status, body: parsed };
        }
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          return { ok: false, status: res.status, body: parsed, error: `http_${res.status}` };
        }
        lastError = `http_${res.status}`;
      } catch (err) {
        lastError = err && err.message ? err.message : String(err);
      }
      const delay = 250 * Math.pow(3, attempt);
      await new Promise(r => setTimeout(r, delay));
    }
    return { ok: false, status: 0, error: lastError || 'unknown' };
  }

  /**
   * Verify an inbound webhook payload's HMAC-SHA256 signature.
   * @param {string} rawBody
   * @param {string} signature
   * @returns {Promise<boolean>}
   */
  async verifyWebhookSignature(rawBody, signature) {
    if (!this.webhookSecret || !signature) return false;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(this.webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
    const expected = Array.from(new Uint8Array(sigBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    // Accept either raw hex or `sha256=<hex>` style
    const provided = String(signature).replace(/^sha256=/, '').trim().toLowerCase();
    return timingSafeEqual(provided, expected);
  }
}
