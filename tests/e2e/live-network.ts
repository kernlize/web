import { createHash } from 'node:crypto';
import type { Page, WebSocketRoute } from '@playwright/test';
import { nip19 } from 'nostr-tools';
import { finalizeEvent, generateSecretKey, getPublicKey, type VerifiedEvent } from 'nostr-tools/pure';

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
      ...(options.optional ?? ['config', 'theme']).map((domain) => ['O', domain]),
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

function answer(socket: WebSocketRoute, behaviour: RelayBehaviour, applet: SignedApplet): void {
  if (behaviour === 'down') {
    void socket.close({ code: 1011, reason: 'down' });
    return;
  }
  socket.onMessage((raw) => {
    const [verb, subId, ...filters] = JSON.parse(String(raw)) as [string, string, ...Filter[]];
    if (verb !== 'REQ' || behaviour === 'silent') return;
    if (behaviour === 'holds' && filters.some((filter) => matches(filter, applet.event))) socket.send(JSON.stringify(['EVENT', subId, applet.event]));
    socket.send(JSON.stringify(['EOSE', subId]));
  });
}

export interface FakeNetwork {
  /** Hosts whose relay answered at least one connection, in order. */
  readonly dialled: string[];
  /** Blob URLs the shell asked for, in order. */
  readonly blobRequests: string[];
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
  const network: FakeNetwork = { dialled: [], blobRequests: [] };
  // Secure sockets only: every relay the shell knows is one, and a dev server's own plain socket is left alone.
  await page.routeWebSocket(/^wss:\/\//, (socket) => {
    const { host } = new URL(socket.url());
    network.dialled.push(host);
    answer(socket, relays[host] ?? 'down', applet);
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
