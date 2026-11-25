import { expect, vi } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { EMPTY, firstValueFrom } from 'rxjs';
import { RelayPool } from 'applesauce-relay';
import { PrivateKeySigner } from 'applesauce-signers';
import { AccountManager } from 'applesauce-accounts';
import { ReadonlyAccount } from 'applesauce-accounts/accounts';
import { createMessagingRegistry } from '@kernlize/messaging';
import type { ServiceHandler } from '@kehto/runtime';
import { abbreviate, catalogModule, stacksModule, messagingModule, privateDm, multiplayerModule, directoryModule, keysModule, kernlModules, mailboxesModule, peopleModule, profilesModule, searchCatalog, setupModules, socialModule, themeModule, toCatalogEntry, type AnyKernlModule, type CatalogEntry, type DomainBinding, type KernelContext, type KernlModule, type RelayTier, type ThemeApi } from '@kernlize/core';
import { blobFetcher, boot, k, settle, vector } from './kernl.js';
import { attempt, scratch, splitList, type CoreWorld } from './world.js';

const ANSWER: ServiceHandler = { handleMessage: () => undefined };
const COUNT_BINDING: DomainBinding = { methods: { count: { type: 'count.count', params: ['filters'], reply: true, result: 'count' } } };

function disposed(world: CoreWorld): string[] {
  const state = scratch(world);
  state.disposed ??= [];
  return state.disposed as string[];
}

function recorder(world: CoreWorld, id: string): AnyKernlModule {
  return { id, setup: () => ({ dispose: () => void disposed(world).push(id) }) };
}

/** Modules a scenario can name. Each is the smallest thing that shows one rule of composition. */
function named(world: CoreWorld, name: string): readonly AnyKernlModule[] {
  const modules: Record<string, () => readonly AnyKernlModule[]> = {
    kernl: () => kernlModules(),
    theme: () => [themeModule()],
    social: () => [socialModule()],
    directory: () => [directoryModule()],
    mailboxes: () => [mailboxesModule()],
    catalog: () => [catalogModule()],
    stacks: () => [stacksModule()],
    multiplayer: () => [multiplayerModule()],
    keys: () => [keysModule()],
    clock: () => [{ id: 'clock', setup: () => ({ api: { now: () => 42 } }) } satisfies KernlModule<'clock', { now(): number }>],
    'needs-clock': () => [{ id: 'needs-clock', requires: ['clock'], setup: (context) => ({ api: { time: () => context.use<{ now(): number }>('clock').now() } }) }],
    first: () => [recorder(world, 'first')],
    second: () => [recorder(world, 'second')],
    'broken-dispose': () => [{ id: 'broken-dispose', setup: () => ({ dispose: () => { throw new Error('broken'); } }) }],
    'rejecting-dispose': () => [{ id: 'rejecting-dispose', setup: () => ({ dispose: () => Promise.reject(new Error('broken')) }) }],
    'broken-setup': () => [{ id: 'broken-setup', setup: () => { throw new Error('invalid:broken-setup'); } }],
    'relay-thief': () => [{ id: 'relay-thief', setup: () => ({ services: { relay: ANSWER } }) }],
    'storage-thief': () => [{ id: 'storage-thief', setup: () => ({ services: { storage: ANSWER } }) }],
    grants: () => [{ id: 'grants', setup: () => ({ api: {} }) }],
    profiles: () => [profilesModule()],
    people: () => [peopleModule()],
    'needs-multiplayer': () => [{ id: 'needs-multiplayer', requires: ['multiplayer'], setup: () => ({}) }],
    'needs-messaging': () => [{ id: 'needs-messaging', requires: ['messaging'], setup: () => ({}) }],
    'private-messaging': () => [messagingModule({ providers: [privateDm()] })],
    'needs-downloads': () => [{ id: 'needs-downloads', requires: ['downloads'], setup: () => ({}) }],
    'needs-bridges': () => [{ id: 'needs-bridges', requires: ['bridges'], setup: () => ({}) }],
    'needs-intents': () => [{ id: 'needs-intents', requires: ['intents'], setup: () => ({}) }],
    'needs-catalog': () => [{ id: 'needs-catalog', requires: ['catalog'], setup: () => ({}) }],
    'needs-settings': () => [{ id: 'needs-settings', requires: ['settings'], setup: () => ({}) }],
    'needs-files': () => [{ id: 'needs-files', requires: ['files'], setup: () => ({}) }],
    'needs-cache': () => [{ id: 'needs-cache', requires: ['cache'], setup: () => ({}) }],
    'needs-directory': () => [{ id: 'needs-directory', requires: ['directory'], setup: () => ({}) }],
    probe: () => [{ id: 'probe', setup: (context) => ({ api: context }) } satisfies KernlModule<'probe', KernelContext>],
    'binding-only': () => [{ id: 'binding-only', setup: () => ({ extensions: { domains: ['fs'], bindings: { fs: COUNT_BINDING } } }) }],
    bound: () => [{ id: 'bound', setup: () => ({ services: { count: ANSWER }, extensions: { domains: ['count'], bindings: { count: COUNT_BINDING } } }) }],
  };
  return splitList(name).flatMap((entry) => {
    const make = modules[entry];
    if (!make) throw new Error(`no test module ${entry}`);
    return make();
  });
}

