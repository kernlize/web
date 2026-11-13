import { createHash } from 'node:crypto';
import type { Page, WebSocketRoute } from '@playwright/test';
import { nip04, nip19, nip44 } from 'nostr-tools';
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate, type VerifiedEvent } from 'nostr-tools/pure';

/**
 * A network for the live shell that exists only inside the browser under test: relays answered
 * through `routeWebSocket`, blob servers through `route`. The live shell, its relay pool, the
 * blob fetcher and the verifier all run for real against it; nothing leaves the machine.
 */

export const APPLET_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Feed</title></head><body><h1>Feed applet</h1><p id="ok">it runs</p></body></html>';

export interface SignedApplet {
  readonly event: VerifiedEvent;
  readonly hash: string;
  readonly pubkey: string;
  /** The applet's address, with the given relay hints. */
  address(relays: readonly string[]): string;
}

export interface AppletOptions {
  readonly servers: readonly string[];
  readonly requires?: readonly string[];
  readonly optional?: readonly string[];
}

/** Sign a named applet manifest whose artifact is {@link APPLET_HTML}. */
export function signApplet(options: AppletOptions): SignedApplet {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const hash = createHash('sha256').update(APPLET_HTML).digest('hex');
  const event = finalizeEvent({
    kind: 35129,
    created_at: 1_790_000_000,
    content: 'A feed of things.',
    tags: [
      ['d', 'feed'],
      ['x', hash],
      ['title', 'Feed applet'],
      ...(options.requires ?? ['identity', 'outbox']).map((domain) => ['R', domain]),
      ...(options.optional ?? ['config', 'theme', 'cvm']).map((domain) => ['O', domain]),
      ...options.servers.map((server) => ['server', server]),
    ],
  }, secret);
  return { event, hash, pubkey, address: (relays) => nip19.naddrEncode({ kind: 35129, pubkey, identifier: 'feed', relays: [...relays] }) };
}

/** What a relay in the fake network does with a request. */
export type RelayBehaviour = 'holds' | 'empty' | 'down' | 'silent';

interface Filter {
  ids?: string[];
  kinds?: number[];
  authors?: string[];
  '#d'?: string[];
}

function matches(filter: Filter, event: VerifiedEvent): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  const identifiers = filter['#d'];
  return !identifiers || event.tags.some((tag) => tag[0] === 'd' && identifiers.includes(tag[1] ?? ''));
}

function answer(socket: WebSocketRoute, behaviour: RelayBehaviour, applet: SignedApplet, onLookup: () => void): void {
  if (behaviour === 'down') {
    void socket.close({ code: 1011, reason: 'down' });
    return;
  }
  socket.onMessage((raw) => {
    const [verb, subId, ...filters] = JSON.parse(String(raw)) as [string, string, ...Filter[]];
    if (verb !== 'REQ' || behaviour === 'silent') return;
    // A lookup names one applet; the store's catalogue listing asks for every manifest kind instead.
    if (filters.some((filter) => filter.ids !== undefined || filter['#d'] !== undefined)) onLookup();
    if (behaviour === 'holds' && filters.some((filter) => matches(filter, applet.event))) socket.send(JSON.stringify(['EVENT', subId, applet.event]));
    socket.send(JSON.stringify(['EOSE', subId]));
  });
}

export interface FakeNetwork {
  /** Hosts whose relay answered at least one connection, in order. */
  readonly dialled: string[];
  /** Blob URLs the shell asked for, in order. */
  readonly blobRequests: string[];
  /** Hosts asked for one particular applet, in order; the store's catalogue listing is not counted. */
  readonly lookups: string[];
}

/** The general relays the shell falls back to when an address's own relays do not produce the applet. */
export const GENERAL_RELAYS = ['relay.damus.io', 'nos.lol', 'relay.primal.net'] as const;

/** The same behaviour for every general relay. */
export function generalRelays(behaviour: RelayBehaviour): Record<string, RelayBehaviour> {
  return Object.fromEntries(GENERAL_RELAYS.map((host) => [host, behaviour]));
}

/**
 * Route every secure websocket and the named blob hosts. A relay host not listed is down, so the
 * shell's built-in servers never reach the real network from a test.
 */
