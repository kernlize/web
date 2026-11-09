import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import { MemoryStorage } from '../../../../packages/core/features/steps/world.ts';
import type { AppletHandle, AppletSummary, BuiltinApplet, FrameLike, KernlHost, MountPlan, ShellKernl } from '../../src/shell/contract.ts';
import { createPreviewKernl } from '../../src/shell/preview-kernl.ts';
import type { PortLike } from '../../src/shell/preview-port.ts';

const HTML = '<!doctype html><html><head><title>Shipped</title></head><body><p id="shipped">shipped applet</p></body></html>';
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

interface FakePort extends PortLike {
  readonly posted: Array<Record<string, unknown>>;
  started: boolean;
  closed: boolean;
}

function fakePort(): FakePort {
  const port: FakePort = {
    onmessage: null,
    posted: [],
    started: false,
    closed: false,
    postMessage: (message) => void port.posted.push(message as Record<string, unknown>),
    start: () => void (port.started = true),
    close: () => void (port.closed = true),
  };
  return port;
}

interface BuiltinScratch {
  readonly kernl: ShellKernl;
  readonly notices: Array<{ title: string; body?: string }>;
  readonly revoked: string[];
  readonly port: FakePort;
  readonly spare: FakePort;
  summary?: AppletSummary;
  plan?: MountPlan;
  handle?: AppletHandle;
  window?: Window;
  error?: Error;
  requests: number;
}

interface BuiltinWorld {
  previewBuiltin?: BuiltinScratch;
}

function scratchOf(world: BuiltinWorld): BuiltinScratch {
  if (!world.previewBuiltin) throw new Error('ship an applet first');
  return world.previewBuiltin;
}

After((world: BuiltinWorld) => world.previewBuiltin?.kernl.destroy());

Given('a preview that ships the applet {string} starting with {string}', (world: BuiltinWorld, id: string, grants: string) => ship(world, id, grants, false));

Given('a light preview that ships the applet {string} starting with {string}', (world: BuiltinWorld, id: string, grants: string) => ship(world, id, grants, true));

Then('the shipped applet is answered {string} with the background {string}', (world: BuiltinWorld, type: string, background: string) => {
  expect(answer(world, type).theme).toMatchObject({ colors: { background } });
});

function ship(world: BuiltinWorld, id: string, grants: string, themed: boolean): void {
  const notices: BuiltinScratch['notices'] = [];
  const revoked: string[] = [];
  const host: KernlHost = {
    storage: new MemoryStorage(),
    presentConsent: () => undefined,
    notify: (notice) => void notices.push(notice),
    openLink: () => undefined,
    getVisibility: () => ({ visible: true, focused: true }),
    onRevoked: (_windowId, reason) => void revoked.push(reason),
  };
  const applet: BuiltinApplet = {
    id,
    title: 'Messages',
    description: 'Shipped with the shell.',
    sha256: sha256(HTML),
    requires: ['dm'],
    optional: ['identity', 'notify'],
    archetypes: [{ slug: 'dm', convention: 'napplet:dm/open', params: ['pubkey'] }],
    ...(grants === '' ? {} : { grants: grants.split(',') }),
    load: async () => HTML,
  };
  world.previewBuiltin = { kernl: createPreviewKernl(host, undefined, { builtins: [applet], ...(themed ? { theme: { colors: { background: '#fcfaf4', text: '#15171b', primary: '#9a5b00' } } } : {}) }), notices, revoked, port: fakePort(), spare: fakePort(), requests: 0 };
}

When('the preview resolves the address {string}', async (world: BuiltinWorld, address: string) => {
  const scratch = scratchOf(world);
  try {
    scratch.summary = await scratch.kernl.resolve(scratch.kernl.decodePointer(address));
  } catch (error) {
    scratch.error = error as Error;
  }
});

When('the preview user withdraws {string} from that applet', (world: BuiltinWorld, domain: string) => {
  const scratch = scratchOf(world);
  scratch.kernl.grants.revokeDomain((scratch.summary as AppletSummary).identity, domain);
});

When('the preview plans that summary', async (world: BuiltinWorld) => {
  const scratch = scratchOf(world);
  scratch.plan = await scratch.kernl.plan(scratch.summary as AppletSummary);
});

Then('the preview refused with {string}', (world: BuiltinWorld, reason: string) => {
  expect(scratchOf(world).error?.message).toBe(reason);
});

Then('the preview summary is the built-in applet {string}', (world: BuiltinWorld, id: string) => {
  expect(scratchOf(world).summary).toMatchObject({ builtin: true, address: `kernl:${id}`, identity: { dTag: id, hash: sha256(HTML) } });
});

Then('the preview plan offers {string}', (world: BuiltinWorld, domains: string) => {
  expect(scratchOf(world).plan?.environment.capabilities.domains).toEqual(domains.split(','));
});

Then('the preview plan holds the shipped document, sealed', (world: BuiltinWorld) => {
  const srcdoc = scratchOf(world).plan?.srcdoc ?? '';
  expect(srcdoc).toContain('<p id="shipped">shipped applet</p>');
  expect(srcdoc).toContain('Content-Security-Policy');
  expect(srcdoc).toContain('napplet.hello');
});

Then('the preview plan holds a sample document', (world: BuiltinWorld) => {
  expect(scratchOf(world).plan?.srcdoc).toContain('preview applet');
});

Then('the preview lists the applet as installed', (world: BuiltinWorld) => {
  expect(scratchOf(world).kernl.intents.installed().map((applet) => applet.address)).toEqual(['kernl:messages']);
});

