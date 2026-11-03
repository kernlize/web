import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { fetchBlob as kehtoFetchBlob, type NappletArtifactCache, type NappletManifest, type ResolvedNapplet } from '@kehto/nip/5d';
import type { NostrEvent, NostrFilter } from '@napplet/core';
import {
  defaultFetchBlob,
  fetchManifestEvent,
  openDefaultArtifactCache,
  resolveApplet,
  summarize,
  type AppletPointer,
  type AppletSummary,
  type RelayTiers,
  type ResolvedApplet,
} from '@kernl/core';
import { attempt, createBlobFetch, createFakeArtifactCache, last, scratch, signManifest, splitList, type CoreWorld, type FakeArtifactCache, type ManifestVector } from './world.js';

interface BlobServer {
  readonly url: string;
  readonly fetch: typeof fetch;
}

function vector(world: CoreWorld): ManifestVector {
  const value = scratch(world).manifest as ManifestVector | undefined;
  if (!value) throw new Error('sign a manifest first');
  return value;
}

function servers(world: CoreWorld): BlobServer[] {
  return (scratch(world).servers ??= []) as BlobServer[];
}

function addressPointer(world: CoreWorld, relays: string[]): AppletPointer {
  const { pubkey } = vector(world);
  return { kind: 'address', pubkey, identifier: 'chat', eventKind: 35129, relays };
}

async function resolveWith(world: CoreWorld, fetchBlob: (sha256: string, servers: readonly string[]) => Promise<Uint8Array>, cache?: NappletArtifactCache): Promise<void> {
  await attempt(world, async () => {
    const { event } = vector(world);
    scratch(world).resolved = await resolveApplet(cache ? { event, fetchBlob, cache } : { event, fetchBlob });
  });
}

function artifactBytes(world: CoreWorld): Uint8Array {
  return new TextEncoder().encode(vector(world).html);
}

Given('a signed manifest for {string} requiring {string} with optional {string}', async (world: CoreWorld, dTag: string, requires: string, optional: string) => {
  scratch(world).manifest = await signManifest({ dTag, requires: splitList(requires), optional: splitList(optional) });
});

Given('a signed manifest for {string} with an icon and a source', async (world: CoreWorld, dTag: string) => {
  scratch(world).manifest = await signManifest({
    dTag,
    extraTags: [['icon', 'ab'.repeat(32), 'image/png'], ['source', 'https://github.com/example/chat']],
  });
});

Given('the manifest signature is corrupted', (world: CoreWorld) => {
  const current = vector(world);
  const copy = JSON.parse(JSON.stringify(current.event)) as NostrEvent;
  scratch(world).manifest = { ...current, event: { ...copy, sig: '0'.repeat(128) } };
});

Given('the fake pool serves the manifest and an older manifest', async (world: CoreWorld) => {
  const older = await signManifest({ dTag: 'chat', createdAt: 1_600_000_000, title: 'Old chat' });
  scratch(world).pool.events = [older.event, vector(world).event];
});

Given('the fake pool serves the manifest before an older manifest', async (world: CoreWorld) => {
  const older = await signManifest({ dTag: 'chat', createdAt: 1_600_000_000, title: 'Old chat' });
  scratch(world).pool.events = [vector(world).event, older.event];
});

When('the shell resolves the manifest with kehto\'s blob fetcher over a server that is down', async (world: CoreWorld) => {
  await resolveWith(world, (sha256, list) => kehtoFetchBlob(list, sha256, async () => {
    throw new Error('down');
  }));
});

When('the shell fetches the manifest for the address pointer with relays {string}', async (world: CoreWorld, relays: string) => {
  await attempt(world, async () => {
    scratch(world).fetched = await fetchManifestEvent(scratch(world).pool, scratch(world).tiers as RelayTiers, addressPointer(world, splitList(relays)));
  });
});

When('the shell fetches the manifest for the event pointer', async (world: CoreWorld) => {
  const pointer: AppletPointer = { kind: 'event', id: vector(world).event.id, relays: [] };
  scratch(world).fetched = await fetchManifestEvent(scratch(world).pool, scratch(world).tiers as RelayTiers, pointer);
});

When('the shell fetches the manifest for a root address pointer', async (world: CoreWorld) => {
  const pointer: AppletPointer = { kind: 'address', pubkey: vector(world).pubkey, identifier: '', eventKind: 15129, relays: [] };
  scratch(world).fetched = await fetchManifestEvent(scratch(world).pool, scratch(world).tiers as RelayTiers, pointer);
});

Then('the fetched manifest is the signed one', (world: CoreWorld) => {
  expect((scratch(world).fetched as NostrEvent).id).toBe(vector(world).event.id);
});

Then('the manifest request filter was by ids', (world: CoreWorld) => {
  const call = last(scratch(world).pool.calls.filter((entry) => entry.method === 'request'));
  expect(call.filters?.[0]).toEqual({ ids: [vector(world).event.id] });
});

Then('the manifest request filter had no identifier', (world: CoreWorld) => {
  const call = last(scratch(world).pool.calls.filter((entry) => entry.method === 'request'));
  const filter = call.filters?.[0] as NostrFilter;
  expect(filter.kinds).toEqual([15129]);
  expect('#d' in filter).toBe(false);
});

Given('a blob server {string} that does not have the artifact', (world: CoreWorld, url: string) => {
  servers(world).push({ url, fetch: createBlobFetch(new Map()) });
});

