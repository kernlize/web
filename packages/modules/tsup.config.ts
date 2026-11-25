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
  // `wm` and `cache` are their own entries so a shell can load them without the network stack (D-022, D-027). The ratchet
  // and group providers are their own entries, so a host that names its modules bundles neither provider's library unless
  // it lists it.
  // The sqlite worker is an entry so the cache can start it by URL. The cache's code is shared with the root
  // entry, so it lands in a chunk at the top of dist, and the worker is emitted there too. sqlite-wasm stays
  // external and is imported only by the worker.
  entry: {
    index: 'src/index.ts',
    'messaging/ratchet/index': 'src/messaging/ratchet/index.ts',
    'messaging/groups/index': 'src/messaging/groups/index.ts',
    'wm/index': 'src/wm/index.ts',
    'cache/index': 'src/cache/index.ts',
    // One entry per module, so a host bundles only the modules it lists (#75).
    'bridges/index': 'src/bridges/index.ts',
    'catalog/index': 'src/catalog/index.ts',
    'directory/index': 'src/directory/index.ts',
    'downloads/index': 'src/downloads/index.ts',
    'uploads/index': 'src/uploads/index.ts',
    'intents/index': 'src/intents/index.ts',
    'keys/index': 'src/keys/index.ts',
    'mailboxes/index': 'src/mailboxes/index.ts',
    'messaging/index': 'src/messaging/index.ts',
    'multiplayer/index': 'src/multiplayer/index.ts',
    'people/index': 'src/people/index.ts',
    'profiles/index': 'src/profiles/index.ts',
    'settings/index': 'src/settings/index.ts',
    'social/index': 'src/social/index.ts',
    'theme/index': 'src/theme/index.ts',
    'sqlite-worker': 'src/cache/sqlite-worker.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  onSuccess: async () => assertWorkerBeside(),
  external: [/^@noble\//, /^@kehto\//, /^@kernlize\//, /^@napplet\//, /^applesauce-/, /^@sqlite\.org\//, 'nostr-tools', 'rxjs'],
});
