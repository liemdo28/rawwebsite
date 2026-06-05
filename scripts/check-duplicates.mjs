#!/usr/bin/env node
/**
 * scripts/check-duplicates.mjs — CI guard.
 *
 * Fails (exit 1) if canonical source files exist in both the root and
 * `public/`, since the build only ships the `public/` copy. A duplicate
 * means the next build is going to silently drop the root version.
 *
 * Usage: `node scripts/check-duplicates.mjs` or `npm run check:duplicates`.
 */

import { readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/** Recursively list files in a directory. */
function walk(dir, results = []) {
  if (!existsSync(dir)) return results;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git' || name === 'dist' || name === 'data') continue;
      walk(p, results);
    } else {
      results.push(p);
    }
  }
  return results;
}

const rootFiles = new Set(walk(ROOT).map(p => relative(ROOT, p).replace(/\\/g, '/')));
const publicFiles = new Set(walk(join(ROOT, 'public')).map(p => relative(join(ROOT, 'public'), p).replace(/\\/g, '/')));

const duplicates = [];
for (const rel of rootFiles) {
  if (rel.startsWith('public/') || rel.startsWith('functions/') || rel.startsWith('lib/')
      || rel.startsWith('src/') || rel.startsWith('scripts/') || rel.startsWith('tests/')
      || rel.startsWith('docs/') || rel.startsWith('reports/')
      || rel === 'package.json' || rel === 'package-lock.json' || rel === 'README.md'
      || rel === 'astro.config.mjs' || rel === 'build.mjs' || rel === 'wrangler.toml'
      || rel === 'PROJECT_DNA.md' || rel === 'sitemap.xml' || rel === 'robots.txt'
      || rel === '.gitignore' || rel === '.env.example' || rel.startsWith('content/')
      || rel.startsWith('config/')) {
    continue;
  }
  if (publicFiles.has(rel)) {
    duplicates.push(rel);
  }
}

if (duplicates.length === 0) {
  console.log('[check-duplicates] OK — no root/public canonical duplicates.');
  process.exit(0);
} else {
  console.error('[check-duplicates] FAIL — the following files exist in both root and public/:');
  for (const d of duplicates) console.error('  - ' + d);
  console.error('');
  console.error('These files are duplicates because the build only ships public/*.');
  console.error('Edit ONLY the public/ copy (or remove the root copy) to keep CI green.');
  process.exit(1);
}
