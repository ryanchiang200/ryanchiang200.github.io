import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  integrations: [
    react(),
    tailwind(),
    sitemap({
      // 私人网盘 /drive 不出现在 sitemap
      filter: (page) => !page.includes('/drive'),
    }),
  ],
  site: 'https://ryanchiang200.github.io',
  base: '/',
});
