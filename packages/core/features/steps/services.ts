import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { EventStore } from 'applesauce-core';
import { PrivateKeySigner } from 'applesauce-signers';
import { AccountManager } from 'applesauce-accounts';
import { PrivateKeyAccount } from 'applesauce-accounts/accounts';
import type { ShellAdapter } from '@kehto/shell';
import type { NappletMessage } from '@napplet/core';
import type { BridgeContext, BridgeRegistry, TorrentBackend } from '@kernlize/bridges';
import type { MessagingBackend, MessagingRegistry } from '@kernlize/messaging';
import { createMemoryBackend } from '@kernlize/messaging';
import {
  createDefaultBridges,
  createDefaultMessaging,
  createKernlServices,
  createRuntimeFirewallHooks,
  createShellAdapter,
  isTheme,
  resourceInitFor,
  wrapAccountSigner,
  type KernlServices,
  type RelayTiers,
} from '@kernlize/core';
import { allowAllSigning, scratch, signEvent, splitList, type CoreWorld } from './world.js';

interface ServicesScratch {
  services: KernlServices;
  sent: NappletMessage[];
  notices: Array<{ title: string; body?: string; windowId?: string; tone: string }>;
  links: string[];
  bridgeCalls: Array<{ uri: string; requester: BridgeContext['requester'] }>;
  pubkey: string;
  bridges: BridgeRegistry;
  signer: PrivateKeySigner;
}

const IDENTITY = { dTag: 'chat', aggregateHash: 'ab'.repeat(32) };

function state(world: CoreWorld): ServicesScratch {
  const value = scratch(world).services as ServicesScratch | undefined;
  if (!value) throw new Error('create services first');
  return value;
}

function fakeBridges(calls: ServicesScratch['bridgeCalls']): BridgeRegistry {
  return {
    register: () => undefined,
    list: () => [],
    forScheme: () => undefined,
    async resolve(uri, context) {
      calls.push({ uri, requester: context.requester });
      return { kind: 'bytes', response: new Response('bytes', { status: 200, headers: { 'content-type': 'text/plain' } }) };
    },
  };
}

async function build(world: CoreWorld, options: { signer?: boolean; theme?: Record<string, unknown> } = {}): Promise<void> {
  const s = scratch(world);
  const signer = new PrivateKeySigner();
  const pubkey = await signer.getPublicKey();
  const account = PrivateKeyAccount.fromKey(signer.key);
  const bridgeCalls: ServicesScratch['bridgeCalls'] = [];
  const bridges = fakeBridges(bridgeCalls);
  const notices: ServicesScratch['notices'] = [];
  const links: string[] = [];
  const messaging = createDefaultMessaging({ storage: s.storage });
  const theme = options.theme;
  const services = createKernlServices({
    pool: s.pool,
    tiers: s.tiers as RelayTiers,
    eventStore: s.eventStore as EventStore,
    auth: { getSigner: () => (options.signer === false ? null : wrapAccountSigner(account)) },
    consent: allowAllSigning,
    host: {
      notify: (notice) => void notices.push(notice),
      openLink: (url) => void links.push(url),
    },
    bridges,
    messaging,
    ...(isTheme(theme) ? { theme } : {}),
    resolveIdentity: (windowId) => (windowId === 'w1' ? IDENTITY : null),
  });
  s.services = { services, sent: [], notices, links, bridgeCalls, pubkey, bridges, signer } satisfies ServicesScratch;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
}

Given('kernl services with a signing account and a fake bridge registry', async (world: CoreWorld) => {
  await build(world);
});

Given('kernl services with the theme {string}', async (world: CoreWorld, theme: string) => {
  await build(world, { theme: JSON.parse(theme) as Record<string, unknown> });
});

Given('the signing account publishes a relay list writing to {string}', async (world: CoreWorld, url: string) => {
  const writes = splitList(url).map((relay) => ['r', relay, 'write']);
  const event = await state(world).signer.signEvent({ kind: 10002, tags: [...writes, ['r', 'wss://purplepag.es', 'read']], content: '', created_at: 1_700_000_000 });
  (scratch(world).eventStore as EventStore).add(event);
});

Given('kernl services without a signer', async (world: CoreWorld) => {
  await build(world, { signer: false });
});

Then('the service registry has {string}', (world: CoreWorld, names: string) => {
  expect(Object.keys(state(world).services.registry)).toEqual(splitList(names));
});

When('service {string} handles {string} from window {string}', async (world: CoreWorld, name: string, raw: string, windowId: string) => {
  const s = state(world);
  const handler = s.services.registry[name];
  if (!handler) throw new Error(`no service ${name}`);
  s.sent = [];
  handler.handleMessage(windowId, JSON.parse(raw) as NappletMessage, (message) => void s.sent.push(message));
  await settle();
});

