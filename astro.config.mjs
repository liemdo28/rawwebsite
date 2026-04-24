import { defineConfig } from 'astro/config';

// @astrojs/sitemap removed: all content pages are static HTML in public/,
// not Astro-generated routes. The plugin had zero pages to process and was
// leaving async libuv handles unclosed on Windows, causing a build crash
// (Assertion failed: UV_HANDLE_CLOSING, src\win\async.c:76).
export default defineConfig({
  site: 'https://www.rawsushibar.com',
  integrations: [],
  output: 'static',
  build: {
    format: 'directory'
  }
});