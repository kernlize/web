import { expect, vi } from 'vitest';
import { After, Given, Then, When, type DataTable } from 'quickpickle';
import { EventStore } from 'applesauce-core';
import { AccountManager, type IAccount } from 'applesauce-accounts';
import { ReadonlyAccount, registerCommonAccountTypes } from 'applesauce-accounts/accounts';
import { originRegistry } from '@kehto/shell';
import type { BridgeContext, BridgeRegistry } from '@kernl/bridges';
import { createMemoryBackend, createMessagingRegistry } from '@kernl/messaging';
import type { GuardEvent, GuardProfile } from '@kernl/guard';
import {
  KERNL_FRAME_POLICY_META,
  createDefaultBridges,
  createKernl,
  type AppletHandle,
  type AppletSummary,
  type ConsentPrompt,
  type Kernl,
  type KernlHost,
  type KernlOptions,
  type MountPlan,
  type Session,
} from '@kernl/core';
import type { DmSendRequest } from '@napplet/core';
import { attempt, author, createFakeArtifactCache, createFakeFrame, createFakePool, passwordAccount, passwordSigner, scratch, signManifest, splitList, type CoreWorld, type FakeFrame, type ManifestVector } from './world.js';

interface HostRecord {
  prompts: ConsentPrompt[];
  notices: unknown[];
  links: string[];
  revoked: Array<{ windowId: string; reason: string }>;
  blobFetches: number;
  cacheOpens: number;
}



export interface KernlScratch {
  kernl: Kernl;
  host: KernlHost;
  record: HostRecord;
  sessions: Array<Session | null>;
  guardEvents: GuardEvent[];
  profiles: GuardProfile[];
  summary?: AppletSummary;
  plan?: MountPlan;
  frame?: FakeFrame;
  handle?: AppletHandle;
  channel?: MessageChannel;
  received: Array<Record<string, unknown>>;
  bridgeCalls: Array<{ uri: string; requester: BridgeContext['requester'] }>;
  supplied?: { eventStore: EventStore; accounts: AccountManager; messaging: ReturnType<typeof createMessagingRegistry>; bridges: BridgeRegistry };
  rogue?: { windowId: string; channel: MessageChannel };
}

export function k(world: CoreWorld): KernlScratch {
  const value = scratch(world).kernl as KernlScratch | undefined;
  if (!value) throw new Error('create a shell first');
  return value;
}

function vector(world: CoreWorld): ManifestVector {
  return scratch(world).manifest as ManifestVector;
}

export async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
}

function makeHost(world: CoreWorld, record: HostRecord, extra: Partial<KernlHost> = {}): KernlHost {
  return {
    storage: scratch(world).storage,
    presentConsent: (prompt) => void record.prompts.push(prompt),
    notify: (notice) => void record.notices.push(notice),
    openLink: (url) => void record.links.push(url),
    getVisibility: () => ({ visible: true, focused: true }),
    onRevoked: (windowId, reason) => void record.revoked.push({ windowId, reason }),
    ...extra,
  };
}

function blobFetcher(world: CoreWorld): Pick<KernlHost, 'fetchBlob'> {
  return {
    fetchBlob: async () => {
      k(world).record.blobFetches += 1;
      return new TextEncoder().encode(vector(world).html);
    },
  };
}

function boot(world: CoreWorld, options: Partial<KernlOptions> = {}, hostExtra: Partial<KernlHost> = {}): void {
  const record: HostRecord = { prompts: [], notices: [], links: [], revoked: [], blobFetches: 0, cacheOpens: 0 };
  const host = makeHost(world, record, hostExtra);
  const kernl = createKernl({ host, pool: scratch(world).pool, ...options });
  const sessions: Array<Session | null> = [];
  const guardEvents: GuardEvent[] = [];
  const profiles: GuardProfile[] = [];
  kernl.session$.subscribe((session) => sessions.push(session));
  kernl.guard.events$.subscribe((event) => guardEvents.push(event));
  kernl.guard.profile$.subscribe((profile) => profiles.push(profile));
  scratch(world).kernl = { kernl, host, record, sessions, guardEvents, profiles, received: [], bridgeCalls: [] } satisfies KernlScratch;
}