function modulesFrom(world: CoreWorld, names: string): readonly AnyKernlModule[] {
  return names === '' ? [] : named(world, names);
}

function probe(world: CoreWorld): KernelContext {
  return Reflect.get(k(world).kernl, 'probe') as KernelContext;
}

Given(/^the shell loads (kernl's|no) modules$/, (world: CoreWorld, which: string) => {
  scratch(world).modules = which === 'no' ? [] : undefined;
});

Given('the shell loads only the messaging module', (world: CoreWorld) => {
  scratch(world).modules = [messagingModule({ providers: [privateDm()] })];
});

Given('a kernl shell over that host and pool with modules {string}', (world: CoreWorld, names: string) => {
  boot(world, { modules: modulesFrom(world, names) }, blobFetcher(world));
});

When('a kernl shell is composed over that host and pool with modules {string}', async (world: CoreWorld, names: string) => {
  await attempt(world, () => boot(world, { modules: modulesFrom(world, names) }, blobFetcher(world)));
});

Then('the modules were disposed in the order {string}', (world: CoreWorld, order: string) => {
  expect(disposed(world)).toEqual(splitList(order));
});

Then('the shell has a {string} member', (world: CoreWorld, id: string) => {
  expect(id in k(world).kernl).toBe(true);
});

Then("the shell's messaging providers are {string}", (world: CoreWorld, ids: string) => {
  expect(k(world).kernl.messaging.list().map((entry) => entry.provider.id)).toEqual(splitList(ids));
});

Then('the shell has no {string} member', (world: CoreWorld, id: string) => {
  expect(id in k(world).kernl).toBe(false);
});

Then('the {string} module tells the time from {string} as {int}', (world: CoreWorld, id: string, _clock: string, now: number) => {
  expect((Reflect.get(k(world).kernl, id) as { time(): number }).time()).toBe(now);
});

Then('the composed shell starts applets with {string}', (world: CoreWorld, domains: string) => {
  expect([...k(world).kernl.grants.baselineDomains()]).toEqual(splitList(domains));
});

Then('the probe sees nobody signed in', async (world: CoreWorld) => {
  const { identity } = probe(world);
  expect(identity.pubkey()).toBeUndefined();
  expect(identity.canSign()).toBe(false);
  expect(await firstValueFrom(identity.pubkey$)).toBeUndefined();
});

Then('the probe sees the signed-in identity, able to sign', async (world: CoreWorld) => {
  const { identity } = probe(world);
  const pubkey = k(world).kernl.session?.pubkey;
  expect(identity.pubkey()).toBe(pubkey);
  expect(identity.canSign()).toBe(true);
  expect(await firstValueFrom(identity.pubkey$)).toBe(pubkey);
});

When('the probe signs a kind {int} note for the mounted window', async (world: CoreWorld, kind: number) => {
  const windowId = k(world).plan?.windowId ?? 'none';
  await attempt(world, async () => {
    scratch(world).probeSigned = await probe(world).sign(windowId, { kind, tags: [], content: 'hello', created_at: 1_700_000_000 });
  });
});

Then('the probe holds a signed kind {int} note by the signed-in identity', (world: CoreWorld, kind: number) => {
  expect(scratch(world).probeSigned).toMatchObject({ kind, pubkey: k(world).kernl.session?.pubkey });
});

Then('the probe sees {string} in the mounted window', (world: CoreWorld, dTag: string) => {
  expect(probe(world).appletOf(k(world).plan?.windowId ?? 'none')?.identity.dTag).toBe(dTag);
  expect(probe(world).appletOf('nobody')).toBeUndefined();
});

When('the probe asks for the module {string}', async (world: CoreWorld, id: string) => {
  await attempt(world, () => probe(world).use(id));
});

