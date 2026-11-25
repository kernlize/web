import { attachSqliteWorker, type SahPoolSqlite } from './sqlite-worker-handler.js';

// The worker entry: sqlite-wasm is imported here only, on the first request, so it never reaches the page's own chunks.
attachSqliteWorker(globalThis, async () => {
  const { default: init } = await import('@sqlite.org/sqlite-wasm');
  // sqlite-wasm types `exec` as a dozen overloads; the handler uses two of them, which TypeScript cannot match pairwise.
  return (await init()) as SahPoolSqlite;
});