After((world: CoreWorld) => {
  const value = scratch(world).kernl as KernlScratch | undefined;
  if (!value) return;
  value.channel?.port1.close();
  value.rogue?.channel.port1.close();
  value.kernl.destroy();
});

Given('a kernl host over empty storage', (world: CoreWorld) => {
  scratch(world);
});

Given('a fake applesauce pool serving a signed manifest for {string} requiring {string}', async (world: CoreWorld, dTag: string, requires: string) => {
  const manifest = await signManifest({ dTag, requires: splitList(requires) });
  const pool = createFakePool();
  pool.events = [manifest.event];
  scratch(world).manifest = manifest;
  scratch(world).pool = pool;
});

Given('the fake pool serves nothing', (world: CoreWorld) => {
  scratch(world).pool.events = [];
});

Given('a kernl shell over that host and pool', (world: CoreWorld) => {
  boot(world, {}, blobFetcher(world));
});

Given('a kernl shell over that host and pool without a blob fetcher', (world: CoreWorld) => {
  boot(world);
});

Given('a kernl shell over that host and pool with a private backend', (world: CoreWorld) => {
  boot(world, { messagingBackends: { private: () => createMemoryBackend() } }, blobFetcher(world));
});

function bootWithFakeBridges(world: CoreWorld, hostExtra: Partial<KernlHost> = {}): void {
  const bridgeCalls: KernlScratch['bridgeCalls'] = [];
  const bridges: BridgeRegistry = {
    register: () => undefined,
    list: () => [],
    forScheme: () => undefined,
    async resolve(uri, context) {
      bridgeCalls.push({ uri, requester: context.requester });
      return { kind: 'bytes', response: new Response('bytes', { status: 200, headers: { 'content-type': 'text/plain' } }) };
    },
  };
  boot(world, { bridges }, { ...blobFetcher(world), ...hostExtra });
  k(world).bridgeCalls = bridgeCalls;
}

Given('a kernl shell over that host and pool with fake bridges', (world: CoreWorld) => bootWithFakeBridges(world));

Given('a kernl shell over that host and pool with fake bridges and a manual clock', (world: CoreWorld) => {
  scratch(world).clock = 1_700_000_000_000;
  bootWithFakeBridges(world, { now: () => scratch(world).clock as number });
});

Given('a kernl shell over that host and pool with its own store, accounts, messaging, bridges, relays, a {string} guard, a theme, a clock and a blob fetcher', (world: CoreWorld, profile: GuardProfile) => {
  const eventStore = new EventStore();
  const accounts = new AccountManager();
  registerCommonAccountTypes(accounts);
  const messaging = createMessagingRegistry();
  const bridges = createDefaultBridges();
  boot(
    world,
    {
      eventStore,
      accounts,
      messaging,
      bridges,
      relays: { apps: ['wss://apps.example'] },
      guard: { profile },
      theme: { colors: { background: '#000', text: '#fff', primary: '#f0f' } },
      artifactCache: async () => {
        k(world).record.cacheOpens += 1;
        return createFakeArtifactCache();
      },
    },
    { now: () => 1_700_000_000_000, ...blobFetcher(world) },
  );
  k(world).supplied = { eventStore, accounts, messaging, bridges };
});

Then('the shell session is null', (world: CoreWorld) => {
  expect(k(world).kernl.session).toBeNull();
});

Then('the shell guard profile is {string} with mitigations described', (world: CoreWorld, profile: string) => {
  expect(k(world).kernl.guard.config.profile).toBe(profile);
  expect(k(world).kernl.guard.mitigations().length).toBeGreaterThan(0);
});

Then('the shell relays {string} tier is {string}', (world: CoreWorld, tier: string, urls: string) => {
  expect(k(world).kernl.relays.get()[tier as 'apps']).toEqual(splitList(urls));
});

