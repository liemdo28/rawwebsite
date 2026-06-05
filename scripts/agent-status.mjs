#!/usr/bin/env node
/**
 * scripts/agent-status.mjs — Local status CLI for the bridge.
 *
 * Usage:
 *   node scripts/agent-status.mjs
 *   RAWWEBSITE_DATA_DIR=./data node scripts/agent-status.mjs
 *
 * Prints a summary of the local store: counts per table, last 5 jobs,
 * Agent-coding connection, audit trail.
 */

import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
process.chdir(ROOT);

const dataDir = process.env.RAWWEBSITE_DATA_DIR
  ? resolve(process.env.RAWWEBSITE_DATA_DIR)
  : resolve(ROOT, 'data');

const { createStore } = await import('../lib/store.js');
const { loadConfig } = await import('../lib/config.js');
const { getClient } = await import('../lib/agentCodingClient.js');

const config = loadConfig({
  RAWWEBSITE_DATA_DIR: dataDir,
  AGENT_CODING_API_BASE_URL: process.env.AGENT_CODING_API_BASE_URL || '',
  AGENT_CODING_API_KEY: process.env.AGENT_CODING_API_KEY || '',
  AGENT_CODING_WEBHOOK_SECRET: process.env.AGENT_CODING_WEBHOOK_SECRET || '',
  RAWWEBSITE_ADMIN_SECRET: process.env.RAWWEBSITE_ADMIN_SECRET || 'dev-admin-secret',
});

const store = createStore(config.env || {}, { dataDir: config.dataDir });
const client = getClient(config.env || {});

console.log('=== RawWebsite Agent-coding Bridge ===');
console.log('Data dir:    ', dataDir);
console.log('Store:       ', store.describe ? store.describe() : { backend: 'unknown' });
console.log('Agent-coding:', client.describe());
console.log('');

for (const t of ['posts', 'media', 'menu_categories', 'menu_items', 'agent_jobs', 'audit_log']) {
  const rows = await store.list(t);
  console.log(t.padEnd(16), 'count:', rows.length);
}

const jobs = await store.list('agent_jobs');
jobs.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
console.log('');
console.log('Last 5 jobs:');
for (const j of jobs.slice(0, 5)) {
  console.log('  ', j.created_at, j.id.slice(0, 12), j.command, '→', j.status, j.error ? '(' + j.error + ')' : '');
}

const audit = await store.list('audit_log');
audit.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
console.log('');
console.log('Last 5 audit entries:');
for (const a of audit.slice(0, 5)) {
  console.log('  ', a.created_at, a.action, a.target_type, a.target_id || '', a.actor || '');
}
