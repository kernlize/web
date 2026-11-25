import { defineConfig } from 'tsup';

export default defineConfig({
  // `crypto`, `seal` and `asks` are their own entries so a page or a UI's view models can load them without the network stack (D-024, #74).
  entry: {
    index: 'src/index.ts',
    'crypto/index': 'src/crypto/index.ts',
    'seal/index': 'src/seal/index.ts',
    'asks/index': 'src/asks/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [/^@noble\//, /^@kehto\//, /^@kernlize\//, /^@napplet\//, /^applesauce-/, 'rxjs'],
});
