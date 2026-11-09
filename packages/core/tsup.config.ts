import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [/^@kehto\//, /^@kernlize\//, /^@napplet\//, /^applesauce-/, 'nostr-tools', 'rxjs'],
});
