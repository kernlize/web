import { expect, vi } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { decodeAddressPointer } from 'applesauce-core/helpers';
import type { AppletSummary, CatalogEntry, HandlerPrompt, KernlHost } from '@kernlize/core';
import { boot, k } from './kernl.js';
import { attempt, createFakeFrame, scratch, signManifest, splitList, type CoreWorld, type ManifestVector } from './world.js';

const WAIT = { timeout: 3000, interval: 10 };

interface RunningApplet {
  readonly vector: ManifestVector;
  summary?: AppletSummary;
  windowId?: string;
  channel?: MessageChannel;
  readonly received: Array<Record<string, unknown>>;
}

interface IntentShell {
  readonly applets: Map<string, RunningApplet>;
  readonly opened: string[];
  readonly prompts: HandlerPrompt[];
  readonly focused: string[];
  opening: 'open' | 'fail' | 'remove';
  catalog?: readonly CatalogEntry[];
}

function shell(world: CoreWorld): IntentShell {
  return scratch(world).intentShell as IntentShell;
}

function applet(world: CoreWorld, name: string): RunningApplet {
  const value = shell(world).applets.get(name);
  if (!value) throw new Error(`no applet ${name}`);
  return value;
}

/** The fake pool answers every request with every event, so the one wanted manifest is served alone while it resolves. */
async function resolve(world: CoreWorld, name: string): Promise<AppletSummary> {
  const pool = scratch(world).pool;
  const all = pool.events;
  const { vector } = applet(world, name);
  pool.events = [vector.event];
  try {
    const summary = await k(world).kernl.resolve(k(world).kernl.decodePointer(`${vector.pubkey}:35129:${name}`));
    applet(world, name).summary = summary;
    return summary;
  } finally {
    pool.events = all;
  }
}

function windowMessage(source: Window, data: unknown, ports: MessagePort[]): MessageEvent {
  return Object.assign(new Event('message'), { source, data, ports, origin: 'null' }) as MessageEvent;
}

async function run(world: CoreWorld, name: string, grant: boolean): Promise<string> {
  const { kernl } = k(world);
  const summary = await resolve(world, name);
  if (grant) kernl.grants.allowDomain(summary.identity, 'intent');
  const plan = await kernl.plan(summary);
  const frame = createFakeFrame();
  kernl.mount(plan, frame);
  const entry = applet(world, name);
  const channel = new MessageChannel();
  channel.port1.onmessage = (event) => void entry.received.push(event.data as Record<string, unknown>);
  kernl.handleWindowMessage(windowMessage(frame.contentWindow as Window, { type: 'napplet.hello' }, [channel.port2]));
  // The injected binding announces itself once its port is bound; that registers the session.
  channel.port1.postMessage({ type: 'shell.ready' });
  entry.channel = channel;
  entry.windowId = plan.windowId;
  return plan.windowId;
}

interface ShellSetup {
  readonly canOpen: boolean;
  readonly source: string;
  readonly domain: string;
  readonly handler: string;
  readonly role: string;
}

async function setUp(world: CoreWorld, { canOpen, source, domain, handler, role }: ShellSetup): Promise<void> {
  const chat = await signManifest({ dTag: source, title: 'Chat', requires: [domain], html: '<!doctype html><title>chat</title>', createdAt: 1_700_000_000 });
  const profiles = await signManifest({
    dTag: handler,
    title: 'Profiles',
    requires: [],
    html: '<!doctype html><title>profiles</title>',
    extraTags: [['z', role], ['i', `napplet:${role}/open`, 'pubkey']],
    createdAt: 1_700_000_100,
  });
  const state: IntentShell = {
    applets: new Map([[source, { vector: chat, received: [] }], [handler, { vector: profiles, received: [] }]]),
    opened: [],
    prompts: [],
    focused: [],
    opening: 'open',
  };
  scratch(world).intentShell = state;
  scratch(world).pool.events = [chat.event, profiles.event];
  const blobs = new Map([[chat.hash, chat.html], [profiles.hash, profiles.html]]);
  const host: Partial<KernlHost> = {
    fetchBlob: async (sha256) => new TextEncoder().encode(blobs.get(sha256)),
    chooseHandler: async (prompt) => void state.prompts.push(prompt),
    focusApplet: (windowId) => void state.focused.push(windowId),
  };
  if (canOpen) {
    host.openApplet = async (address) => {
      state.opened.push(address);
      const name = decodeAddressPointer(address)?.identifier ?? '';
      if (state.opening === 'fail') throw new Error('the desktop broke');
      if (state.opening === 'remove') {
        k(world).kernl.intents.uninstall(catalogIdOf(world, name));
        return undefined;
      }
      return run(world, name, false);
    };
  }
  boot(world, { intentRetry: { intervalMs: 2, attempts: 25 } }, host);
}

