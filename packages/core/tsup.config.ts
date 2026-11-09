import { defineConfig } from 'tsup';

export default defineConfig({
  // `wm` is its own entry so a shell can load layouts and the window manager without the network stack (D-022).
  entry: { index: 'src/index.ts', 'wm/index': 'src/wm/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [/^@kehto\//, /^@kernlize\//, /^@napplet\//, /^applesauce-/, 'nostr-tools', 'rxjs'],
});
