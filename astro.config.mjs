import { defineConfig } from 'astro/config';

// @astrojs/sitemap removed: all content pages are static HTML in public/,
// not Astro-generated routes. The plugin had zero pages to process and was
// leaving async libuv handles unclosed on Windows, causing a build crash
// (Assertion failed: UV_HANDLE_CLOSING, src\win\async.c:76).
//
// Source-of-truth layout:
//   - public/  → static marketing site (HTML, CSS, JS, images) — served as-is.
//   - content/ → canonical blog posts (markdown + JSON index).
//   - functions/ → Cloudflare Pages Functions (middleware + API endpoints
//                  for the Agent-coding bridge). These run on the edge.
//   - src/    → Astro components, layouts, and `data/` (typescript config),
//               kept as the foundation for future Astro routes if needed.
//
// The Agent-coding bridge endpoints are implemented in functions/api/ as
// Cloudflare Pages Functions (no Astro adapter required) so the existing
// static deploy path is preserved unchanged.
export default defineConfig({
  site: 'https://www.rawsushibar.com',
  integrations: [],
  output: 'static',
  build: {
    format: 'directory'
  }
});