Given('a kernl shell that can open applets, with {string} asking for {string} and {string} taking {string} requests', (world: CoreWorld, source: string, domain: string, handler: string, role: string) =>
  setUp(world, { canOpen: true, source, domain, handler, role }),
);

Given('a kernl shell that cannot open applets, with {string} asking for {string} and {string} taking {string} requests', (world: CoreWorld, source: string, domain: string, handler: string, role: string) => {
  k(world).kernl.destroy();
  return setUp(world, { canOpen: false, source, domain, handler, role });
});

Then('the shell offers the {string} domain', (world: CoreWorld, domain: string) => {
  expect(k(world).kernl.grants.availableDomains()).toContain(domain);
});

When('the shell lists the store', async (world: CoreWorld) => {
  shell(world).catalog = await k(world).kernl.catalog.load();
});

Then('the store lists {string}', (world: CoreWorld, titles: string) => {
  expect(shell(world).catalog?.map((entry) => entry.title)).toEqual(splitList(titles));
});

When('the shell resolves and plans {string}', async (world: CoreWorld, name: string) => {
  await k(world).kernl.plan(await resolve(world, name));
});

When('the shell installs {string} without opening it', async (world: CoreWorld, name: string) => {
  k(world).kernl.install(await resolve(world, name));
});

When('the shell uninstalls {string}', (world: CoreWorld, title: string) => {
  const found = k(world).kernl.intents.installed().find((entry) => entry.title === title);
  k(world).kernl.intents.uninstall(found?.catalogId ?? '');
});

Then("the shell's installed applets are {string}", (world: CoreWorld, titles: string) => {
  expect(k(world).kernl.intents.installed().map((entry) => entry.title)).toEqual(splitList(titles));
});

Then('installing an applet the shell did not verify is refused with {string}', async (world: CoreWorld, reason: string) => {
  const summary = applet(world, 'profiles').summary as AppletSummary;
  await attempt(world, () => k(world).kernl.install({ ...summary, identity: { ...summary.identity, hash: '0'.repeat(64) } }));
  expect(scratch(world).errors.map((error) => error.message)).toEqual([reason]);
});

Given('{string} is installed and running with {string} granted', async (world: CoreWorld, name: string) => {
  await run(world, name, true);
});

Given('{string} is running with {string} granted', async (world: CoreWorld, name: string) => {
  await run(world, name, true);
});

Given('{string} is installed and running without the receiving grant', async (world: CoreWorld, name: string) => {
  await run(world, name, false);
});

Given('{string} is installed with {string} granted', async (world: CoreWorld, name: string, domain: string) => {
  const summary = await resolve(world, name);
  k(world).kernl.grants.allowDomain(summary.identity, domain);
  k(world).kernl.install(summary);
});

function waitFor(world: CoreWorld, name: string, type: string): Promise<Record<string, unknown>> {
  return vi.waitFor(() => {
    const found = applet(world, name).received.find((entry) => entry.type === type);
    if (!found) throw new Error(`no ${type} yet`);
    return found;
  }, WAIT);
}

When('{string} asks who can take {string}', async (world: CoreWorld, name: string, archetype: string) => {
  applet(world, name).channel?.port1.postMessage({ type: 'intent.available', id: 'a1', archetype });
  await waitFor(world, name, 'intent.available.result');
});

Then('{string} hears that {string} can {string}', async (world: CoreWorld, name: string, title: string, action: string) => {
  const result = await waitFor(world, name, 'intent.available.result');
  const availability = result.availability as { available: boolean; candidates: Array<{ title: string; actions: string[] }> };
  expect(availability.available).toBe(true);
  expect(availability.candidates.map((candidate) => [candidate.title, candidate.actions])).toEqual([[title, [action]]]);
});

When('{string} invokes {string}', async (world: CoreWorld, name: string, uri: string) => {
  const [, archetype = '', action = '', key = '', value = ''] = /^napplet:([^/]+)\/([^?]+)\?([^=]+)=(.*)$/.exec(uri) ?? [];
  const request = { archetype, action, convention: `napplet:${archetype}/${action}`, payload: { [key]: value } };
  applet(world, name).channel?.port1.postMessage({ type: 'intent.invoke', id: 'i1', request });
  await waitFor(world, name, 'intent.invoke.result');
});

