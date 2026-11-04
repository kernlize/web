import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('webtorrent/dist/webtorrent.min.js');
});

describe('loadWebTorrent', () => {
  it('loads the browser build on demand and starts one client', async () => {
    const created: unknown[] = [];
    vi.resetModules();
    vi.doMock('webtorrent/dist/webtorrent.min.js', () => ({
      default: class {
        constructor() {
          created.push(this);
        }
      },
    }));
    const { loadWebTorrent } = await import('./webtorrent-client');
    const client = await loadWebTorrent();
    expect(created).toEqual([client]);
  });
});
