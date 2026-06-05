#!/usr/bin/env node
/**
 * scripts/agent-export.mjs — Export the entire store as a single JSON file.
 *
 * Usage:
 *   node scripts/agent-export.mjs                 # writes data/export-<timestamp>.json
 *   node scripts/agent-export.mjs out.json        # writes out.json
 */

import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
process.chdir(ROOT);

const dataDir = process.env.RAWWEBSITE_DATA_DIR
  ? resolve(process.env.RAWWEBSITE_DATA_DIR)
  : resolve(ROOT, 'data');

const { FileStore } = await import('../lib/store.js');
const store = new FileStore(dataDir);
await store._ensure();

const out = await store.exportAll();
const outPath = process.argv[2]
  ? resolve(process.argv[2])
  : join(dataDir, `export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('[agent-export] wrote', outPath);
console.log('  posts:', out.tables.posts.length);
console.log('  media:', out.tables.media.length);
console.log('  menu_categories:', out.tables.menu_categories.length);
console.log('  menu_items:', out.tables.menu_items.length);
console.log('  agent_jobs:', out.tables.agent_jobs.length);
console.log('  audit_log:', out.tables.audit_log.length);