/** The theme module's api, as the shell reaches it: `kernl.theme`. */
function themeApi(world: CoreWorld): ThemeApi {
  return Reflect.get(k(world).kernl, 'theme') as ThemeApi;
}

When('the shell publishes a theme background {string} text {string} primary {string}', async (world: CoreWorld, background: string, text: string, primary: string) => {
  themeApi(world).publish({ colors: { background, text, primary } });
  await settle();
});

/** The palette of what the applet was told last, by the envelope that carried it. */
function paletteOf(world: CoreWorld, type: string): unknown {
  const message = k(world).received.filter((entry) => entry.type === type).at(-1);
  return (message?.theme as { colors?: unknown } | undefined)?.colors;
}

Then('the applet was told the theme changed to background {string}, text {string} and primary {string}', (world: CoreWorld, background: string, text: string, primary: string) => {
  expect(paletteOf(world, 'theme.changed')).toEqual({ background, text, primary });
});

Then('the applet was told the theme is background {string}, text {string} and primary {string}', (world: CoreWorld, background: string, text: string, primary: string) => {
  expect(paletteOf(world, 'theme.get.result')).toEqual({ background, text, primary });
});

Then('the probe reaches the modules {string}', (world: CoreWorld, ids: string) => {
  for (const id of splitList(ids)) expect(probe(world).use(id)).toBe(k(world).kernl[id as 'profiles' | 'people']);
});

Given('the pool fails every request', (world: CoreWorld) => {
  scratch(world).pool.failRequests = true;
});

When('the probe loads a follow list for {string}', async (world: CoreWorld, pubkey: string) => {
  await probe(world).loadReplaceable({ kind: 3, pubkey });
  await settle();
});

Then('the probe asked the pool for kind {int}', (world: CoreWorld, kind: number) => {
  expect(scratch(world).pool.calls.some((call) => call.filters?.some((filter) => filter.kinds?.includes(kind)))).toBe(true);
});

function setUp(world: CoreWorld, names: string, bindings: boolean): ReturnType<typeof setupModules> {
  const { kernl } = k(world);
  return setupModules(modulesFrom(world, names), {
    eventStore: kernl.eventStore,
    pool: kernl.pool,
    tiers: kernl.relays,
    storage: scratch(world).storage,
    accounts: kernl.accounts,
    consent: async () => undefined,
    replaceableLoader: () => EMPTY,
    appletOf: () => undefined,
  }, bindings);
}

Then(/^modules "([^"]*)" set up where bindings (render|do not render) answer "([^"]*)" and plan "([^"]*)"$/, (world: CoreWorld, names: string, where: string, answered: string, planned: string) => {
  const composed = setUp(world, names, where === 'render');
  expect(Object.keys(composed.services)).toEqual(splitList(answered));
  expect(composed.extensions?.domains ?? []).toEqual(splitList(planned));
  composed.dispose();
});

When('a kernl shell that owns its pool is composed with modules {string}', async (world: CoreWorld, names: string) => {
  const close = vi.spyOn(RelayPool.prototype, 'close');
  scratch(world).poolCloses = close;
  await attempt(world, () => boot(world, { modules: modulesFrom(world, names), pool: undefined }, blobFetcher(world)));
});

When('a kernl shell given its own messaging is composed with modules {string}', async (world: CoreWorld, names: string) => {
  const messaging = createMessagingRegistry();
  scratch(world).messagingCloses = vi.spyOn(messaging, 'close');
  await attempt(world, () => boot(world, { modules: modulesFrom(world, names), messaging }, blobFetcher(world)));
});

Then('the messaging the host gave was left open', (world: CoreWorld) => {
  expect(scratch(world).messagingCloses as ReturnType<typeof vi.spyOn>).not.toHaveBeenCalled();
});

Then('the pool the shell made was closed', (world: CoreWorld) => {
  const close = scratch(world).poolCloses as ReturnType<typeof vi.spyOn>;
  expect(close).toHaveBeenCalledTimes(1);
  close.mockRestore();
});

Then('the store lists the applet only when asked for incompatible ones', (world: CoreWorld) => {
  const { grants } = k(world).kernl;
  const entry = toCatalogEntry(vector(world).event) as CatalogEntry;
  const available = [...grants.availableDomains(), ...grants.baselineDomains()];
  expect(searchCatalog([entry], { available })).toEqual([]);
  expect(searchCatalog([entry], {})).toEqual([entry]);
});

