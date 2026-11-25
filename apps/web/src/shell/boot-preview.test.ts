import { afterEach, describe, expect, it } from 'vitest';
import listing from '@kernlize/applet-samples/samples.json';
import { createThrowawayIdentity } from '@kernlize/core';
import { PREVIEW_CORRESPONDENTS } from '@kernlize/preset';
import { boot } from './boot';
import type { Booted, KernlHost, StorageLike } from './contract';
import { PREVIEW_STORAGE_PREFIX, scopedStorage } from './host';
import { samplePage } from './sample-applets';

// The preview runs the real kernel and modules over parts in the page (D-068), so these boot it as the page does: nothing here is mocked.
// The samples are signed with a key made at build time, so every address and key is read from what the build shipped.

const written = new Map<string, string>();
const recorded: StorageLike = {
  getItem: (key) => written.get(key) ?? null,
  setItem: (key, value) => void written.set(key, value),
  removeItem: (key) => void written.delete(key),
};
const opened: string[] = [];
const host: KernlHost = {
  storage: scopedStorage(recorded, PREVIEW_STORAGE_PREFIX),
  notify: () => undefined,
  openLink: (url) => void opened.push(url),
  getVisibility: () => ({ visible: true, focused: true }),
  onRevoked: () => undefined,
};
const theme = { colors: { background: '#fcfaf4', text: '#15171b', primary: '#9a5b00' } };
const hex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

let booted: Booted | undefined;

afterEach(() => {
  booted?.kernl.destroy();
  booted = undefined;
  written.clear();
  opened.length = 0;
});

async function preview(withTheme = false): Promise<Booted> {
  booted = await boot(host, new URLSearchParams('preview=1'), withTheme ? theme : undefined);
  return booted;
}

describe('the preview', () => {
  it('runs the real kernel, and its store lists the samples the build signed', async () => {
    const { kernl, mode } = await preview(true);
    expect(mode).toBe('preview');
    const entries = await kernl.catalog.load();
    expect(entries.map((entry) => entry.title).sort()).toEqual(listing.samples.map((sample) => sample.title).sort());
    expect(new Set(entries.map((entry) => entry.publisher))).toEqual(new Set([listing.publisher]));
  });

  it('verifies and opens each sample by its address, with the messages applet beside them', async () => {
    const { kernl } = await preview();
    await kernl.login(createThrowawayIdentity('Preview identity'));
    for (const sample of listing.samples) {
      const summary = await kernl.resolve(kernl.decodePointer(`35129:${listing.publisher}:${sample.name}`));
      expect(summary).toMatchObject({ title: sample.title, publisher: listing.publisher });
      expect((await kernl.plan(summary)).summary.identity.dTag).toBe(sample.name);
    }
    expect((await kernl.resolve(kernl.decodePointer('kernl:messages'))).title).toBe('Messages');
  });

  it('signs in a throwaway identity whose key is never written down, and keeps its state apart from the live shell', async () => {
    const { kernl } = await preview();
    const identity = createThrowawayIdentity('Preview identity');
    kernl.accounts.addAccount(identity);
    await kernl.login(identity);
    expect(kernl.session?.pubkey).toBe(identity.pubkey);
    expect(kernl.session?.readOnly).toBe(false);
    const key = hex(identity.signer.key);
    expect(written.size).toBeGreaterThan(0);
    for (const [name, value] of written) {
      expect(name.startsWith(PREVIEW_STORAGE_PREFIX)).toBe(true);
      expect(value).not.toContain(key);
    }
  });

  it('names the people who already wrote, through the profiles module', async () => {
    const { kernl } = await preview();
    await kernl.login(createThrowawayIdentity('Preview identity'));
    const names = await Promise.all([PREVIEW_CORRESPONDENTS.ada, PREVIEW_CORRESPONDENTS.grace, listing.publisher].map(async (pubkey) => (await kernl.profiles.settled(pubkey))?.name));
    expect(names).toEqual(['Ada', 'Grace', 'kernl samples']);
  });

  it('downloads in kernl from nobody, and through the host opener when handed off', async () => {
    const { downloads } = await preview();
    expect(downloads.mode()).toBe('kernl');
    downloads.setMode('device');
    await downloads.torrent.add('ab'.repeat(20), [], { requester: 'shell' });
    expect(opened).toEqual([`magnet:?xt=urn:btih:${'ab'.repeat(20)}`]);
  });
});

it('refuses a sample page the build did not ship', async () => {
  await expect(samplePage('chess.html')).rejects.toThrow('unavailable:blob');
});
