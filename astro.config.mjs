import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { satteri } from '@astrojs/markdown-satteri';
import escapeScriptTags from './src/lib/escape-script-tags.mjs';

export default defineConfig({
  site: 'https://zeyadzonkorany.github.io',
  trailingSlash: 'always',
  integrations: [sitemap()],
  markdown: {
    processor: satteri({ mdastPlugins: [escapeScriptTags] }),
    shikiConfig: {
      themes: { light: 'github-light-high-contrast', dark: 'github-dark-high-contrast' },
      defaultColor: false,
    },
  },
});
