import { defineConfig } from 'vitepress';
import { collectPage, markdownAlternate, writeAgentOutput } from './agent-output';
import { structuredData } from './structured-data';

const base = process.env.VITEPRESS_BASE ?? '/docs/';

export const sidebar = [
  {
    text: 'Start',
    items: [
      { text: 'Overview', link: '/' },
      { text: 'Alpha status', link: '/alpha-status' },
      { text: 'Roadmap', link: '/roadmap' },
      { text: 'Agent access', link: '/agent-access' },
    ],
  },
  {
    text: 'Concepts',
    items: [
      { text: 'Architecture', link: '/concepts/architecture' },
      { text: 'Guard', link: '/concepts/guard' },
      { text: 'Identity and grants', link: '/concepts/identity-and-grants' },
      { text: 'Messaging', link: '/concepts/messaging' },
      { text: 'Bridges', link: '/concepts/bridges' },
    ],
  },
  {
    text: 'Tutorials',
    items: [
      { text: 'Run the shell', link: '/tutorials/run-the-shell' },
      { text: 'Build an applet for kernl', link: '/tutorials/build-an-applet-for-kernl' },
    ],
  },
  {
    text: 'How-tos',
    items: [
      { text: 'Change the guard profile', link: '/how-tos/change-guard-profile' },
      { text: 'Add a messaging provider', link: '/how-tos/add-a-messaging-provider' },
      { text: 'Add a bridge backend', link: '/how-tos/add-a-bridge-backend' },
      { text: 'Grant and revoke', link: '/how-tos/grant-and-revoke' },
      { text: 'Deploy', link: '/how-tos/deploy' },
    ],
  },
  {
    text: 'Packages',
    items: [
      { text: 'Packages', link: '/packages/' },
      { text: '@kernl/guard', link: '/packages/guard' },
      { text: '@kernl/messaging', link: '/packages/messaging' },
      { text: '@kernl/bridges', link: '/packages/bridges' },
      { text: '@kernl/core', link: '/packages/core' },
    ],
  },
  {
    text: 'Reference',
    items: [{ text: 'API reference', link: '/reference/api' }],
  },
  {
    text: 'Policies',
    items: [
      { text: 'Policy index', link: '/policies/' },
      { text: 'Public vocabulary', link: '/policies/public-vocabulary' },
      { text: 'Security posture', link: '/policies/security-posture' },
      { text: 'Spec conformance', link: '/policies/spec-conformance' },
    ],
  },
];

export default defineConfig({
  title: 'kernl',
  description: 'Developer documentation for kernl, an opinionated shell for sandboxed web applets built on the kehto toolkit.',
  base,
  cleanUrls: true,
  lastUpdated: true,
  lang: 'en-US',
  appearance: 'dark',
  // TypeDoc writes docs/api after the VitePress build; the pages build copies it next to this site.
  ignoreDeadLinks: [/^\/api\//],
  head: [['meta', { name: 'color-scheme', content: 'dark light' }]],
  transformPageData: collectPage,
  transformHead: ({ pageData }) => [...markdownAlternate(pageData, base), ...structuredData(pageData)],
  buildEnd: (siteConfig) => writeAgentOutput(siteConfig, sidebar),
  themeConfig: {
    search: { provider: 'local' },
    outline: [2, 3],
    nav: [
      { text: 'Start', link: '/' },
      { text: 'Concepts', link: '/concepts/architecture' },
      { text: 'Tutorials', link: '/tutorials/run-the-shell' },
      { text: 'How-tos', link: '/how-tos/change-guard-profile' },
      { text: 'Packages', link: '/packages/' },
      { text: 'API', link: '/reference/api' },
    ],
    sidebar,
    socialLinks: [{ icon: 'github', link: 'https://github.com/kernlize/web' }],
    editLink: {
      pattern: 'https://github.com/kernlize/web/edit/main/docs/:path',
      text: 'Edit this page',
    },
    footer: {
      message: 'MIT licensed. Protocol authority: NIP-5D (nostr-protocol/nips PR #2303) and the NAPs (napplet/naps).',
    },
  },
});