When('the probe starts signing a kind {int} event for the mounted window', async (world: CoreWorld, kind: number) => {
  const windowId = k(world).plan?.windowId ?? 'none';
  scratch(world).probeSigning = probe(world).sign(windowId, { kind, tags: [], content: '{"name":"bob"}', created_at: 1_700_000_000 }).then(
    () => 'signed',
    (error: Error) => error.message,
  );
  await settle();
});

Then("the probe's signing ended with {string}", async (world: CoreWorld, outcome: string) => {
  expect(await (scratch(world).probeSigning as Promise<string>)).toBe(outcome);
});

Given('a fresh key with no relay list', async (world: CoreWorld) => {
  scratch(world).freshKey = await new PrivateKeySigner().getPublicKey();
  scratch(world).pool.events = [];
});

Then('the shell mailboxes eventually are missing, suggesting inboxes {string}', async (world: CoreWorld, urls: string) => {
  await expect.poll(() => k(world).kernl.mailboxes.state().status, { timeout: 3000 }).toBe('missing');
  expect(k(world).kernl.mailboxes.state()).toMatchObject({ suggested: { inboxes: splitList(urls) } });
});

Given('a kernl shell over that host and pool for that fresh key, already signed in', (world: CoreWorld) => {
  const accounts = new AccountManager();
  const account = ReadonlyAccount.fromPubkey(scratch(world).freshKey as string);
  accounts.addAccount(account);
  accounts.setActive(account);
  boot(world, { accounts }, blobFetcher(world));
});

Then('the shell session label eventually is the start of that fresh key', async (world: CoreWorld) => {
  await expect.poll(() => k(world).kernl.session?.label, { timeout: 3000 }).toBe(abbreviate(scratch(world).freshKey as string));
});

Then('the probe holds the signed-in signer, and finds nothing by the name {string}', async (world: CoreWorld, id: string) => {
  expect(await probe(world).signer()?.getPublicKey()).toBe(k(world).kernl.session?.pubkey);
  expect(probe(world).find(id)).toBeUndefined();
});

Then('the probe holds no signer, and finds the {string} module', (world: CoreWorld, id: string) => {
  expect(probe(world).signer()).toBeUndefined();
  expect(probe(world).find(id)).toBe(Reflect.get(k(world).kernl, id));
});

Then('the {string} tier stays {string}', async (world: CoreWorld, tier: RelayTier, urls: string) => {
  await settle();
  expect(k(world).kernl.relays.get()[tier]).toEqual(splitList(urls));
});

Then('the shell lists its store as {string}', async (world: CoreWorld, titles: string) => {
  const listed = await Reflect.get(k(world).kernl, 'catalog').load();
  expect(listed.map((entry: CatalogEntry) => entry.title)).toEqual(splitList(titles));
});

When('the applet asks to bind {string} to {string} over its port', async (world: CoreWorld, id: string, chord: string) => {
  k(world).channel?.port1.postMessage({ type: 'keys.registerAction', id: `register-${id}`, action: { id, label: id, defaultKey: chord } });
  // Registrations are held through a window's first second (D-054); wait past it before saying there was no answer.
  const answered = (): boolean => k(world).received.some((message) => message.type === 'keys.registerAction.result');
  for (let waited = 0; waited < 2000 && !answered(); waited += 40) await settle();
});

When('the shell tries to install the resolved applet', async (world: CoreWorld) => {
  const summary = k(world).summary;
  await attempt(world, () => k(world).kernl.install(summary as NonNullable<typeof summary>));
});

When('the applet asks for remote tools over its port', async (world: CoreWorld) => {
  scratch(world).callsBefore = scratch(world).pool.calls.length;
  k(world).channel?.port1.postMessage({ type: 'cvm.discover', id: 'discover-1' });
  await settle();
});

Then('the fake pool was then asked on the {string} tier', (world: CoreWorld, tier: RelayTier) => {
  const relays = [...k(world).kernl.relays.get()[tier]];
  expect(scratch(world).pool.calls.slice(scratch(world).callsBefore as number).some((call) => call.relays.length > 0 && call.relays.every((relay) => relays.includes(relay)))).toBe(true);
});

Given('a kernl shell over that host and pool whose remote tools look on {string}', (world: CoreWorld, relays: string) => {
  boot(world, { remoteTools: { relays: splitList(relays), registry: [] } }, blobFetcher(world));
});

Then('the fake pool was then asked on {string}', (world: CoreWorld, relays: string) => {
  const wanted = splitList(relays);
  expect(scratch(world).pool.calls.slice(scratch(world).callsBefore as number).some((call) => call.relays.length > 0 && call.relays.every((relay) => wanted.includes(relay)))).toBe(true);
});
