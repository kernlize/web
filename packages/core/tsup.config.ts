import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defineConfig } from 'tsup';

/** Fail the build when code that starts the sqlite worker by URL is emitted somewhere the worker is not beside it. */
function assertWorkerBeside(dir = 'dist'): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) assertWorkerBeside(path);
    else if (path.endsWith('.js') && readFileSync(path, 'utf8').includes('new URL("./sqlite-worker.js"') && !existsSync(join(dirname(path), 'sqlite-worker.js'))) {
      throw new Error(`${path} starts ./sqlite-worker.js, which the build did not emit beside it`);
    }
  }
}

export default defineConfig({
  // `wm`, `crypto` and `cache` are their own entries so a shell can load them without the network stack (D-022, D-024, D-027).
  // `kernel` is the root without kernl's own module list, and the ratchet and group providers are their own entries, so a
  // host that names its modules bundles neither provider's library unless it lists it.
  // The sqlite worker is an entry so the cache can start it by URL. The cache's code is shared with the root
  // entry, so it lands in a chunk at the top of dist, and the worker is emitted there too. sqlite-wasm stays
  // external and is imported only by the worker.
  entry: {
    index: 'src/index.ts',
    'kernel/index': 'src/kernel/index.ts',
    'messaging/ratchet/index': 'src/messaging/ratchet/index.ts',
    'messaging/groups/index': 'src/messaging/groups/index.ts',
    'wm/index': 'src/wm/index.ts',
    'crypto/index': 'src/crypto/index.ts',
    'cache/index': 'src/cache/index.ts',
    // The message seal alone, for view models that must load before the core (#74).
    'seal/index': 'src/seal/index.ts',
    'sqlite-worker': 'src/cache/sqlite-worker.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  onSuccess: async () => assertWorkerBeside(),
  external: [/^@noble\//, /^@kehto\//, /^@kernlize\//, /^@napplet\//, /^applesauce-/, /^@sqlite\.org\//, 'nostr-tools', 'rxjs'],
});
