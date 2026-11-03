import { defineConfig } from 'vitepress';
import { collectPage, markdownAlternate, writeAgentOutput } from './agent-output';
import { structuredData } from './structured-data';

const base = process.env.VITEPRESS_BASE ?? '/docs/';

const rControl = /[\u0000-\u001f]/g;
const rSpecial = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g;
const rCombining = /[\u0300-\u036F]/g;

/**
 * VitePress's default heading slug, except that a `D-NNN · title` heading from DECISIONS.md gets the short anchor `d-nnn`.
 * @param title Heading text.
 * @returns The anchor id.
 */
function slugify(title: string): string {
  const decision = title.match(/^D-(\d{3}) ·/);
  if (decision) return `d-${decision[1]}`;
  return title
    .normalize('NFKD')
    .replace(rCombining, '')
    .replace(rControl, '')
    .replace(rSpecial, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase();
}

export const sidebar = [
  {
    text: 'Start',
    items: [
      { text: 'Overview', link: '/' },
      { text: 'Alpha status', link: '/alpha-status' },
      { text: 'Roadmap', link: '/roadmap' },
      { text: 'Changelog', link: '/changelog' },
      { text: 'Agent access', link: '/agent-access' },
      { text: 'Decisions', link: '/decisions' },
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
      { text: 'Relay tiers', link: '/concepts/relay-tiers' },
      { text: 'Persistence', link: '/concepts/persistence' },
      { text: 'Layouts', link: '/concepts/layouts' },
      { text: 'Applets under kernl', link: '/concepts/applets-under-kernl' },
    ],
  },
  {
    text: 'Tutorials',
    items: [
      { text: 'Run the shell', link: '/tutorials/run-the-shell' },
      { text: 'Write an applet', link: '/tutorials/write-an-applet' },
      { text: 'Embed kernl in a page', link: '/tutorials/embed-a-host-page' },
    ],
  },
  {
    text: 'How-tos',
    items: [
      { text: 'How-to index', link: '/how-tos/' },
      { text: 'Change the guard profile', link: '/how-tos/change-guard-profile' },
      { text: 'Add a messaging provider', link: '/how-tos/add-a-messaging-provider' },
      { text: 'Add a bridge backend', link: '/how-tos/add-a-bridge-backend' },
      { text: 'Grant and revoke', link: '/how-tos/grant-and-revoke' },
      { text: 'Embed kernl core', link: '/how-tos/embed-kernl-core' },
      { text: 'Deploy', link: '/how-tos/deploy' },
    ],
  },
  {
    text: 'Guides',
    items: [{ text: 'Troubleshooting', link: '/guides/troubleshooting' }],
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
    items: [
      { text: 'API reference', link: '/reference/api' },
      { text: 'Error reasons', link: '/reference/errors' },
    ],
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
  ignoreDeadLinks: [/^\/api\//, /^\.\.\/api\//],
  markdown: { anchor: { slugify } },
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
      { text: 'How-tos', link: '/how-tos/' },
      { text: 'Packages', link: '/packages/' },
      { text: 'API', link: '/reference/api' },
    ],
    sidebar,
    footer: {
      message: 'MIT licensed. Protocol authority: NIP-5D (nostr-protocol/nips PR #2303) and the NAPs (napplet/naps).',
    },
  },
});
