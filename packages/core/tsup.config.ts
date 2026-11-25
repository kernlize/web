import { defineConfig } from 'tsup';

export default defineConfig({
  // Every entry re-exports the kernel's or the modules' entry of the same name (D-068).
  entry: {
    index: 'src/index.ts',
    'kernel/index': 'src/kernel/index.ts',
    'messaging/ratchet/index': 'src/messaging/ratchet/index.ts',
    'messaging/groups/index': 'src/messaging/groups/index.ts',
    'wm/index': 'src/wm/index.ts',
    'crypto/index': 'src/crypto/index.ts',
    'cache/index': 'src/cache/index.ts',
    'seal/index': 'src/seal/index.ts',
    'asks/index': 'src/asks/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [/^@kernlize\//, /^@napplet\//],
});