Then('the shell messaging provider {string} is unavailable', (world: CoreWorld, id: string) => {
  expect(k(world).kernl.messaging.get(id)?.availability.available).toBe(false);
});

Then('the shell messaging provider {string} is unavailable because {string}', (world: CoreWorld, id: string, reason: string) => {
  expect(k(world).kernl.messaging.get(id)?.availability).toEqual({ available: false, reason });
});

When('the shell enables messaging provider {string} and {string}', (world: CoreWorld, first: string, second: string) => {
  k(world).kernl.messaging.enable(first);
  k(world).kernl.messaging.enable(second);
});

Then('the shell messaging status is available for the signed-in account', async (world: CoreWorld) => {
  const status = await k(world).kernl.messaging.composite().status();
  expect(status).toMatchObject({ available: true, ownerPubkey: k(world).kernl.session?.pubkey, implementations: ['nip17', 'nip04'] });
  const sent = await k(world).kernl.messaging.composite().send({ provider: 'legacy', recipients: [await author.getPublicKey()], content: 'hello' } as DmSendRequest);
  expect(sent.message.status).toBe('sent');
});

Then('the shell messaging provider {string} is available', (world: CoreWorld, id: string) => {
  expect(k(world).kernl.messaging.get(id)?.availability.available).toBe(true);
});

Then('the shell bridges are {string}', (world: CoreWorld, ids: string) => {
  expect(k(world).kernl.bridges.list().map((bridge) => bridge.id)).toEqual(splitList(ids));
});

Then('the shell bridge for {string} hands off to the device', (world: CoreWorld, scheme: string) => {
  expect(k(world).kernl.bridges.forScheme(scheme)?.availability()).toEqual({ available: true, handoff: true });
});

When('the shell bridges resolve {string}', async (world: CoreWorld, uri: string) => {
  await k(world).kernl.bridges.resolve(uri, { requester: 'shell' });
});

Then('the host was asked to open {string} once', (world: CoreWorld, uri: string) => {
  expect(k(world).record.links).toEqual([uri]);
});

Then('the frame policy meta locks frame navigation', () => {
  expect(KERNL_FRAME_POLICY_META).toContain("frame-src 'none'");
});

Then('the host blob fetcher was used', (world: CoreWorld) => {
  expect(k(world).record.blobFetches).toBe(1);
});

Then('the supplied artifact cache was consulted', (world: CoreWorld) => {
  expect(k(world).record.cacheOpens).toBe(1);
});

Given('a kernl shell over that host without a pool', (world: CoreWorld) => {
  const record: HostRecord = { prompts: [], notices: [], links: [], revoked: [], blobFetches: 0, cacheOpens: 0 };
  const host = makeHost(world, record);
  const kernl = createKernl({ host });
  scratch(world).kernl = { kernl, host, record, sessions: [], guardEvents: [], profiles: [], received: [], bridgeCalls: [] } satisfies KernlScratch;
});

Then('the shell pool is its own', (world: CoreWorld) => {
  expect(k(world).kernl.pool).not.toBe(scratch(world).pool);
  expect(typeof k(world).kernl.pool.close).toBe('function');
});

Then('the shell pool is closed', (world: CoreWorld) => {
  expect(k(world).kernl.pool.relays$.value.size).toBe(0);
});

When('the shell logs in with the same account again', async (world: CoreWorld) => {
  const active = k(world).kernl.accounts.active;
  if (!active) throw new Error('log in first');
  await k(world).kernl.login(active);
});

Then('the shell uses the supplied store, accounts, messaging and bridges', (world: CoreWorld) => {
  const { kernl, supplied } = k(world);
  expect(kernl.eventStore).toBe(supplied?.eventStore);
  expect(kernl.accounts).toBe(supplied?.accounts);
  expect(kernl.messaging).toBe(supplied?.messaging);
  expect(kernl.bridges).toBe(supplied?.bridges);
  expect(kernl.pool).toBe(scratch(world).pool);
});

When('the shell logs in with a password account named {string}', async (world: CoreWorld, name: string) => {
  const session = await k(world).kernl.login(await passwordAccount(name));
  expect(session.label).toBe(name);
});