Then('the host was notified {string} with body {string} for window {string}', (world: CoreWorld, title: string, body: string, windowId: string) => {
  expect(state(world).notices.at(-1)).toEqual({ title, body, windowId, tone: 'info' });
});

Then('the host was notified {string} without a body for window {string}', (world: CoreWorld, title: string, windowId: string) => {
  expect(state(world).notices.at(-1)).toEqual({ title, windowId, tone: 'info' });
});

Then('the host opened {string}', (world: CoreWorld, url: string) => {
  expect(state(world).links.at(-1)).toBe(url);
});

Then('the host opened {int} links', (world: CoreWorld, count: number) => {
  expect(state(world).links).toHaveLength(count);
});

function fields(message: NappletMessage): Record<string, unknown> {
  return Object.fromEntries(Object.entries(message));
}

function lastOfType(world: CoreWorld, type: string): Record<string, unknown> {
  const found = state(world).sent.filter((message) => message.type === type).at(-1);
  if (!found) throw new Error(`no ${type} among ${state(world).sent.map((message) => message.type).join(',')}`);
  return fields(found);
}

Then('the service replied with a {string} whose {string} is {string}', (world: CoreWorld, type: string, field: string, value: string) => {
  expect(lastOfType(world, type)[field]).toBe(value);
});

Then('the service replied with a {string} whose {string} is the signing pubkey', (world: CoreWorld, type: string, field: string) => {
  expect(lastOfType(world, type)[field]).toBe(state(world).pubkey);
});

Then('the service replied with a {string} whose theme primary is {string}', (world: CoreWorld, type: string, primary: string) => {
  const theme = lastOfType(world, type).theme as { colors: { primary: string } };
  expect(theme.colors.primary).toBe(primary);
});

Then('the service replied with a {string}', (world: CoreWorld, type: string) => {
  expect(lastOfType(world, type)).toBeDefined();
});

async function waitForReply(world: CoreWorld, type: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 300; i += 1) {
    const found = state(world).sent.find((message) => message.type === type);
    if (found) return fields(found);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`no ${type} among ${state(world).sent.map((message) => message.type).join(',')}`);
}

Then('the service eventually replied with a {string}', async (world: CoreWorld, type: string) => {
  expect(await waitForReply(world, type)).toBeDefined();
});

Then('the service eventually replied with a {string} carrying {int} events', async (world: CoreWorld, type: string, count: number) => {
  const reply = await waitForReply(world, type);
  expect(reply.events, JSON.stringify(reply)).toHaveLength(count);
});

Then('the service eventually replied with a {string} whose {string} is true', async (world: CoreWorld, type: string, field: string) => {
  const reply = await waitForReply(world, type);
  expect(reply[field], JSON.stringify(reply)).toBe(true);
});

Then('the service eventually replied with a {string} whose {string} is false', async (world: CoreWorld, type: string, field: string) => {
  expect((await waitForReply(world, type))[field]).toBe(false);
});

Then('the service replied with envelope types containing {string}', (world: CoreWorld, types: string) => {
  const seen = state(world).sent.map((message) => message.type);
  for (const type of splitList(types)) expect(seen).toContain(type);
});

Then('the theme {string} is not a theme', (_world: CoreWorld, raw: string) => {
  expect(isTheme(JSON.parse(raw) as Record<string, unknown> | undefined)).toBe(false);
});

Then('the fake bridges resolved {string} for applet {string}', (world: CoreWorld, uri: string, dTag: string) => {
  expect(state(world).bridgeCalls).toEqual([{ uri, requester: { dTag, hash: IDENTITY.aggregateHash } }]);
});

Then('the resource init for window {string} names {string} as requester', (_world: CoreWorld, windowId: string, requester: string) => {
  const init = resourceInitFor({ resolveIdentity: () => null }, { signal: new AbortController().signal, windowId });
  expect(init.requester).toBe(requester);
  expect('headers' in init).toBe(false);
  expect(resourceInitFor({ resolveIdentity: () => null }, { signal: new AbortController().signal }).requester).toBe(requester);
});

Then('the resource init keeps headers when the service passes them', () => {
  const init = resourceInitFor({ resolveIdentity: () => IDENTITY }, { signal: new AbortController().signal, windowId: 'w1', headers: { range: 'bytes=0-1' } });
  expect(init.headers).toEqual({ range: 'bytes=0-1' });
  expect(init.requester).toEqual({ dTag: 'chat', hash: IDENTITY.aggregateHash });
});

