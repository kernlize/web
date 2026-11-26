import { defineConfig } from 'vite';
import { nip5aManifest } from '@napplet/vite-plugin';
import { archetypesOf, sampleFor } from './src/specs';

// One page, three builds: `vite build --mode notes|pulse|profiles`. The mode
// picks the spec, which the page also reads through `import.meta.env.MODE`.
export default defineConfig(({ mode }) => {
  const spec = sampleFor(mode);
  return {
    build: {
      outDir: `dist/${spec.name}`,
      // Vite's module-preload polyfill calls the network; one inlined entry
      // needs no preload graph, and napplet code has no ambient network authority.
      modulePreload: { polyfill: false },
    },
    // Dev server only: a sandboxed preview frame asks with `Origin: null`.
    server: { cors: { origin: '*' } },
    plugins: [
      nip5aManifest({
        nappletType: spec.name,
        title: spec.title,
        description: spec.description,
        artifactMode: 'single-file',
        requires: [...spec.requires],
        optional: [...spec.optional],
        archetypes: archetypesOf(spec),
      }),
    ],
  };
});
