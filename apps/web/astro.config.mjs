import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';

// D-008: the Publish site workflow sets SITE_URL and SITE_BASE; local builds use the defaults.
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://kernl.run/',
  base: process.env.SITE_BASE ?? '/',
  output: 'static',
  trailingSlash: 'always',
  // D-021: the long-form pages moved under /about/; the addresses they had keep working.
  redirects: Object.fromEntries(['why', 'guard', 'messaging', 'bridges', 'developers'].map((page) => [`/${page}/`, `/about/${page}/`])),
  integrations: [svelte(), sitemap()],
  vite: { build: { target: 'es2022' } },
});