Given('a blob server {string} that has the artifact', (world: CoreWorld, url: string) => {
  const { hash, html } = vector(world);
  servers(world).push({ url, fetch: createBlobFetch(new Map([[hash, html]])) });
});

Given('a blob server {string} that is down', (world: CoreWorld, url: string) => {
  servers(world).push({ url, fetch: createBlobFetch(new Map(), { fail: true }) });
});

When('the shell fetches the artifact blob through the default fetcher', async (world: CoreWorld) => {
  const list = servers(world);
  const router: typeof fetch = (input, init) => {
    const url = String(input);
    const server = list.find((entry) => url.startsWith(entry.url.replace(/\/+$/, '')));
    if (!server) throw new Error(`no server for ${url}`);
    return server.fetch(input, init);
  };
  await attempt(world, async () => {
    scratch(world).bytes = await defaultFetchBlob(vector(world).hash, list.map((entry) => entry.url), router);
  });
});

Then('the fetched bytes are the artifact', (world: CoreWorld) => {
  expect(scratch(world).bytes).toEqual(artifactBytes(world));
});

When('the shell resolves the manifest with the artifact available', async (world: CoreWorld) => {
  await resolveWith(world, async () => artifactBytes(world));
});

When('the shell resolves the manifest with a different artifact', async (world: CoreWorld) => {
  await resolveWith(world, async () => new TextEncoder().encode('<html>evil</html>'));
});

When('the shell resolves the manifest with no artifact', async (world: CoreWorld) => {
  const { hash, html } = vector(world);
  const fetchImpl = createBlobFetch(new Map([[`${hash}x`, html]]));
  await resolveWith(world, (sha256, list) => defaultFetchBlob(sha256, list, fetchImpl));
});

When('the shell resolves the manifest with a fetcher that explodes', async (world: CoreWorld) => {
  await resolveWith(world, async () => {
    throw new Error('boom');
  });
});

Given('a fake artifact cache', (world: CoreWorld) => {
  scratch(world).cache = createFakeArtifactCache();
});

When('the shell resolves the manifest with the artifact available and the cache', async (world: CoreWorld) => {
  await resolveWith(world, async () => artifactBytes(world), scratch(world).cache as NappletArtifactCache);
});

Then('the cache received the verified resolution', (world: CoreWorld) => {
  const cache = scratch(world).cache as FakeArtifactCache;
  expect(cache.writes).toHaveLength(1);
  expect(cache.writes[0]?.indexHtml).toBe(vector(world).html);
});

function summary(world: CoreWorld): AppletSummary {
  return (scratch(world).resolved as ResolvedApplet).summary;
}

Then('the summary identity is {string} with the artifact hash', (world: CoreWorld, dTag: string) => {
  expect(summary(world).identity).toEqual({ dTag, hash: vector(world).hash });
});

Then('the summary title is {string} by the author requiring {string} with optional {string}', (world: CoreWorld, title: string, requires: string, optional: string) => {
  expect(summary(world)).toMatchObject({ title, publisher: vector(world).pubkey, description: 'A chat applet.', requires: splitList(requires), optional: splitList(optional), archetypes: [] });
});

Then('the resolved index html is the artifact', (world: CoreWorld) => {
  expect((scratch(world).resolved as ResolvedApplet).indexHtml).toBe(vector(world).html);
});

Then('the summary has no icon and no source', (world: CoreWorld) => {
  expect('icon' in summary(world)).toBe(false);
  expect('source' in summary(world)).toBe(false);
});

Then('the summary has an icon and source {string}', (world: CoreWorld, source: string) => {
  expect(summary(world).icon).toEqual({ sha256: 'ab'.repeat(32), mimeType: 'image/png' });
  expect(summary(world).source).toBe(source);
});

function fakeResolved(manifest: Partial<NappletManifest>, dTag: string): ResolvedNapplet {
  const full: NappletManifest = {
    kind: 35129,
    pubkey: 'ab'.repeat(32),
    dTag,
    catalogId: 'catalog',
    paths: [],
    aggregateHash: 'cd'.repeat(32),
    servers: [],
    requires: [],
    archetypes: [{ slug: 'profile', convention: 'napplet:profile/open', params: [] }],
    ...manifest,
  };
  return { artifactHash: full.aggregateHash, dTag, aggregateHash: full.aggregateHash, files: new Map(), indexHtml: '', manifest: full };
}

Then('summarizing a resolved napplet without title, description or archetype slugs uses the d tag and archetype slugs', () => {
  const result = summarize(fakeResolved({}, 'notes'));
  expect(result.title).toBe('notes');
  expect(result.description).toBe('');
  expect(result.archetypes).toEqual(['profile']);
  expect(result.optional).toEqual([]);
});

Then('summarizing a root napplet without a title is called {string}', (_world: CoreWorld, title: string) => {
  expect(summarize(fakeResolved({}, '')).title).toBe(title);
});

Then('the default artifact cache is absent without Cache Storage', async () => {
  expect(await openDefaultArtifactCache()).toBeUndefined();
});

Then('the default artifact cache is present with Cache Storage', async () => {
  const fakeCaches = { open: async () => ({ match: async () => undefined, put: async () => undefined, delete: async () => true }) };
  Object.defineProperty(globalThis, 'caches', { value: fakeCaches, configurable: true, writable: true });
  try {
    expect(await openDefaultArtifactCache()).toBeDefined();
  } finally {
    Reflect.deleteProperty(globalThis, 'caches');
  }
});
