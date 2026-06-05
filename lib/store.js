/**
 * lib/store.js — Persistence layer for the Agent-coding management layer.
 *
 * Three concrete implementations:
 *   - MemoryStore   — in-process. Default. Used in dev / tests / Functions
 *                     when no durable binding is configured. Resets on cold
 *                     start of the Worker.
 *   - FileStore     — JSON files on disk. Used by Node CLI scripts and by
 *                     `npm run agent:export`. NOT available inside Cloudflare
 *                     Workers (no `fs` API there) — calling it from a Function
 *                     will throw on `_ensure()`.
 *   - KVStore       — Cloudflare KV namespace binding. Used in production
 *                     deployments. Opt-in by setting the `RAWWEBSITE_KV`
 *                     binding in wrangler.toml.
 *
 * The factory `createStore(env, config)` picks the right implementation at
 * runtime based on the `STORE_BACKEND` env var (memory | file | kv) and the
 * presence of a `RAWWEBSITE_KV` binding.
 *
 * Schema (mirrored in all three stores):
 *   - posts(id, slug, title, body, excerpt, image, primary_keyword, cta,
 *           cta_url, status, location, publish_at, created_by, created_at,
 *           updated_at, score, hard_blocks, soft_failures)
 *   - media(id, url, alt, source, width, height, mime, size, created_at,
 *           updated_at)
 *   - menu_categories(id, location, name, sort_order, active, created_at,
 *                     updated_at)
 *   - menu_items(id, category_id, location, name, description, price, tags,
 *                active, created_at, updated_at)
 *   - agent_jobs(id, command, payload, status, result, error, attempts,
 *                last_attempt_at, created_at, completed_at)
 *   - audit_log(id, actor, action, target_type, target_id, meta, created_at)
 *
 * Status enum (posts):
 *   draft → pending_review → approved → scheduled → publishing → published
 *         ↘ rejected / failed
 */

const TABLES = [
  'posts',
  'media',
  'menu_categories',
  'menu_items',
  'agent_jobs',
  'audit_log',
];

const TABLES_SET = new Set(TABLES);

/** @returns {string[]} */
export function listTables() {
  return [...TABLES];
}

/**
 * @typedef {{
 *   list(table: string): Promise<unknown[]>,
 *   get(table: string, id: string): Promise<unknown | null>,
 *   upsert(table: string, row: Record<string, unknown>): Promise<Record<string, unknown>>,
 *   remove(table: string, id: string): Promise<boolean>,
 *   replaceAll?(table: string, rows: unknown[]): Promise<void>,
 *   exportAll?(): Promise<Record<string, unknown>>,
 *   getState?(): Promise<Record<string, unknown>>,
 *   setState?(patch: Record<string, unknown>): Promise<Record<string, unknown>>,
 *   describe?(): Record<string, unknown>,
 * }} Store
 */

/**
 * Cross-runtime UUID. Uses Node `crypto.randomUUID` if available, otherwise
 * the global `crypto.randomUUID` available in Workers.
 */