When('the shell logs in with a read-only account', async (world: CoreWorld) => {
  await k(world).kernl.login(ReadonlyAccount.fromPubkey('3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d'));
});

When('the shell logs in with an account that has a name but no metadata', async (world: CoreWorld) => {
  const account = ReadonlyAccount.fromPubkey('0000000000000000000000000000000000000000000000000000000000000002') as IAccount;
  account.name = 'named';
  await k(world).kernl.login(account);
});

When('the shell logs out', async (world: CoreWorld) => {
  await k(world).kernl.logout();
});

Then('the shell session is for {string} and can sign', (world: CoreWorld, name: string) => {
  expect(k(world).kernl.session).toMatchObject({ label: name, readOnly: false });
});

Then('the shell session stream saw {int} values', (world: CoreWorld, count: number) => {
  expect(k(world).sessions).toHaveLength(count);
});

Then('the shell session is read-only with an abbreviated label', (world: CoreWorld) => {
  expect(k(world).kernl.session).toMatchObject({ readOnly: true, label: '3bf0c63f…' });
});

Then('the shell session label is {string}', (world: CoreWorld, label: string) => {
  expect(k(world).kernl.session?.label).toBe(label);
});

When('the shell resolves the manifest address', async (world: CoreWorld) => {
  const { kernl } = k(world);
  await attempt(world, async () => {
    k(world).summary = await kernl.resolve(kernl.decodePointer(`${vector(world).pubkey}:35129:chat`));
  });
});

Then('the shell summary is {string} requiring {string}', (world: CoreWorld, dTag: string, requires: string) => {
  expect(k(world).summary).toMatchObject({ identity: { dTag, hash: vector(world).hash }, requires: splitList(requires) });
});

When('the shell plans the summary', async (world: CoreWorld) => {
  const summary = k(world).summary;
  if (!summary) throw new Error('resolve first');
  k(world).plan = await k(world).kernl.plan(summary);
});

When('the shell blocks the resolved applet', (world: CoreWorld) => {
  const summary = k(world).summary;
  if (!summary) throw new Error('resolve first');
  k(world).kernl.grants.block(summary.identity);
});

When('the shell tries to plan the summary', async (world: CoreWorld) => {
  const summary = k(world).summary;
  if (!summary) throw new Error('resolve first');
  await attempt(world, async () => {
    await k(world).kernl.plan(summary);
  });
});

When('the shell plans an unresolved summary', async (world: CoreWorld) => {
  await attempt(world, async () => {
    const hash = 'ff'.repeat(32);
    const summary: AppletSummary = {
      identity: { dTag: 'ghost', hash },
      title: 'Ghost',
      description: '',
      publisher: vector(world).pubkey,
      requires: [],
      optional: [],
      archetypes: [],
      manifest: { kind: 35129, pubkey: vector(world).pubkey, dTag: 'ghost', catalogId: 'ghost', paths: [], aggregateHash: hash, servers: [], requires: [], archetypes: [] },
    };
    await k(world).kernl.plan(summary);
  });
});

When('the shell allows {string} for the resolved applet', (world: CoreWorld, domain: string) => {
  const summary = k(world).summary;
  if (!summary) throw new Error('resolve first');
  k(world).kernl.grants.allowDomain(summary.identity, domain);
});

Then('the shell plan is for window {string} with domains {string}', (world: CoreWorld, windowId: string, domains: string) => {
  const plan = k(world).plan;
  expect(plan?.windowId).toBe(windowId);
  expect([...(plan?.environment.capabilities.domains ?? [])].sort()).toEqual(splitList(domains).sort());
});

Then('the shell plan is missing {string}', (world: CoreWorld, domains: string) => {
  expect(k(world).plan?.missingRequired).toEqual(splitList(domains));
});

function mountFrame(world: CoreWorld): void {
  const s = k(world);
  if (!s.plan) throw new Error('plan first');
  s.frame = createFakeFrame();
  s.handle = s.kernl.mount(s.plan, s.frame);
}

