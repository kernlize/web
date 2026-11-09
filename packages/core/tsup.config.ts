import { defineConfig } from 'tsup';

export default defineConfig({
  // `wm` and `crypto` are their own entries so a shell can load them without the network stack (D-022, D-024).
  entry: { index: 'src/index.ts', 'wm/index': 'src/wm/index.ts', 'crypto/index': 'src/crypto/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [/^@noble\//, /^@kehto\//, /^@kernlize\//, /^@napplet\//, /^applesauce-/, 'nostr-tools', 'rxjs'],
});
