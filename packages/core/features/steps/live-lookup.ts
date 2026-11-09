import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import { WebSocketServer, type WebSocket } from 'ws';
import { RelayPool } from 'applesauce-relay';
import { naddrEncode } from 'applesauce-core/helpers';
import type { NostrEvent, NostrFilter } from '@napplet/core';
import { createKernl, createRelayTiers, fetchManifestEvent, type AppletSummary, type Kernl, type ManifestTiming } from '@kernlize/core';
import { MemoryStorage, attempt, scratch, signManifest, splitList, type CoreWorld, type ManifestVector } from './world.js';

/** A relay on a loopback port: it answers a REQ with what it holds, after a delay, or never. */
interface LocalRelay {
  readonly url: string;
  close(): Promise<void>;
}

interface LocalRelayOptions {
  readonly events: readonly NostrEvent[];
  /** Called once per REQ the relay receives. */
  readonly onRequest?: () => void;
  readonly delayMs?: number;
  readonly silent?: boolean;
  /** Accept the connection, then close it: a relay behind a failing proxy, or one that is shedding load. */
  readonly hangUp?: boolean;
}

interface Live {
  relays: Map<string, string>;
  requests: Map<string, number>;
  closers: Array<() => Promise<void> | void>;
  blobUrl?: string;
  blobs: Map<string, string>;
  blobRequests: string[];
  kernl?: Kernl;
  summary?: AppletSummary;
  fetched?: NostrEvent;
  elapsedMs?: number;
}

function live(world: CoreWorld): Live {
  return (scratch(world).live ??= { relays: new Map(), requests: new Map(), closers: [], blobs: new Map(), blobRequests: [] }) as Live;
}

function manifest(world: CoreWorld): ManifestVector {
  const value = scratch(world).manifest as ManifestVector | undefined;
  if (!value) throw new Error('sign a manifest first');
  return value;
}

function matches(filter: NostrFilter, event: NostrEvent): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  const identifiers = filter['#d'];
  return !identifiers || event.tags.some((tag) => tag[0] === 'd' && identifiers.includes(tag[1] ?? ''));
}

/** Answer one connection the way this relay behaves. */
function serve(socket: WebSocket, options: LocalRelayOptions): void {
  if (options.hangUp) socket.close(1011, 'down');
  socket.on('message', (raw) => {
    const [verb, subId, ...filters] = JSON.parse(String(raw)) as [string, string, ...NostrFilter[]];
    if (verb !== 'REQ') return;
    options.onRequest?.();
    if (options.silent) return;
    const held = options.events.filter((event) => filters.some((filter) => matches(filter, event)));
    setTimeout(() => {
      for (const event of held) socket.send(JSON.stringify(['EVENT', subId, event]));
      socket.send(JSON.stringify(['EOSE', subId]));
    }, options.delayMs ?? 0);
  });
}