When('the shell mounts the plan into a fake frame', mountFrame);

Given('a mounted applet', async (world: CoreWorld) => {
  const { kernl } = k(world);
  k(world).summary = await kernl.resolve(kernl.decodePointer(`${vector(world).pubkey}:35129:chat`));
  k(world).plan = await kernl.plan(k(world).summary as AppletSummary);
  mountFrame(world);
});

Then('the shell has {int} applets and the frame holds the plan srcdoc', (world: CoreWorld, count: number) => {
  expect(k(world).kernl.applets()).toHaveLength(count);
  expect(k(world).frame?.srcdoc).toBe(k(world).plan?.srcdoc);
});

Then('the shell has {int} applets', (world: CoreWorld, count: number) => {
  expect(k(world).kernl.applets()).toHaveLength(count);
});

When('the shell closes the mounted applet', (world: CoreWorld) => {
  k(world).handle?.close();
});

When('kehto revokes the mounted window', (world: CoreWorld) => {
  k(world).kernl.bridge.revokeNapplet(k(world).plan?.windowId ?? '');
});

Then('the host was told the window was revoked for {string}', (world: CoreWorld, reason: string) => {
  expect(k(world).record.revoked).toEqual([{ windowId: k(world).plan?.windowId, reason }]);
});

Then('the mounted frame was removed', (world: CoreWorld) => {
  expect(k(world).frame?.removed).toBe(true);
});

/** A window-level message as the bridge sees it: a real Event carrying the NIP-5D fields. */
function windowMessage(source: MessageEventSource | null, data: unknown, ports: MessagePort[]): MessageEvent {
  return Object.assign(new Event('message'), { source, data, ports, origin: 'null' }) as MessageEvent;
}

function hello(world: CoreWorld, win: Window): MessageChannel {
  const channel = new MessageChannel();
  channel.port1.onmessage = (event) => void k(world).received.push(event.data as Record<string, unknown>);
  const message = windowMessage(win, { type: 'napplet.hello' }, [channel.port2]);
  k(world).kernl.handleWindowMessage(message);
  return channel;
}

When('the applet sends its hello through the shell', (world: CoreWorld) => {
  const win = k(world).frame?.contentWindow;
  if (!win) throw new Error('mount first');
  k(world).channel = hello(world, win);
});

When('the applet asks {string} over its port', async (world: CoreWorld, type: string) => {
  k(world).channel?.port1.postMessage({ type, id: `${type}-1` });
  await settle();
});

When('the applet asks {string} for {string} over its port', async (world: CoreWorld, type: string, url: string) => {
  k(world).channel?.port1.postMessage({ type, id: `${type}-1`, url });
  await settle();
});

When('the applet floods {string} over its port until the guard quarantines it', async (world: CoreWorld, type: string) => {
  const port = k(world).channel?.port1;
  if (!port) throw new Error('hello first');
  for (let i = 0; i < 320; i += 1) port.postMessage({ type, id: `flood-${i}`, key: 'k' });
  await settle();
  await settle();
});

Then('the applet received a {string} with domains {string}', (world: CoreWorld, type: string, domains: string) => {
  const message = k(world).received.find((entry) => entry.type === type);
  const capabilities = message?.capabilities as { domains: string[] } | undefined;
  expect([...(capabilities?.domains ?? [])].sort()).toEqual(splitList(domains).sort());
});

Then('the applet received a {string}', (world: CoreWorld, type: string) => {
  expect(k(world).received.map((entry) => entry.type)).toContain(type);
});

Then('the shell guard events included {string}', (world: CoreWorld, reason: string) => {
  expect(k(world).guardEvents.map((event) => event.reason)).toContain(reason);
});

Then('the fake bridges were asked for {string} by applet {string}', (world: CoreWorld, uri: string, dTag: string) => {
  expect(k(world).bridgeCalls).toEqual([{ uri, requester: { dTag, hash: vector(world).hash } }]);
});

When('a window message with no source reaches the shell', (world: CoreWorld) => {
  k(world).kernl.handleWindowMessage(windowMessage(null, { type: 'napplet.hello' }, []));
});