Given('a kernl shell adapter', (world: CoreWorld) => {
  const s = scratch(world);
  const accounts = new AccountManager();
  const unrouted: unknown[] = [];
  const adapter = createShellAdapter({
    pool: s.pool,
    tiers: s.tiers as RelayTiers,
    accounts,
    consent: allowAllSigning,
    services: state(world).services.registry,
    resolveEnvironment: (_identity, available) => available,
    onNappletRevoked: () => undefined,
    filterNappletMessage: (windowId) => (windowId === 'hidden' ? 'defer' : 'dispatch'),
    getFocusContext: (windowId) => ({ focused: windowId === 'focused' }),
    runtimeFirewall: createRuntimeFirewallHooks({ storage: scratch(world).storage, onEvent: () => undefined }),
    onUnroutedMessage: (info) => void unrouted.push(info),
  });
  s.adapter = adapter;
  s.unrouted = unrouted;
});

function adapter(world: CoreWorld): ShellAdapter {
  return scratch(world).adapter as ShellAdapter;
}

Then('the adapter creates no windows, has no worker relay, forwards no hotkeys and shows update banners', (world: CoreWorld) => {
  const a = adapter(world);
  expect(a.windowManager.createWindow({ title: 'x', class: 'y' })).toBeNull();
  expect(a.workerRelay.getWorkerRelay()).toBeNull();
  expect(a.hotkeys.executeHotkeyFromForward({ key: 'a', code: 'KeyA', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })).toBeUndefined();
  expect(a.config.getNappUpdateBehavior()).toBe('banner');
  expect(a.auth.getUserPubkey()).toBeNull();
});

Then('the adapter verifies a signed event and rejects a forged one', async (world: CoreWorld) => {
  const event = await signEvent({ kind: 1, content: 'ok' });
  expect(await adapter(world).crypto.verifyEvent(event)).toBe(true);
  const forged = { ...(JSON.parse(JSON.stringify(event)) as typeof event), content: 'tampered' };
  expect(await adapter(world).crypto.verifyEvent(forged)).toBe(false);
});

Then('the adapter advertises the link domain and its services', (world: CoreWorld) => {
  expect(adapter(world).link?.isAvailable()).toBe(true);
  expect(Object.keys(adapter(world).services ?? {})).toContain('relay');
  expect(adapter(world).relayPool.getRelayPool()).not.toBeNull();
});

When('the adapter adds {string} to tier {string} and {string} to tier {string}', (world: CoreWorld, url1: string, tier1: string, url2: string, tier2: string) => {
  adapter(world).relayConfig.addRelay(tier1, url1);
  adapter(world).relayConfig.addRelay(tier2, url2);
});

When('the adapter removes {string} from tier {string} and {string} from tier {string}', (world: CoreWorld, url1: string, tier1: string, url2: string, tier2: string) => {
  adapter(world).relayConfig.removeRelay(tier1, url1);
  adapter(world).relayConfig.removeRelay(tier2, url2);
});

Then('the adapter relay config has outbox {string}', (world: CoreWorld, urls: string) => {
  const config = adapter(world).relayConfig.getRelayConfig();
  expect(config.outbox).toEqual(splitList(urls));
  expect(config.discovery.length).toBeGreaterThan(0);
  expect(config.super.length).toBeGreaterThan(0);
});

Then('the adapter has no network suggestions', (world: CoreWorld) => {
  expect(adapter(world).relayConfig.getNip66Suggestions()).toBeNull();
});

Then('the adapter keeps a restrictive ACL and asks the shell about focus and every port message', (world: CoreWorld) => {
  const shell = adapter(world);
  expect(shell.aclDefaultPolicy).toBe('restrictive');
  expect([shell.getFocusContext?.('focused'), shell.getFocusContext?.('other')]).toEqual([{ focused: true }, { focused: false }]);
  expect([shell.filterNappletMessage?.('hidden', { type: 'relay.subscribe' }), shell.filterNappletMessage?.('w1', { type: 'relay.subscribe' })]).toEqual(['defer', 'dispatch']);
  expect(shell.firewallPersistence?.load()).toBeNull();
});

Then('the adapter forwards unrouted messages when asked to', (world: CoreWorld) => {
  adapter(world).onUnroutedMessage?.({ origin: 'null', reason: 'no-source-window' });
  expect(scratch(world).unrouted).toHaveLength(1);
  const silent = createShellAdapter({
    pool: scratch(world).pool,
    tiers: scratch(world).tiers as RelayTiers,
    accounts: new AccountManager(),
    consent: allowAllSigning,
    services: {},
    resolveEnvironment: (_identity, available) => available,
    onNappletRevoked: () => undefined,
    filterNappletMessage: () => 'dispatch',
    getFocusContext: () => ({ focused: true }),
    runtimeFirewall: createRuntimeFirewallHooks({ storage: scratch(world).storage, onEvent: () => undefined }),
  });
  expect(silent.onUnroutedMessage).toBeUndefined();
});

