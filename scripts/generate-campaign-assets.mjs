#!/usr/bin/env node
/**
 * scripts/generate-campaign-assets.mjs
 *
 * Generates the 30 campaign hero images (1200x630 WebP) by cropping/optimizing
 * real existing photos from public/images/{fb-photos,raw-photos} — no
 * placeholders, no AI-generated artwork (none was needed; the existing photo
 * library covered every article).
 *
 * Usage: node scripts/generate-campaign-assets.mjs
 */
import sharp from 'sharp';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'public', 'images', 'campaign');
mkdirSync(OUT_DIR, { recursive: true });

const RAW = (i) => join(ROOT, 'public', 'images', 'raw-photos', RAW_LIST[i]);

import { readdirSync } from 'node:fs';
// NOTE: all 94 files in fb-photos/ turned out to be uniform 206x206 Facebook
// thumbnail exports — too low-resolution to upscale into a 1200x630 hero
// without visible blur. They are excluded here; only the genuinely
// high-resolution raw-photos/ originals (34 usable .jpg/.jpeg files after
// excluding .heic/.dng that this libvips build can't decode) are used.
const RAW_LIST = readdirSync(join(ROOT, 'public', 'images', 'raw-photos')).filter(f => /\.(jpg|jpeg)$/i.test(f));

// Index ranges within RAW_LIST (chronological): 0-9 = 2025-07-28 appetizers/
// cocktails, 10-22 = 2025-10-27 catering platter + interior, 23-29 = 2025-12-15
// gift card, 30-33 = 2025-12-15 udon.
const MANIFEST = [
  ['faq-visit-hero', () => RAW(10), 'attention'],
  ['happy-hour-hero', () => RAW(3), 'attention'],
  ['first-visit-hero', () => RAW(11), 'attention'],
  ['signature-rolls-hero', () => RAW(12), 'attention'],
  ['nigiri-selection-hero', () => RAW(13), 'attention'],
  ['summer-sashimi-hero', () => RAW(14), 'attention'],
  ['wine-pairing-hero', () => RAW(4), 'attention'],
  ['family-takeout-hero', () => RAW(15), 'attention'],
  ['celebration-tray-hero', () => RAW(5), 'attention'],
  ['hot-appetizers-hero', () => RAW(0), 'attention'],
  ['takeout-commute-hero', () => RAW(31), 'attention'],
  ['cooked-entree-hero', () => RAW(30), 'attention'],
  ['sashimi-salad-hero', () => RAW(8), 'attention'],
  ['worth-the-drive-hero', () => RAW(12), 'entropy'],
  ['vegetarian-plate-hero', () => RAW(1), 'attention'],
  ['ponzu-dish-hero', () => RAW(7), 'attention'],
  ['game-night-platter-hero', () => RAW(17), 'attention'],
  ['a-la-carte-plating-hero', () => RAW(6), 'attention'],
  ['office-lunch-hero', () => RAW(16), 'attention'],
  ['road-trip-dinner-hero', () => RAW(32), 'attention'],
  ['order-options-hero', () => RAW(33), 'attention'],
  ['downtown-stockton-hero', () => RAW(3), 'entropy'],
  ['gift-card-hero', () => RAW(25), 'attention'],
  ['delta-dinner-hero', () => RAW(9), 'attention'],
  ['student-dining-hero', () => RAW(18), 'attention'],
  ['kid-friendly-hero', () => RAW(2), 'attention'],
  ['team-dinner-hero', () => RAW(19), 'attention'],
  ['watch-party-platter-hero', () => RAW(20), 'attention'],
  ['regional-map-hero', () => RAW(21), 'attention'],
  ['weeknight-family-hero', () => RAW(22), 'attention'],
];

const results = [];

for (const [name, resolve, cropStrategy] of MANIFEST) {
  const src = resolve();
  const out = join(OUT_DIR, `${name}.webp`);
  try {
    const srcMeta = await sharp(src).metadata();
    await sharp(src)
      .rotate() // honor EXIF orientation
      .resize(1200, 630, { fit: 'cover', position: sharp.strategy[cropStrategy] || 'attention' })
      .webp({ quality: 82 })
      .toFile(out);
    const outStat = statSync(out);
    const outMeta = await sharp(out).metadata();
    results.push({
      output: `public/images/campaign/${name}.webp`,
      source: src.replace(ROOT + '\\', '').replace(ROOT + '/', ''),
      source_dimensions: `${srcMeta.width}x${srcMeta.height}`,
      output_dimensions: `${outMeta.width}x${outMeta.height}`,
      output_bytes: outStat.size,
      ok: true,
    });
  } catch (e) {
    results.push({ output: name, source: src, ok: false, error: e.message });
  }
}

const failed = results.filter(r => !r.ok);
console.log(JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} images generated successfully.`);
if (failed.length) {
  console.log('FAILED:', failed.map(f => f.output).join(', '));
  process.exit(1);
}