const catalogIdOf = (world: CoreWorld, name: string): string => `nip5d:35129:${applet(world, name).vector.pubkey}:${name}`;

Then('{string} was told the request was accepted by {string}', async (world: CoreWorld, name: string, handler: string) => {
  const result = await waitFor(world, name, 'intent.invoke.result');
  expect(result.result).toEqual({ ok: true, archetype: 'profile', action: 'open', convention: 'napplet:profile/open', handler: catalogIdOf(world, handler) });
});

Then('{string} received {string} from {string} with pubkey {string}', async (world: CoreWorld, name: string, request: string, sender: string, pubkey: string) => {
  const message = await waitFor(world, name, 'intent.deliver');
  const [archetype, action] = request.split('/');
  expect(message.delivery).toEqual({ sender: catalogIdOf(world, sender), archetype, action, convention: `napplet:${request}`, payload: { pubkey } });
});

Then('the host was asked to open {string}', (world: CoreWorld, name: string) => {
  expect(shell(world).opened.map((address) => decodeAddressPointer(address)?.identifier)).toEqual([name]);
});

async function expectNotice(world: CoreWorld, title: string, body: string): Promise<void> {
  await vi.waitFor(() => expect(k(world).record.notices).toContainEqual({ title, body, tone: 'warning' }), WAIT);
}

Then('the user was told {string} because it needs the receiving grant', (world: CoreWorld, title: string) =>
  expectNotice(world, title, 'It needs "opening other applets" switched on in its grants to receive requests from other applets.'),
);

Then('the user was told {string} because it could not be opened', (world: CoreWorld, title: string) => expectNotice(world, title, 'It could not be opened.'));

Then("the shell asked the public relays for the account's handler preferences", async (world: CoreWorld) => {
  const pubkey = k(world).kernl.accounts.active?.pubkey;
  await vi.waitFor(() => {
    const call = scratch(world).pool.calls.find((entry) => entry.filters?.[0]?.kinds?.includes(31129));
    expect(call).toMatchObject({ relays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'], filters: [{ kinds: [31129], authors: [pubkey] }] });
  }, WAIT);
});

Then('the host brought {string} forward', (world: CoreWorld, name: string) => {
  expect(shell(world).focused).toEqual([applet(world, name).windowId]);
});

When('the user removes {string} while it runs', (world: CoreWorld, title: string) => {
  const found = k(world).kernl.intents.installed().find((entry) => entry.title === title);
  k(world).kernl.intents.uninstall(found?.catalogId ?? '');
});

Then('the chooser was asked about {string} from {string} with no installed options', (world: CoreWorld, request: string, source: string) => {
  const [archetype, action] = request.split('/');
  expect(shell(world).prompts).toEqual([{ archetype, action, convention: `napplet:${request}`, source, options: [] }]);
});

Then('{string} was told the request was refused with {string}', async (world: CoreWorld, name: string, error: string) => {
  const result = await waitFor(world, name, 'intent.invoke.result');
  expect(result.result).toEqual({ ok: false, error });
});

Given('the host fails when it opens an applet', (world: CoreWorld) => {
  shell(world).opening = 'fail';
});

Given('the host removes {string} when it is asked to open it', (world: CoreWorld) => {
  shell(world).opening = 'remove';
});

Then('the user was told {string} because it could not be reached', (world: CoreWorld, title: string) => expectNotice(world, title, 'It could not be reached.'));

When('the user shares their choices and makes {string} the default for {string}', async (world: CoreWorld, name: string, archetype: string) => {
  k(world).kernl.intents.defaults.setSync(true);
  await k(world).kernl.intents.defaults.set(archetype, catalogIdOf(world, name));
});

When('the user makes {string} the default for {string} again', async (world: CoreWorld, name: string, archetype: string) => {
  await k(world).kernl.intents.defaults.set(archetype, catalogIdOf(world, name));
});

const publishedChoices = (world: CoreWorld) => scratch(world).pool.calls.filter((call) => call.method === 'publish' && call.event?.kind === 31129);

Then('the account published its choice for {string}', (world: CoreWorld, archetype: string) => {
  const [call] = publishedChoices(world);
  expect(call?.event?.pubkey).toBe(k(world).kernl.accounts.active?.pubkey);
  expect(call?.event?.tags).toEqual([['d', archetype], ['a', `35129:${applet(world, 'profiles').vector.pubkey}:profiles`]]);
});

Then('the account published {int} choice(s)', (world: CoreWorld, count: number) => {
  expect(publishedChoices(world)).toHaveLength(count);
});