When('a rogue window registered outside the shell is granted {string}, sends its hello, asks {string} for {string} and floods {string}', async (world: CoreWorld, domain: string, ask: string, url: string, type: string) => {
  const win = {} as Window;
  const windowId = 'rogue-1';
  const identity = { dTag: 'rogue', hash: 'cd'.repeat(32) };
  k(world).kernl.grants.allowDomain(identity, domain);
  originRegistry.register(win, windowId, { dTag: identity.dTag, aggregateHash: identity.hash });
  const channel = hello(world, win);
  channel.port1.postMessage({ type: ask, id: 'rogue-ask', url });
  await settle();
  for (let i = 0; i < 320; i += 1) channel.port1.postMessage({ type, id: `rogue-${i}`, key: 'k' });
  await settle();
  k(world).rogue = { windowId, channel };
});

Then('the fake bridges were asked for {string} by the shell itself', (world: CoreWorld, uri: string) => {
  expect(k(world).bridgeCalls).toEqual([{ uri, requester: 'shell' }]);
});

Then('the shell survived and kehto can revoke the rogue window', (world: CoreWorld) => {
  const rogue = k(world).rogue;
  expect(rogue).toBeDefined();
  k(world).kernl.bridge.revokeNapplet(rogue?.windowId ?? '');
  expect(k(world).record.revoked).toEqual([]);
});

When('the shell guard profile is set to {string}', (world: CoreWorld, profile: GuardProfile) => {
  k(world).kernl.guard.setProfile(profile);
});

Then('the shell guard profile stream ends with {string}', (world: CoreWorld, profile: string) => {
  expect(k(world).profiles.at(-1)).toBe(profile);
});

Then('releasing window {string} from the guard does nothing harmful', (world: CoreWorld, windowId: string) => {
  expect(() => k(world).kernl.guard.release(windowId)).not.toThrow();
});

When('the shell is destroyed', (world: CoreWorld) => {
  k(world).kernl.destroy();
});

Given('the shell is signed in', async (world: CoreWorld) => {
  await k(world).kernl.login(await passwordAccount('alice'));
});

Given('the shell is signed in and its store holds the profile {string}', async (world: CoreWorld, content: string) => {
  await k(world).kernl.login(await passwordAccount('alice'));
  const profile = await passwordSigner.signEvent({ kind: 0, tags: [], content, created_at: 1_700_000_000 });
  k(world).kernl.eventStore.add(profile);
});

Given('the shell is signed in and only the network holds the profile {string}', async (world: CoreWorld, content: string) => {
  await k(world).kernl.login(await passwordAccount('alice'));
  scratch(world).pool.events.push(await passwordSigner.signEvent({ kind: 0, tags: [], content, created_at: 1_700_000_000 }));
});

Given('a mounted applet granted {string} that has said hello', async (world: CoreWorld, domain: string) => {
  const { kernl } = k(world);
  const summary = await kernl.resolve(kernl.decodePointer(`${vector(world).pubkey}:35129:chat`));
  k(world).summary = summary;
  kernl.grants.allowDomain(summary.identity, domain);
  k(world).plan = await kernl.plan(summary);
  mountFrame(world);
  const win = k(world).frame?.contentWindow;
  if (!win) throw new Error('mount first');
  k(world).channel = hello(world, win);
  k(world).channel.port1.postMessage({ type: 'shell.ready', id: 'ready-1' });
  await settle();
});

async function publish(world: CoreWorld, event: Record<string, unknown>): Promise<void> {
  k(world).channel?.port1.postMessage({ type: 'relay.publish', id: 'publish-1', event });
  await settle();
}

When('the applet publishes a kind {int} event with content {string} over its port', async (world: CoreWorld, kind: number, content: string) => {
  await publish(world, { kind, content, tags: [], created_at: Math.floor(Date.now() / 1000) });
});

When('the applet publishes a bare kind {int} template over its port', async (world: CoreWorld, kind: number) => {
  await publish(world, { kind });
});

