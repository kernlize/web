import { lastValueFrom } from 'rxjs';
import { expect, vi } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { decodeAddressPointer } from 'applesauce-core/helpers';
import { createWindowManager, type AppletSummary, type CatalogEntry, type HandlerPrompt, type KernlHost, type WindowManager } from '@kernlize/core';
import { boot, k } from './kernl.js';
import { attempt, createFakeFrame, scratch, signManifest, splitList, type CoreWorld, type ManifestVector } from './world.js';

const WAIT = { timeout: 3000, interval: 10 };

interface IntentWindow {
  readonly id: string;
  readonly channel: MessageChannel;
  readonly received: Array<Record<string, unknown>>;
}

interface RunningApplet {
  vector: ManifestVector;
  summary?: AppletSummary;
  readonly windows: IntentWindow[];
}

function latest(applet: RunningApplet): IntentWindow | undefined {
  return applet.windows.at(-1);
}

interface IntentShell {
  readonly applets: Map<string, RunningApplet>;
  readonly opened: string[];
  readonly prompts: HandlerPrompt[];
  readonly focused: string[];
  readonly blobs: Map<string, string>;
  opening: 'open' | 'fail' | 'remove' | 'close';
  catalog?: readonly CatalogEntry[];
  stack?: WindowManager;
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

async function run(world: CoreWorld, name: string, grant: boolean, options?: { readonly focus?: boolean }): Promise<string> {
  const { kernl } = k(world);
  const summary = await resolve(world, name);
  if (grant) kernl.grants.allowDomain(summary.identity, 'intent');
  const plan = await kernl.plan(summary);
  const frame = createFakeFrame();
  const handle = kernl.mount(plan, frame);
  const manager = shell(world).stack;
  manager?.open(plan.windowId, options);
  manager?.attach(plan.windowId, handle);
  const entry = applet(world, name);
  const channel = new MessageChannel();
  const received: IntentWindow['received'] = [];
  channel.port1.onmessage = (event) => void received.push(event.data as Record<string, unknown>);
  kernl.handleWindowMessage(windowMessage(frame.contentWindow as Window, { type: 'napplet.hello' }, [channel.port2]));
  // The injected binding announces itself once its port is bound; that registers the session.
  channel.port1.postMessage({ type: 'shell.ready' });
  entry.windows.push({ id: plan.windowId, channel, received });
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
    applets: new Map([[source, { vector: chat, windows: [] }], [handler, { vector: profiles, windows: [] }]]),
    opened: [],
    prompts: [],
    focused: [],
    blobs: new Map([[chat.hash, chat.html], [profiles.hash, profiles.html]]),
    opening: 'open',
  };
  scratch(world).intentShell = state;
  scratch(world).pool.events = [chat.event, profiles.event];
  const host: Partial<KernlHost> = {
    fetchBlob: async (sha256) => new TextEncoder().encode(state.blobs.get(sha256)),
    chooseHandler: async (prompt) => void state.prompts.push(prompt),
    focusApplet(windowId) {
      state.focused.push(windowId);
      state.stack?.focus(windowId);
    },
  };
  if (canOpen) {
    host.openApplet = async (address, options) => {
      state.opened.push(address);
      const name = decodeAddressPointer(address)?.identifier ?? '';
      if (state.opening === 'fail') throw new Error('the desktop broke');
      if (state.opening === 'remove') {
        k(world).kernl.intents.uninstall(catalogIdOf(world, name));
        return undefined;
      }
      const windowId = await run(world, name, false, options);
      if (state.opening === 'close') k(world).kernl.applets().find((handle) => handle.windowId === windowId)?.close();
      return windowId;
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

When('the shell streams the store', async (world: CoreWorld) => {
  shell(world).catalog = await lastValueFrom(k(world).kernl.catalog.stream({ emitMs: 0 }));
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

When('the user opens another copy of {string} with the receiving grant', async (world: CoreWorld, name: string) => {
  await run(world, name, true);
});

When('its publisher releases {string} taking {string}', async (world: CoreWorld, name: string, convention: string) => {
  const entry = applet(world, name);
  const previous = entry.vector;
  const slug = convention.slice('napplet:'.length).split('/')[0] as string;
  entry.vector = await signManifest({
    dTag: name,
    title: 'Profiles',
    requires: [],
    html: `<!doctype html><title>profiles: ${convention}</title>`,
    extraTags: [['z', slug], ['i', convention, 'pubkey']],
    createdAt: previous.event.created_at + 1,
  });
  shell(world).blobs.set(entry.vector.hash, entry.vector.html);
  const pool = scratch(world).pool;
  pool.events = pool.events.map((event) => (event.id === previous.event.id ? entry.vector.event : event));
});

Given('the user grants {string} to the new release of {string}', async (world: CoreWorld, domain: string, name: string) => {
  const summary = await resolve(world, name);
  k(world).kernl.grants.allowDomain(summary.identity, domain);
});

function waitFor(world: CoreWorld, name: string, type: string, id?: string): Promise<Record<string, unknown>> {
  return vi.waitFor(() => {
    const found = latest(applet(world, name))?.received.findLast((entry) => entry.type === type && (id === undefined || entry.id === id));
    if (!found) throw new Error(`no ${type} yet`);
    return found;
  }, WAIT);
}

When('{string} asks who can take {string}', async (world: CoreWorld, name: string, archetype: string) => {
  latest(applet(world, name))?.channel.port1.postMessage({ type: 'intent.available', id: 'a1', archetype });
  await waitFor(world, name, 'intent.available.result');
});

Then('{string} hears that {string} can {string}', async (world: CoreWorld, name: string, title: string, action: string) => {
  const result = await waitFor(world, name, 'intent.available.result');
  const availability = result.availability as { available: boolean; candidates: Array<{ title: string; actions: string[] }> };
  expect(availability.available).toBe(true);
  expect(availability.candidates.map((candidate) => [candidate.title, candidate.actions])).toEqual([[title, [action]]]);
});

Given('the host puts {string} in front in Stacked', (world: CoreWorld, front: string) => {
  const manager = createWindowManager({ layout: 'stacked' });
  for (const applet of shell(world).applets.values()) {
    for (const { id } of applet.windows) {
      manager.open(id);
      manager.attach(id, k(world).kernl.applets().find((handle) => handle.windowId === id)!);
    }
  }
  manager.focus(latest(applet(world, front))!.id);
  shell(world).stack = manager;
});

Then('only {string} is shown and focused in the stack', (world: CoreWorld, name: string) => {
  const state = shell(world).stack!.snapshot();
  const id = latest(applet(world, name))!.id;
  expect(state.windows.filter((window) => !window.minimised).map((window) => window.id)).toEqual([id]);
  expect(state.focusedId).toBe(id);
  expect(state.windows).toHaveLength(2);
});

When(/^"([^"]+)" invokes "([^"]+)"( with a no-focus hint)?$/, async (world: CoreWorld, name: string, uri: string, noFocus: string | undefined) => {
  const [, archetype = '', action = '', key = '', value = ''] = /^napplet:([^/]+)\/([^?]+)\?([^=]+)=(.*)$/.exec(uri) ?? [];
  const request = { archetype, action, convention: `napplet:${archetype}/${action}`, payload: { [key]: value }, ...(noFocus ? { behavior: { focus: false } } : {}) };
  const source = latest(applet(world, name))!;
  const id = `invoke-${source.received.filter((entry) => entry.type === 'intent.invoke.result').length + 1}`;
  source.channel.port1.postMessage({ type: 'intent.invoke', id, request });
  await waitFor(world, name, 'intent.invoke.result', id);
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

Then('{string} received no intent', (world: CoreWorld, name: string) => {
  expect(latest(applet(world, name))!.received.filter((entry) => entry.type === 'intent.deliver')).toEqual([]);
});

When('the person brings {string} forward and returns to {string}', async (world: CoreWorld, handler: string, front: string) => {
  const manager = shell(world).stack!;
  manager.focus(latest(applet(world, handler))!.id);
  await waitFor(world, handler, 'shell.init');
  manager.focus(latest(applet(world, front))!.id);
});

Then('both copies of {string} are still open and only the latest received the request', (world: CoreWorld, name: string) => {
  const windows = applet(world, name).windows;
  expect(windows).toHaveLength(2);
  const open = k(world).kernl.applets().map((handle) => handle.windowId);
  expect(open).toEqual(expect.arrayContaining(windows.map(({ id }) => id)));
  expect(windows.map(({ received }) => received.filter((entry) => entry.type === 'intent.deliver').length)).toEqual([0, 1]);
});

Then('{string} did not receive the request', (world: CoreWorld, name: string) => {
  expect(latest(applet(world, name))?.received).not.toContainEqual(expect.objectContaining({ type: 'intent.deliver' }));
});

Then('the host was asked to open {string}', (world: CoreWorld, name: string) => {
  expect(shell(world).opened.map((address) => decodeAddressPointer(address)?.identifier)).toEqual([name]);
});

async function expectNotice(world: CoreWorld, title: string, body: string): Promise<void> {
  await vi.waitFor(() => expect(k(world).record.notices).toContainEqual({ title, body, tone: 'warning' }), WAIT);
}

Then('the user was told {string}', async (world: CoreWorld, title: string) => {
  await vi.waitFor(() => expect(k(world).record.notices).toContainEqual(expect.objectContaining({ title, tone: 'warning' })), WAIT);
});

Then('the user was told {string} and asked to show it before retrying', (world: CoreWorld, title: string) =>
  expectNotice(world, title, 'Show the applet and try again. Check that it has the grant to receive requests.'),
);

Then('the user was told {string} because it needs the receiving grant', (world: CoreWorld, title: string) =>
  expectNotice(world, title, 'It needs "opening other applets" switched on in its grants to receive requests from other applets.'),
);

Then('the user was told {string} because that release does not take it', (world: CoreWorld, title: string) => expectNotice(world, title, 'This release does not take that request.'));

Then('the user was told {string} because it could not be opened', (world: CoreWorld, title: string) => expectNotice(world, title, 'It could not be opened.'));

Then("the shell asked the public relays for the account's handler preferences", async (world: CoreWorld) => {
  const pubkey = k(world).kernl.accounts.active?.pubkey;
  await vi.waitFor(() => {
    const call = scratch(world).pool.calls.find((entry) => entry.filters?.[0]?.kinds?.includes(31129));
    expect(call).toMatchObject({ relays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'], filters: [{ kinds: [31129], authors: [pubkey] }] });
  }, WAIT);
});

Then('the host brought {string} forward', (world: CoreWorld, name: string) => {
  expect(shell(world).focused).toEqual([latest(applet(world, name))?.id]);
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

Given('a handler opened by the host closes before it can receive a request', (world: CoreWorld) => {
  shell(world).opening = 'close';
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
