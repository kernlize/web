import type { EventCache } from '@kernlize/core';

/**
 * The live shell's event cache: sqlite over the origin-private file system, then IndexedDB, then
 * memory, whichever opens first here (D-030). The cache entry loads on demand, so the page's
 * first chunk never carries it, and a cache that cannot open costs the shell nothing.
 */
export async function openShellEventCache(): Promise<EventCache> {
  const { defaultWebCacheAdapters, openEventCache } = await import('@kernlize/core/cache');
  return openEventCache(defaultWebCacheAdapters());
}
