import { defineConfig } from 'vite';
import { nip5aManifest } from '@napplet/vite-plugin';

export default defineConfig({
  build: {
    // Vite's module-preload polyfill calls the network; one inlined entry needs
    // no preload graph, and napplet code has no ambient network authority.
    modulePreload: { polyfill: false },
  },
  // Dev server only. A preview shell loads this page into a sandboxed frame
  // with an opaque origin, which asks for its modules with `Origin: null`;
  // Vite's default allowlist refuses that and the frame stays blank.
  server: { cors: { origin: '*' } },
  plugins: [
    // One self-contained `/index.html` for `srcdoc` loading, content-addressed
    // with the NIP-5A tag/hash schema.
    nip5aManifest({
      description:
        'Read and write direct messages. The shell picks and runs the protocol; this applet only shows the conversation.',
      // Build-local fallback; deployment metadata lives in .napplet/config.yaml.
      nappletType: 'messages',
      artifactMode: 'single-file',
      // The one job cannot be done without direct messages. Identity, theme,
      // notify, storage and keys are optional integrations with fallbacks in
      // src/; this plugin version has no option to declare optional domains.
      requires: ['dm'],
      // The role this applet fills and the convention it answers. This plugin
      // version names the convention slot `naps`.
      archetypes: [{ slug: 'dm', naps: ['napplet:dm/open'] }],
    }),
  ],
});