function cryptoRandomUUID() {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback for very old Node — not used in practice (we require Node 18+)
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * In-memory store. Fast; loses data on cold start.
 */
export class MemoryStore {
  constructor() {
    /** @type {Record<string, unknown[]>} */
    this.tables = {};
    for (const t of TABLES) this.tables[t] = [];
    this.state = { schema_version: 1, last_sync_at: null, applied_migrations: ['001_init'] };
  }
  async list(table) {
    if (!TABLES_SET.has(table)) throw new Error(`Unknown table: ${table}`);
    return [...(this.tables[table] || [])];
  }
  async get(table, id) {
    return (this.tables[table] || []).find(r => r && r.id === id) || null;
  }
  async upsert(table, row) {
    if (!TABLES_SET.has(table)) throw new Error(`Unknown table: ${table}`);
    const rows = this.tables[table];
    const now = new Date().toISOString();
    const next = { ...row, updated_at: now };
    if (!next.id) next.id = cryptoRandomUUID();
    if (!next.created_at) next.created_at = now;
    const idx = rows.findIndex(r => r && r.id === next.id);
    if (idx === -1) rows.push(next);
    else rows[idx] = { ...rows[idx], ...next };
    return next;
  }
  async remove(table, id) {
    if (!TABLES_SET.has(table)) throw new Error(`Unknown table: ${table}`);
    const rows = this.tables[table];
    const idx = rows.findIndex(r => r && r.id === id);
    if (idx === -1) return false;
    rows.splice(idx, 1);
    return true;
  }
  async replaceAll(table, rows) {
    if (!TABLES_SET.has(table)) throw new Error(`Unknown table: ${table}`);
    this.tables[table] = [...rows];
  }
  async getState() { return { ...this.state }; }
  async setState(patch) { this.state = { ...this.state, ...patch }; return { ...this.state }; }
  describe() { return { backend: 'memory', tables: listTables() }; }
}

/**
 * File-backed JSON store. Used by CLI scripts and tests in Node only.
 */
export class FileStore {
  /**
   * @param {string} dataDir
   */
  constructor(dataDir) {
    this.dataDir = dataDir;
    /** @type {Record<string, unknown[]>} */
    this.tables = {};
    this.state = {};
    this._ready = false;
  }
  async _ensure() {
    if (this._ready) return;
    // Lazy import to keep this module Workers-compatible (Workers throws on `node:fs`)
    const { promises: fs, existsSync, mkdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    mkdirSync(this.dataDir, { recursive: true });
    mkdirSync(join(this.dataDir, 'tables'), { recursive: true });
    for (const t of TABLES) {
      const fp = join(this.dataDir, 'tables', `${t}.json`);
      if (!existsSync(fp)) {
        await fs.writeFile(fp, JSON.stringify({ rows: [], updated_at: new Date().toISOString() }, null, 2));
      }
      this.tables[t] = JSON.parse(readFileSync(fp, 'utf8')).rows || [];
    }
    const stateFp = join(this.dataDir, 'state.json');
    if (!existsSync(stateFp)) {
      await fs.writeFile(stateFp, JSON.stringify({ schema_version: 1, last_sync_at: null, applied_migrations: ['001_init'] }, null, 2));
    }
    this.state = JSON.parse(readFileSync(stateFp, 'utf8'));
    this._ready = true;
  }
  async list(table) {
    await this._ensure();
    if (!TABLES_SET.has(table)) throw new Error(`Unknown table: ${table}`);
    return [...(this.tables[table] || [])];
  }
  async get(table, id) {
    await this._ensure();
    return (this.tables[table] || []).find(r => r && r.id === id) || null;
  }
  async upsert(table, row) {
    await this._ensure();
    if (!TABLES_SET.has(table)) throw new Error(`Unknown table: ${table}`);
    const { promises: fs } = await import('node:fs');
    const { join } = await import('node:path');
    const now = new Date().toISOString();
    const next = { ...row, updated_at: now };
    if (!next.id) next.id = cryptoRandomUUID();
    if (!next.created_at) next.created_at = now;
    const rows = this.tables[table];
    const idx = rows.findIndex(r => r && r.id === next.id);
    if (idx === -1) rows.push(next);
    else rows[idx] = { ...rows[idx], ...next };
    const fp = join(this.dataDir, 'tables', `${table}.json`);
    const tmp = `${fp}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ rows, updated_at: now }, null, 2));
    await fs.rename(tmp, fp);
    return next;
  }
  async remove(table, id) {
    await this._ensure();
    if (!TABLES_SET.has(table)) throw new Error(`Unknown table: ${table}`);
    const { promises: fs } = await import('node:fs');
    const { join } = await import('node:path');
    const rows = this.tables[table];
    const idx = rows.findIndex(r => r && r.id === id);
    if (idx === -1) return false;
    rows.splice(idx, 1);
    const fp = join(this.dataDir, 'tables', `${table}.json`);
    await fs.writeFile(fp, JSON.stringify({ rows, updated_at: new Date().toISOString() }, null, 2));
    return true;
  }
  async replaceAll(table, rows) {
    await this._ensure();
    if (!TABLES_SET.has(table)) throw new Error(`Unknown table: ${table}`);
    this.tables[table] = [...rows];
    const { promises: fs } = await import('node:fs');
    const { join } = await import('node:path');
    const fp = join(this.dataDir, 'tables', `${table}.json`);
    await fs.writeFile(fp, JSON.stringify({ rows, updated_at: new Date().toISOString() }, null, 2));
  }
  async getState() { await this._ensure(); return { ...this.state }; }
  async setState(patch) {
    await this._ensure();
    this.state = { ...this.state, ...patch };
    const { promises: fs } = await import('node:fs');
    const { join } = await import('node:path');
    await fs.writeFile(join(this.dataDir, 'state.json'), JSON.stringify(this.state, null, 2));
    return { ...this.state };
  }
  async exportAll() {
    await this._ensure();
    return {
      schema_version: 1,
      exported_at: new Date().toISOString(),
      tables: { ...this.tables },
      state: { ...this.state },
    };
  }
  describe() { return { backend: 'file', dataDir: this.dataDir, tables: listTables() }; }
}

/**
 * Cloudflare KV-backed store. The KV binding is `env.RAWWEBSITE_KV`.
 * One key per table: `table:<name>`. State under `state`.
 */
export class KVStore {
  /**
   * @param {KVNamespace} kv
   */
  constructor(kv) {
    this.kv = kv;
  }
  async _readTable(name) {
    const raw = await this.kv.get(`table:${name}`);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }
  async _writeTable(name, rows) {
    await this.kv.put(`table:${name}`, JSON.stringify(rows));
  }
  async list(table) {
    if (!TABLES_SET.has(table)) throw new Error(`Unknown table: ${table}`);
    return await this._readTable(table);
  }
  async get(table, id) {
    const rows = await this._readTable(table);
    return rows.find(r => r && r.id === id) || null;
  }
  async upsert(table, row) {
    if (!TABLES_SET.has(table)) throw new Error(`Unknown table: ${table}`);
    const rows = await this._readTable(table);
    const now = new Date().toISOString();
    const next = { ...row, updated_at: now };
    if (!next.id) next.id = cryptoRandomUUID();
    if (!next.created_at) next.created_at = now;
    const idx = rows.findIndex(r => r && r.id === next.id);
    if (idx === -1) rows.push(next);
    else rows[idx] = { ...rows[idx], ...next };
    await this._writeTable(table, rows);
    return next;
  }
  async remove(table, id) {
    if (!TABLES_SET.has(table)) throw new Error(`Unknown table: ${table}`);
    const rows = await this._readTable(table);
    const idx = rows.findIndex(r => r && r.id === id);
    if (idx === -1) return false;
    rows.splice(idx, 1);
    await this._writeTable(table, rows);
    return true;
  }
  async replaceAll(table, rows) {
    if (!TABLES_SET.has(table)) throw new Error(`Unknown table: ${table}`);
    await this._writeTable(table, [...rows]);
  }
  async getState() {
    const raw = await this.kv.get('state');
    if (!raw) return { schema_version: 1, last_sync_at: null, applied_migrations: ['001_init'] };
    try { return JSON.parse(raw); } catch { return { schema_version: 1 }; }
  }
  async setState(patch) {
    const cur = await this.getState();
    const next = { ...cur, ...patch };
    await this.kv.put('state', JSON.stringify(next));
    return next;
  }
  describe() { return { backend: 'kv', tables: listTables() }; }
}

/**
 * Factory: pick the right store implementation.
 *
 * @param {Record<string, unknown>} env  Cloudflare env bindings.
 * @param {{ dataDir?: string }} [config]
 * @returns {Store}
 */
export function createStore(env = {}, config = {}) {
  const explicit = readBackendChoice(env);
  const kv = env && env.RAWWEBSITE_KV;
  if (explicit === 'kv' || (kv && explicit !== 'memory' && explicit !== 'file')) {
    if (!kv) throw new Error('STORE_BACKEND=kv but RAWWEBSITE_KV binding is missing');
    return new KVStore(kv);
  }
  if (explicit === 'file') {
    if (!config.dataDir) throw new Error('STORE_BACKEND=file but no dataDir provided');
    return new FileStore(config.dataDir);
  }
  if (explicit === 'memory') return new MemoryStore();

  // Default: in-memory in Workers, file in Node.
  if (kv) return new KVStore(kv);
  if (config.dataDir) return new FileStore(config.dataDir);
  return new MemoryStore();
}

function readBackendChoice(env) {
  const v = (env && (env.STORE_BACKEND || env.store_backend)) || (typeof process !== 'undefined' ? process.env.STORE_BACKEND : '');
  return typeof v === 'string' ? v.toLowerCase() : '';
}
