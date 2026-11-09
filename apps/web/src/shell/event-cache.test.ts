import { describe, expect, it } from 'vitest';
import { openShellEventCache } from './event-cache';

describe('openShellEventCache', () => {
  it('falls back to memory where the page has neither OPFS workers nor IndexedDB', async () => {
    const cache = await openShellEventCache();
    expect(cache.name).toBe('memory');
    await cache.close();
  });
});
