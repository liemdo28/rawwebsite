#!/usr/bin/env node
/**
 * scripts/agent-seed.mjs — Seed the local store with sample data.
 *
 * Useful for first-time setup, smoke tests, and local development.
 * Creates one post, one menu category, and one menu item per location.
 *
 * Usage:  node scripts/agent-seed.mjs
 */

import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
process.chdir(ROOT);

const dataDir = process.env.RAWWEBSITE_DATA_DIR
  ? resolve(process.env.RAWWEBSITE_DATA_DIR)
  : resolve(ROOT, 'data');

const { FileStore } = await import('../lib/store.js');
const store = new FileStore(dataDir);
await store._ensure();

function newId(p) {
  return p + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

const now = new Date().toISOString();

// 1. A draft post for Stockton
await store.upsert('posts', {
  id: newId('post'),
  slug: 'sample-post-stockton',
  title: 'Sample Post — Stockton',
  body: 'This is a seed post about sushi in Stockton. Visit us today for the freshest fish.',
  excerpt: 'A seed post demonstrating the bridge.',
  image: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=800',
  primary_keyword: 'sushi Stockton',
  secondary_keywords: ['sushi near me Stockton'],
  cta: 'Order now',
  cta_url: 'https://order.toasttab.com/online/raw-sushi-bistro-10742-trinity-pkwy-ste-d',
  post_type: 'conversion_order',
  location: 'raw_stockton',
  status: 'draft',
  score: 95,
  hard_blocks: [],
  soft_failures: [],
  created_at: now,
});

// 2. Two categories
for (const [name, loc, sort] of [
  ['Appetizers', 'raw_stockton', 10],
  ['Specialty Rolls', 'raw_stockton', 20],
  ['Appetizers', 'raw_modesto', 10],
  ['Lunch Specials', 'raw_modesto', 20],
]) {
  await store.upsert('menu_categories', {
    id: newId('cat'),
    name, location: loc, sort_order: sort, active: true,
  });
}

// 3. Sample items
for (const [name, loc, price] of [
  ['Edamame', 'raw_stockton', 6.5],
  ['Spicy Tuna Roll', 'raw_stockton', 12.0],
  ['Edamame', 'raw_modesto', 5.95],
  ['Bento Box', 'raw_modesto', 14.5],
]) {
  await store.upsert('menu_items', {
    id: newId('menu'),
    name, location: loc, price, active: true,
    description: 'Seed item — edit me.',
  });
}

console.log('[agent-seed] inserted sample data into', dataDir);
console.log('  posts:', (await store.list('posts')).length);
console.log('  menu_categories:', (await store.list('menu_categories')).length);
console.log('  menu_items:', (await store.list('menu_items')).length);
