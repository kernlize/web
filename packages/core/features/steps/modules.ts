import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { EMPTY, firstValueFrom } from 'rxjs';
import type { ServiceHandler } from '@kehto/runtime';
import { DOWNLOAD_BINDINGS, kernlModules, setupModules, socialModule, themeModule, type AnyKernlModule, type KernelContext, type KernlModule } from '@kernlize/core';
import { blobFetcher, boot, k, settle } from './kernl.js';
import { attempt, scratch, splitList, type CoreWorld } from './world.js';

const ANSWER: ServiceHandler = { handleMessage: () => undefined };

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
    clock: () => [{ id: 'clock', setup: () => ({ api: { now: () => 42 } }) } satisfies KernlModule<'clock', { now(): number }>],
    'needs-clock': () => [{ id: 'needs-clock', requires: ['clock'], setup: (context) => ({ api: { time: () => context.use<{ now(): number }>('clock').now() } }) }],
    first: () => [recorder(world, 'first')],
    second: () => [recorder(world, 'second')],
    'broken-dispose': () => [{ id: 'broken-dispose', setup: () => ({ dispose: () => { throw new Error('broken'); } }) }],
    'rejecting-dispose': () => [{ id: 'rejecting-dispose', setup: () => ({ dispose: () => Promise.reject(new Error('broken')) }) }],
    'broken-setup': () => [{ id: 'broken-setup', setup: () => { throw new Error('invalid:broken-setup'); } }],
    'relay-thief': () => [{ id: 'relay-thief', setup: () => ({ services: { relay: ANSWER } }) }],
    grants: () => [{ id: 'grants', setup: () => ({ api: {} }) }],
    profiles: () => [{ id: 'profiles', setup: () => ({}) }],
    probe: () => [{ id: 'probe', setup: (context) => ({ api: context }) } satisfies KernlModule<'probe', KernelContext>],
    'binding-only': () => [{ id: 'binding-only', setup: () => ({ extensions: { domains: ['nzb'], bindings: { nzb: DOWNLOAD_BINDINGS.nzb } } }) }],
    bound: () => [{ id: 'bound', setup: () => ({ services: { torrent: ANSWER }, extensions: { domains: ['torrent'], bindings: { torrent: DOWNLOAD_BINDINGS.torrent } } }) }],
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

Then('the probe reaches the kernel parts {string}', (world: CoreWorld, ids: string) => {
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

Then('modules {string} set up where bindings render offer {string}', (world: CoreWorld, names: string, domains: string) => {
  const { kernl } = k(world);
  const composed = setupModules(modulesFrom(world, names), {
    eventStore: kernl.eventStore,
    pool: kernl.pool,
    tiers: kernl.relays,
    storage: scratch(world).storage,
    accounts: kernl.accounts,
    consent: async () => undefined,
    network: { profiles: kernl.profiles, people: kernl.people, replaceableLoader: () => EMPTY },
    appletOf: () => undefined,
  }, true);
  expect(composed.extensions?.domains ?? []).toEqual(splitList(domains));
  expect(Object.keys(composed.services)).toEqual(splitList(domains));
  composed.dispose();
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