async function mount(world: BuiltinWorld): Promise<void> {
  const scratch = scratchOf(world);
  scratch.summary ??= await scratch.kernl.resolve(scratch.kernl.decodePointer('kernl:messages'));
  scratch.plan = await scratch.kernl.plan(scratch.summary);
  scratch.window = Object.create(null) as Window;
  const frame: FrameLike = {
    contentWindow: scratch.window,
    srcdoc: '',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setAttribute: () => undefined,
    remove: () => undefined,
  };
  scratch.handle = scratch.kernl.mount(scratch.plan, frame);
}

function say(world: BuiltinWorld, data: unknown, ports: readonly PortLike[]): void {
  const scratch = scratchOf(world);
  const event: object = { source: scratch.window, data, ports };
  scratch.kernl.handleWindowMessage(event as MessageEvent);
}

const hello = { type: 'napplet.hello' };

Given('the shipped applet is mounted', mount);

Given('the shipped applet is mounted and has said hello', async (world: BuiltinWorld) => {
  await mount(world);
  say(world, hello, [scratchOf(world).port]);
});

When('the shipped applet says hello without a port', (world: BuiltinWorld) => say(world, hello, []));

When('the shipped applet says something else with a port', (world: BuiltinWorld) => say(world, { type: 'napplet.other' }, [scratchOf(world).spare]));

When('the shipped applet says hello with its port', (world: BuiltinWorld) => say(world, hello, [scratchOf(world).port]));

When('the shipped applet says hello with another port', (world: BuiltinWorld) => say(world, hello, [scratchOf(world).spare]));

Then('the other port was never started', (world: BuiltinWorld) => {
  expect(scratchOf(world).spare.started).toBe(false);
  expect(scratchOf(world).port.started).toBe(true);
});

Then('the shipped applet is {string}', (world: BuiltinWorld, status: string) => {
  expect(scratchOf(world).handle?.status).toBe(status);
});

async function ask(world: BuiltinWorld, envelope: Record<string, unknown>): Promise<void> {
  const scratch = scratchOf(world);
  scratch.requests += 1;
  scratch.port.onmessage?.({ data: { id: `request-${scratch.requests}`, ...envelope } });
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

When('the shipped applet asks {string} over its port', (world: BuiltinWorld, type: string) => ask(world, { type }));

When('the shipped applet sends the notification {string} saying {string}', (world: BuiltinWorld, title: string, body: string) => ask(world, { type: 'notify.send', title, body }));

When('the shipped applet sends {string} over its port', (world: BuiltinWorld, data: string) => {
  scratchOf(world).port.onmessage?.({ data });
});

When('the shipped applet sends nothing at all over its port', (world: BuiltinWorld) => {
  scratchOf(world).port.onmessage?.({ data: null });
  scratchOf(world).port.onmessage?.({ data: { id: 'no-type' } });
});

function answer(world: BuiltinWorld, type: string): Record<string, unknown> {
  const scratch = scratchOf(world);
  const found = scratch.port.posted.find((message) => message.type === type && message.id === `request-${scratch.requests}`);
  if (!found) throw new Error(`no ${type} among ${JSON.stringify(scratch.port.posted)}`);
  return found;
}

Then('the shipped applet is answered {string} with {string} true', (world: BuiltinWorld, type: string, field: string) => {
  expect(answer(world, type)[field]).toBe(true);
});

Then('the shipped applet is answered {string} with error {string}', (world: BuiltinWorld, type: string, error: string) => {
  expect(answer(world, type).error).toBe(error);
});

Then('the shipped applet is answered {string} naming {string}', (world: BuiltinWorld, type: string, names: string) => {
  const conversations = answer(world, type).conversations as Array<{ participants: Array<{ label?: string }> }>;
  expect(conversations.flatMap((conversation) => conversation.participants.map((peer) => peer.label))).toEqual(names.split(','));
});

Then('the shipped applet is answered {string} with the preview account', (world: BuiltinWorld, type: string) => {
  expect(answer(world, type).pubkey).toMatch(/^[0-9a-f]{64}$/);
});

Then('the shipped applet is answered {string} with a theme', (world: BuiltinWorld, type: string) => {
  expect(answer(world, type).theme).toMatchObject({ colors: { background: expect.any(String) } });
});

Then('the preview host was notified {string} and {string}', (world: BuiltinWorld, first: string, second: string) => {
  expect(scratchOf(world).notices.map((notice) => (notice.body === undefined ? notice.title : `${notice.title}: ${notice.body}`))).toEqual([first, second]);
});

Then('the shipped applet has no answers', (world: BuiltinWorld) => {
  expect(scratchOf(world).port.posted).toEqual([]);
});

When('the shipped applet floods the shell over its port', (world: BuiltinWorld) => {
  const scratch = scratchOf(world);
  for (let sent = 0; sent < 5000 && scratch.handle?.status !== 'revoked'; sent += 1) scratch.port.onmessage?.({ data: { type: 'relay.subscribe', id: `flood-${sent}` } });
});

Then("the shipped applet's port is closed", (world: BuiltinWorld) => {
  const { port } = scratchOf(world);
  expect(port.closed).toBe(true);
  expect(port.onmessage).toBeNull();
});

Then('the preview host heard the applet revoked for {string}', (world: BuiltinWorld, reason: string) => {
  expect(scratchOf(world).revoked).toEqual([reason]);
});

When('the shipped applet is closed', (world: BuiltinWorld) => scratchOf(world).handle?.close());

When('the preview is destroyed', (world: BuiltinWorld) => scratchOf(world).kernl.destroy());
