import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { createBlossomBridge, parseBlossomReference, parseLocator, type BridgeContext } from '@kernlize/bridges';
import { capture, expectReason, splitList, type BridgeWorld } from './world';

/** The blob every scenario asks for, and the hash it is named by. */
const BLOB = new TextEncoder().encode('the asset pack');
const HASH = createHash('sha256').update(BLOB).digest('hex');
const APPLET: BridgeContext['requester'] = { dTag: 'game', hash: 'ab'.repeat(32) };

type Behaviour = 'holds' | 'lies' | 'missing' | 'down' | 'hangs';

interface BlossomScratch {
  readonly servers: Map<string, Behaviour>;
  readonly asked: string[];
}

const scratches = new WeakMap<BridgeWorld, BlossomScratch>();

function blossom(world: BridgeWorld): BlossomScratch {
  const value = scratches.get(world);
  if (!value) throw new Error('create a Blossom bridge first');
  return value;
}

const withHash = (text: string): string => text.replaceAll('HASH', HASH);

function answer(behaviour: Behaviour | undefined, signal: AbortSignal | null | undefined): Promise<Response> {
  switch (behaviour) {
    case 'holds':
      return Promise.resolve(new Response(BLOB, { headers: { 'content-type': 'text/html' } }));
    case 'lies':
      return Promise.resolve(new Response('something else'));
    case 'down':
      return Promise.reject(new TypeError('Failed to fetch'));
    case 'hangs':
      return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason)));
    default:
      return Promise.resolve(new Response('not here', { status: 404 }));
  }
}

function start(world: BridgeWorld, applet: readonly string[] | undefined): void {
  const value: BlossomScratch = { servers: new Map(), asked: [] };
  scratches.set(world, value);
  const fetchImpl: typeof fetch = (input, init) => {
    const url = String(input);
    value.asked.push(url);
    return answer(value.servers.get(url.slice(0, url.lastIndexOf('/'))), init?.signal);
  };
  world.bridge = createBlossomBridge({ http: { fetch: fetchImpl }, ...(applet ? { serversFor: (requester: BridgeContext['requester']) => (requester === 'shell' ? [] : applet) } : {}) });
}

Given('a Blossom bridge over fake servers', (world: BridgeWorld) => start(world, []));

Given('a Blossom bridge over fake servers that knows no applet servers', (world: BridgeWorld) => start(world, undefined));

Given('a Blossom bridge over fake servers whose applet servers are {string}', (world: BridgeWorld, servers: string) => start(world, splitList(servers)));

const BEHAVIOURS: Readonly<Record<string, Behaviour>> = { 'holds the blob': 'holds', 'answers with other bytes': 'lies', 'answers 404': 'missing', 'is unreachable': 'down', 'never answers': 'hangs' };

for (const [phrase, behaviour] of Object.entries(BEHAVIOURS)) {
  Given(`{string} ${phrase}`, (world: BridgeWorld, server: string) => void blossom(world).servers.set(server, behaviour));
}

async function resolve(world: BridgeWorld, reference: string, context: BridgeContext): Promise<void> {
  const bridge = world.bridge;
  if (!bridge) throw new Error('create a Blossom bridge first');
  await capture(world, () => bridge.resolve(parseLocator(withHash(reference)), context));
}

When('the Blossom bridge resolves {string} for an applet', (world: BridgeWorld, reference: string) => resolve(world, reference, { requester: APPLET }));

When('the Blossom bridge resolves {string} for the shell', (world: BridgeWorld, reference: string) => resolve(world, reference, { requester: 'shell' }));

When('the Blossom bridge resolves {string} for an applet that gives up', (world: BridgeWorld, reference: string) => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  return resolve(world, reference, { requester: APPLET, signal: controller.signal });
});

When('the Blossom reference {string} is read', async (world: BridgeWorld, reference: string) => {
  await capture(world, async () => parseBlossomReference(withHash(reference)));
});

Then('the Blossom reference {string} has extension {string} and hints {string}', (_world: BridgeWorld, reference: string, extension: string, hints: string) => {
  const parsed = parseBlossomReference(withHash(reference));
  expect(parsed).toEqual({ sha256: HASH, extension, servers: splitList(hints) });
});

Then('the Blossom bridge failed with {string}', (world: BridgeWorld, reason: string) => {
  expectReason(world.error, reason);
});

Then('the Blossom bridge returned the blob as {string}', async (world: BridgeWorld, type: string) => {
  expect(world.error).toBeUndefined();
  const result = world.result;
  if (result?.kind !== 'bytes') throw new Error('expected bytes');
  // The upstream content type is not trusted: the type comes from the reference's extension.
  expect(result.response.headers.get('content-type')).toBe(type);
  expect(new Uint8Array(await result.response.arrayBuffer())).toEqual(BLOB);
});

Then('the Blossom bridge asked {string}', (world: BridgeWorld, urls: string) => {
  expect(blossom(world).asked).toEqual(splitList(withHash(urls)));
});

Then('the Blossom bridge is labelled {string} with id {string}, serves {string} and is available', (world: BridgeWorld, label: string, id: string, scheme: string) => {
  expect(world.bridge).toMatchObject({ label, id, schemes: [scheme] });
  expect(world.bridge?.availability()).toEqual({ available: true });
});

Then('the Blossom bridge reveals the address, is encrypted in transit and is not public activity', (world: BridgeWorld) => {
  expect(world.bridge?.exposure).toEqual({ revealsAddress: true, encryptedInTransit: true, publicActivity: false });
});