function startRelay(options: LocalRelayOptions): Promise<LocalRelay> {
  return new Promise((resolve) => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    server.on('connection', (socket) => serve(socket, options));
    server.on('listening', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `ws://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => {
          for (const client of server.clients) client.terminate();
          server.close(() => done());
        }),
      });
    });
  });
}

/** A loopback port that was free a moment ago and has nothing listening on it now. */
function unusedPort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function addRelay(world: CoreWorld, name: string, options: LocalRelayOptions): Promise<void> {
  const { requests } = live(world);
  const relay = await startRelay({ ...options, onRequest: () => void requests.set(name, (requests.get(name) ?? 0) + 1) });
  live(world).relays.set(name, relay.url);
  live(world).closers.push(() => relay.close());
}

/** Names registered by the Given steps become their URLs; anything else is passed through as typed. */
function urls(world: CoreWorld, names: string): string[] {
  return splitList(names).map((name) => live(world).relays.get(name) ?? name);
}

After(async (world: CoreWorld) => {
  const state = scratch(world).live as Live | undefined;
  if (!state) return;
  state.kernl?.destroy();
  for (const close of state.closers) await close();
});

Given('a local blob server', async (world: CoreWorld) => {
  const state = live(world);
  const server: Server = createServer((request, response) => {
    const hash = (request.url ?? '').split('/').pop() ?? '';
    state.blobRequests.push(hash);
    const body = state.blobs.get(hash);
    response.writeHead(body === undefined ? 404 : 200, { 'access-control-allow-origin': '*' });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.blobUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.closers.push(() => new Promise<void>((done) => {
    server.closeAllConnections();
    server.close(() => done());
  }));
});

async function signFeed(world: CoreWorld, servers: readonly string[]): Promise<void> {
  const vector = await signManifest({ dTag: 'feed', title: 'Feed', requires: ['identity', 'outbox'], optional: ['config', 'theme'], servers });
  live(world).blobs.set(vector.hash, vector.html);
  scratch(world).manifest = vector;
}

Given('a signed "feed" manifest served from the local blob server', async (world: CoreWorld) => {
  await signFeed(world, [String(live(world).blobUrl)]);
});

Given('the manifest also names a blob server where nothing listens, first', async (world: CoreWorld) => {
  const previous = manifest(world);
  await signFeed(world, [`http://127.0.0.1:${await unusedPort()}`, String(live(world).blobUrl)]);
  // The relays registered so far hold the earlier signing; give them the one that names both servers.
  scratch(world).resigned = { from: previous.event.id, to: manifest(world).event };
});

Given('a local relay {string} that holds the manifest', async (world: CoreWorld, name: string) => {
  const held: NostrEvent[] = [manifest(world).event];
  scratch(world).held = held;
  await addRelay(world, name, { events: held });
});

Given('a local relay {string} that holds the manifest and answers after {int} ms', async (world: CoreWorld, name: string, delayMs: number) => {
  await addRelay(world, name, { events: [manifest(world).event], delayMs });
});

Given('a local relay {string} that holds an older release of the manifest', async (world: CoreWorld, name: string) => {
  const older = await signManifest({ dTag: 'feed', title: 'Old feed', createdAt: 1_600_000_000 });
  await addRelay(world, name, { events: [older.event] });
});

Given('a local relay {string} that holds nothing', async (world: CoreWorld, name: string) => {
  await addRelay(world, name, { events: [] });
});

Given('a local relay {string} that never answers', async (world: CoreWorld, name: string) => {
  await addRelay(world, name, { events: [], silent: true });
});

Given('a local relay {string} that hangs up on every connection', async (world: CoreWorld, name: string) => {
  await addRelay(world, name, { events: [], hangUp: true });
});

Given('a relay address {string} where nothing listens', async (world: CoreWorld, name: string) => {
  live(world).relays.set(name, `ws://127.0.0.1:${await unusedPort()}`);
});

function bootLive(world: CoreWorld, apps: string, general: string): void {
  const resigned = scratch(world).resigned as { to: NostrEvent } | undefined;
  if (resigned) (scratch(world).held as NostrEvent[]).splice(0, 1, resigned.to);
  live(world).kernl = createKernl({
    host: {
      storage: scratch(world).storage,
      presentConsent: () => undefined,
      notify: () => undefined,
      openLink: () => undefined,
      getVisibility: () => ({ visible: true, focused: true }),
      onRevoked: () => undefined,
    },
    // Every tier is named so no scenario reaches a relay it did not start.
    relays: { apps: urls(world, apps), super: urls(world, general), discovery: [], outbox: [] },
    artifactCache: async () => undefined,
  });
}

Given('a live kernl shell whose apps tier is {string}', (world: CoreWorld, apps: string) => {
  bootLive(world, apps, '');
});

Given('a live kernl shell whose apps tier is {string} and whose general relays are {string}', (world: CoreWorld, apps: string, general: string) => {
  bootLive(world, apps, general);
});

function address(world: CoreWorld, hints: string): string {
  const { pubkey } = manifest(world);
  return naddrEncode({ kind: 35129, pubkey, identifier: 'feed', relays: urls(world, hints) });
}

async function resolveTyped(world: CoreWorld, typed: string): Promise<void> {
  const { kernl } = live(world);
  if (!kernl) throw new Error('create a live shell first');
  await attempt(world, async () => {
    live(world).summary = await kernl.resolve(kernl.decodePointer(typed));
  });
}

When('the live shell resolves the address hinting {string}', async (world: CoreWorld, hints: string) => {
  await resolveTyped(world, address(world, hints));
});

When('the live shell resolves the address hinting {string} pasted as a link', async (world: CoreWorld, hints: string) => {
  await resolveTyped(world, `https://applets.example/n/${address(world, hints)}?ref=share`);
});

Then('the live summary is {string} with the artifact hash', (world: CoreWorld, dTag: string) => {
  expect(scratch(world).errors).toEqual([]);
  expect(live(world).summary?.identity).toEqual({ dTag, hash: manifest(world).hash });
});

Then('the local blob server was asked for the artifact', (world: CoreWorld) => {
  expect(live(world).blobRequests).toContain(manifest(world).hash);
});

interface LookUp {
  readonly hints: string;
  readonly general?: string;
  readonly timing?: Partial<ManifestTiming>;
}

async function lookUp(world: CoreWorld, { hints, general = '', timing = {} }: LookUp): Promise<void> {
  const pool = new RelayPool();
  live(world).closers.unshift(() => pool.close());
  // Only what the scenario names is asked: the shell's built-in relays stay out of it.
  const tiers = createRelayTiers(new MemoryStorage(), { apps: [], super: urls(world, general), discovery: [], outbox: [] });
  const { pubkey } = manifest(world);
  const started = Date.now();
  await attempt(world, async () => {
    live(world).fetched = await fetchManifestEvent(pool, tiers, { kind: 'address', pubkey, identifier: 'feed', eventKind: 35129, relays: urls(world, hints) }, timing);
  });
  live(world).elapsedMs = Date.now() - started;
}

When('the manifest is looked up over real connections from {string}', async (world: CoreWorld, hints: string) => {
  await lookUp(world, { hints });
});

When('the manifest is looked up over real connections from {string} settling after {int} ms', async (world: CoreWorld, hints: string, settleMs: number) => {
  await lookUp(world, { hints, timing: { settleMs } });
});

When('the manifest is looked up over real connections from {string} with patience of {int} ms', async (world: CoreWorld, hints: string, patienceMs: number) => {
  await lookUp(world, { hints, timing: { patienceMs } });
});

When('the manifest is looked up over real connections from {string} timing out after {int} ms', async (world: CoreWorld, hints: string, timeoutMs: number) => {
  await lookUp(world, { hints, timing: { timeoutMs } });
});

When('the manifest is looked up over real connections from {string} falling back to {string}', async (world: CoreWorld, hints: string, general: string) => {
  await lookUp(world, { hints, general });
});

When('the manifest is looked up over real connections from {string} falling back to {string} timing out after {int} ms', async (world: CoreWorld, hints: string, general: string, timeoutMs: number) => {
  await lookUp(world, { hints, general, timing: { timeoutMs } });
});

Then('the local relay {string} was asked {int} time', (world: CoreWorld, name: string, times: number) => {
  expect(live(world).requests.get(name) ?? 0).toBe(times);
});

Then('the looked-up manifest is the signed one', (world: CoreWorld) => {
  expect(scratch(world).errors).toEqual([]);
  expect(live(world).fetched?.id).toBe(manifest(world).event.id);
});

Then('the lookup took under {int} ms', (world: CoreWorld, limit: number) => {
  expect(live(world).elapsedMs).toBeLessThan(limit);
});