When('the applet publishes a template whose kind is the text {string} over its port', async (world: CoreWorld, kind: string) => {
  await publish(world, { kind, content: '', tags: [], created_at: Math.floor(Date.now() / 1000) });
});

When('the applet sends {string} for a kind {int} event over its port', async (world: CoreWorld, type: string, kind: number) => {
  k(world).channel?.port1.postMessage({ type, id: `${type}-1`, event: { kind, content: '', tags: [['p', 'a1'.repeat(32)]], created_at: Math.floor(Date.now() / 1000) } });
  await settle();
});

When('the applet sends {string} without an id or an event over its port', async (world: CoreWorld, type: string) => {
  k(world).channel?.port1.postMessage({ type });
  await settle();
});

When('a rogue window registered outside the shell is granted {string}, sends its hello and publishes a kind {int} event', async (world: CoreWorld, domain: string, kind: number) => {
  const win = {} as Window;
  const windowId = 'rogue-publisher';
  const identity = { dTag: 'rogue', hash: 'ce'.repeat(32) };
  k(world).kernl.grants.allowDomain(identity, domain);
  originRegistry.register(win, windowId, { dTag: identity.dTag, aggregateHash: identity.hash });
  const channel = hello(world, win);
  k(world).rogue = { windowId, channel };
  channel.port1.postMessage({ type: 'shell.ready', id: 'ready-1' });
  channel.port1.postMessage({ type: 'relay.publish', id: 'publish-1', event: { kind, content: '{"name":"rogue"}', tags: [], created_at: Math.floor(Date.now() / 1000) } });
  await settle();
});

function onlyPrompt(world: CoreWorld): ConsentPrompt {
  const { prompts } = k(world).record;
  expect(prompts).toHaveLength(1);
  return prompts[0] as ConsentPrompt;
}

Then('the host was asked {string} marked {string} for applet {string}', async (world: CoreWorld, title: string, severity: string, dTag: string) => {
  await vi.waitFor(() => expect(k(world).record.prompts.length).toBeGreaterThan(0), { timeout: 2000 });
  const { summary } = onlyPrompt(world);
  expect(summary).toMatchObject({ title, severity, applet: { dTag, hash: vector(world).hash } });
  expect(summary.event.sig).toBe('');
});

Then('the consent prompt lines are:', (world: CoreWorld, table: DataTable) => {
  const expected = table.hashes().map((row) => ({
    label: row.label,
    ...(row.before ? { before: row.before } : {}),
    ...(row.after ? { after: row.after } : {}),
  }));
  expect(onlyPrompt(world).summary.lines).toEqual(expected);
});

When('the host answers the consent prompt with {word}', async (world: CoreWorld, answer: string) => {
  onlyPrompt(world).resolve(answer === 'yes');
  await settle();
});

Then('the host was not asked for consent', (world: CoreWorld) => {
  expect(k(world).record.prompts).toEqual([]);
});

function publishResult(world: CoreWorld): Record<string, unknown> | undefined {
  return k(world).received.find((entry) => entry.type === 'relay.publish.result');
}

Then("the applet's publish succeeded", (world: CoreWorld) => {
  expect(publishResult(world)).toMatchObject({ ok: true, id: 'publish-1' });
});

Then("the applet's publish failed with {string}", (world: CoreWorld, error: string) => {
  expect(publishResult(world)).toEqual({ type: 'relay.publish.result', id: 'publish-1', ok: false, error });
});

Then('the applet received {string} failing with {string}', (world: CoreWorld, type: string, error: string) => {
  expect(k(world).received.find((entry) => entry.type === type)).toMatchObject({ ok: false, error });
});

function published(world: CoreWorld): number[] {
  return scratch(world).pool.calls.filter((call) => call.method === 'publish').map((call) => call.event?.kind ?? -1);
}

Then('the fake pool published nothing', (world: CoreWorld) => {
  expect(published(world)).toEqual([]);
});

Then('the fake pool published a kind {int} event', (world: CoreWorld, kind: number) => {
  expect(published(world)).toEqual([kind]);
});