function messaging(world: CoreWorld): MessagingRegistry {
  return scratch(world).messaging as MessagingRegistry;
}

Given('the default messaging registry over empty storage', (world: CoreWorld) => {
  scratch(world).messaging = createDefaultMessaging({ storage: scratch(world).storage });
});

Given('the default messaging registry over empty storage with a {string} backend', (world: CoreWorld, id: string) => {
  const backends: Record<string, () => MessagingBackend> = { [id]: () => createMemoryBackend() };
  scratch(world).messaging = createDefaultMessaging({ storage: scratch(world).storage, backends });
});

When('the default messaging registry is created again over the same storage with a {string} backend', (world: CoreWorld, id: string) => {
  const backends: Record<string, () => MessagingBackend> = { [id]: () => createMemoryBackend() };
  scratch(world).messaging = createDefaultMessaging({ storage: scratch(world).storage, backends });
});

Then('provider {string} is unavailable because {string}', (world: CoreWorld, id: string, reason: string) => {
  expect(messaging(world).get(id)?.availability).toEqual({ available: false, reason });
});

Then('provider {string} is available', (world: CoreWorld, id: string) => {
  expect(messaging(world).get(id)?.availability).toEqual({ available: true });
});

Then('creating the {string} backend throws {string}', (world: CoreWorld, id: string, reason: string) => {
  expect(() => messaging(world).get(id)?.provider.createBackend()).toThrow(reason);
});

When('provider {string} is enabled', (world: CoreWorld, id: string) => {
  messaging(world).enable(id);
});

Then('provider {string} reports enabled', (world: CoreWorld, id: string) => {
  expect(messaging(world).get(id)?.enabled).toBe(true);
});

Then('storage key {string} lists {string} as enabled', (world: CoreWorld, key: string, id: string) => {
  const stored = JSON.parse(scratch(world).storage.getItem(key) ?? '{}') as { enabled?: string[] };
  expect(stored.enabled).toContain(id);
});

/** A torrent backend that records the hashes it was given. */
export function fakeTorrentBackend(asked: string[]): TorrentBackend {
  return {
    add: async (infoHash) => {
      asked.push(infoHash);
      return { id: `download:${asked.length}`, name: infoHash };
    },
  };
}

Given('the default bridge registry', (world: CoreWorld) => {
  scratch(world).bridgeRegistry = createDefaultBridges();
});

Given('the default bridge registry with a hand-off opener', (world: CoreWorld) => {
  const opened: string[] = [];
  scratch(world).handoffOpened = opened;
  scratch(world).bridgeRegistry = createDefaultBridges({ handoff: (uri) => void opened.push(uri) });
});

Given('the default bridge registry with a hand-off opener and a torrent backend', (world: CoreWorld) => {
  const opened: string[] = [];
  const asked: string[] = [];
  scratch(world).handoffOpened = opened;
  scratch(world).torrentAsked = asked;
  scratch(world).bridgeRegistry = createDefaultBridges({ handoff: (uri) => void opened.push(uri), torrent: fakeTorrentBackend(asked) });
});

Then('the hand-off opener was never called', (world: CoreWorld) => {
  expect(scratch(world).handoffOpened).toEqual([]);
});

Then('the torrent backend was asked for {string}', (world: CoreWorld, hash: string) => {
  expect(scratch(world).torrentAsked).toEqual([hash]);
});

Then('bridge for scheme {string} hands off to the device', (world: CoreWorld, scheme: string) => {
  expect((scratch(world).bridgeRegistry as BridgeRegistry).forScheme(scheme)?.availability()).toEqual({ available: true, handoff: true });
});

When('the default bridges resolve {string}', async (world: CoreWorld, uri: string) => {
  await (scratch(world).bridgeRegistry as BridgeRegistry).resolve(uri, { requester: 'shell' });
});

Then('the hand-off opener was called once with {string}', (world: CoreWorld, uri: string) => {
  expect(scratch(world).handoffOpened).toEqual([uri]);
});

Then('the bridges are {string}', (world: CoreWorld, ids: string) => {
  expect((scratch(world).bridgeRegistry as BridgeRegistry).list().map((bridge) => bridge.id)).toEqual(splitList(ids));
});

Then('bridge for scheme {string} is unavailable because {string}', (world: CoreWorld, scheme: string, reason: string) => {
  expect((scratch(world).bridgeRegistry as BridgeRegistry).forScheme(scheme)?.availability()).toEqual({ available: false, reason });
});

Then('bridge for scheme {string} is available', (world: CoreWorld, scheme: string) => {
  expect((scratch(world).bridgeRegistry as BridgeRegistry).forScheme(scheme)?.availability()).toEqual({ available: true });
});