export async function fakeNetwork(page: Page, applet: SignedApplet, relays: Readonly<Record<string, RelayBehaviour>>, blobs: Readonly<Record<string, 'has' | 'down'>>): Promise<FakeNetwork> {
  const network: FakeNetwork = { dialled: [], blobRequests: [], lookups: [] };
  // Secure sockets only: every relay the shell knows is one, and a dev server's own plain socket is left alone.
  await page.routeWebSocket(/^wss:\/\//, (socket) => {
    const { host } = new URL(socket.url());
    network.dialled.push(host);
    answer(socket, relays[host] ?? 'down', applet, () => network.lookups.push(host));
  });
  for (const [host, state] of Object.entries(blobs)) {
    await page.route(`https://${host}/**`, async (route) => {
      network.blobRequests.push(route.request().url());
      if (state === 'down') return route.abort('connectionrefused');
      const wanted = route.request().url().endsWith(`/${applet.hash}`);
      return route.fulfill(wanted
        ? { status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: APPLET_HTML }
        : { status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
    });
  }
  return network;
}

export interface SignerExtension {
  readonly pubkey: string;
  /** How often the page asked the extension for each method. */
  readonly calls: Record<string, number>;
}

/**
 * Stand in for a signing extension. Like the real ones it defines `window.nostr` in every frame
 * and carries each request across the page as window messages, which the shell's own message
 * handler therefore sees. The key is made for the test and never leaves this process.
 */
export async function installSignerExtension(page: Page, options: { readonly encrypts?: boolean } = {}): Promise<SignerExtension> {
  const secret = generateSecretKey();
  const extension: SignerExtension = { pubkey: getPublicKey(secret), calls: {} };
  const sealed = (peer: string): Uint8Array => nip44.v2.utils.getConversationKey(secret, peer);
  // Encryption is offered only when the test asks: an extension without it is how a provider learns it cannot run.
  const ciphers: Readonly<Record<string, (peer: string, text: string) => string | Promise<string>>> = {
    'nip04.encrypt': (peer, text) => nip04.encrypt(secret, peer, text),
    'nip04.decrypt': (peer, text) => nip04.decrypt(secret, peer, text),
    'nip44.encrypt': (peer, text) => nip44.v2.encrypt(text, sealed(peer)),
    'nip44.decrypt': (peer, text) => nip44.v2.decrypt(text, sealed(peer)),
  };
  await page.context().exposeBinding('__testSigner', (_source, method: string, params: unknown[]) => {
    extension.calls[method] = (extension.calls[method] ?? 0) + 1;
    if (method === 'getPublicKey') return extension.pubkey;
    if (method === 'signEvent') return finalizeEvent(params[0] as EventTemplate, secret);
    const cipher = options.encrypts ? ciphers[method] : undefined;
    if (cipher) return cipher(params[0] as string, params[1] as string);
    throw new Error(`the test signer does not do ${method}`);
  });
  await page.addInitScript((encrypts) => {
    const signer = (window as unknown as { __testSigner?: (method: string, params: unknown[]) => Promise<unknown> }).__testSigner;
    const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
    window.addEventListener('message', (event) => {
      const data = event.data as { type?: string; id?: string; method?: string; params?: unknown[]; result?: unknown; error?: string } | null;
      if (event.source !== window || !data?.id) return;
      if (data.type === 'nostr-request' && signer) {
        signer(data.method ?? '', data.params ?? []).then(
          (result) => window.postMessage({ type: 'nostr-response', id: data.id, result }, '*'),
          (error: Error) => window.postMessage({ type: 'nostr-response', id: data.id, error: error.message }, '*'),
        );
      }
      if (data.type === 'nostr-response') {
        const waiting = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) waiting?.reject(new Error(data.error));
        else waiting?.resolve(data.result);
      }
    });
    const ask = (method: string, params: unknown[] = []): Promise<unknown> => new Promise((resolve, reject) => {
      const id = `nostr-${Math.random().toString(36).slice(2)}`;
      pending.set(id, { resolve, reject });
      window.postMessage({ type: 'nostr-request', id, method, params }, '*');
    });
    const cipher = (name: string) => ({
      encrypt: (peer: string, text: string) => ask(`${name}.encrypt`, [peer, text]),
      decrypt: (peer: string, text: string) => ask(`${name}.decrypt`, [peer, text]),
    });
    const signing = { getPublicKey: () => ask('getPublicKey'), signEvent: (event: unknown) => ask('signEvent', [event]) };
    Object.defineProperty(window, 'nostr', { value: encrypts ? { ...signing, nip04: cipher('nip04'), nip44: cipher('nip44') } : signing });
  }, options.encrypts === true);
  return extension;
}
