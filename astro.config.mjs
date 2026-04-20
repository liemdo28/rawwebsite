import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.rawsushibar.com',
  integrations: [sitemap()],
  output: 'static',
  build: {
    format: 'directory'
  }
});