import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for slskd 0.26.2 that speaks its REST API over a real socket.
 *
 * Statuses, bodies and wording for the key and session handshake, `/application`,
 * `/server`, an offline daemon's refusals, unknown ids and malformed ids were copied
 * from a real slskd 0.26.2 container. Search answers, browse listings, transfers,
 * cancelling and removal were checked against two real slskd 0.26.2 daemons signed in
 * to a local Soulfind server.
 */

type Json = Record<string, unknown>;

/** A way for one kind of request to go wrong that the daemon's own logic would not produce on demand. */
export interface SlskdFault {
  readonly method: string;
  readonly path: RegExp;
  readonly kind: 'answer' | 'hang-up' | 'silence';
  readonly status?: number;
  readonly body?: string;
}

export interface SlskdRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingMessage['headers'];
  readonly body: string;
}

export interface FakeSlskd {
  readonly url: string;
  readonly requests: SlskdRequest[];
  readonly faults: SlskdFault[];
  readonly searches: Map<string, Json>;
  readonly transfers: Map<string, Json>;
  /** A peer's browse answer, or why the daemon cannot get one. */
  readonly peers: Map<string, Json | 'unreachable'>;
  lock: { apiKey?: string; username?: string; password?: string } | undefined;
  online: boolean;
  /** Versions before the queue answer existed reply 201 with nothing. */
  answersWithQueued: boolean;
  finishSearch(id: string, responses: readonly Json[]): void;
  /** Forgets every session, as the real daemon does when it starts again. */
  restart(): void;
  close(): Promise<void>;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION = '0.26.2.0';

const SERVER_OFFLINE = { state: 'None', isConnected: false, isConnecting: false, isLoggedIn: false, isLoggingIn: false, isTransitioning: false };
const SERVER_ONLINE = {
  address: 'vps.slsknet.org:2271',
  ipEndPoint: '208.76.170.59:2271',
  state: 'Connected, LoggedIn',
  isConnected: true,
  isConnecting: false,
  isLoggedIn: true,
  isLoggingIn: false,
  isTransitioning: false,
};

function notSignedIn(doing: string): string {
  return `The server connection must be connected and logged in to ${doing} (currently: Disconnected)`;
}

interface Exchange {
  readonly fake: FakeSlskd;
  readonly tokens: Set<string>;
  readonly request: SlskdRequest;
  readonly response: ServerResponse;
  readonly query: URLSearchParams;
}

function send(response: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) response.writeHead(status).end();
  else response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
}

function parseBody(exchange: Exchange): unknown {
  try {
    return JSON.parse(exchange.request.body) as unknown;
  } catch {
    return undefined;
  }
}

function isAuthorised({ fake, tokens, request }: Exchange): boolean {
  if (fake.lock === undefined) return true;
  const key = request.headers['x-api-key'];
  const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
  return (fake.lock.apiKey !== undefined && key === fake.lock.apiKey) || (bearer !== undefined && tokens.has(bearer));
}

function signIn(exchange: Exchange): void {
  const { fake, tokens, response } = exchange;
  const login = parseBody(exchange) as { username?: string; password?: string };
  if (!login.username?.trim() || !login.password?.trim()) return send(response, 400, 'Username and/or Password missing or invalid');
  if (login.username !== fake.lock?.username || login.password !== fake.lock.password) return send(response, 401);
  const token = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${randomUUID()}.signature`;
  tokens.add(token);
  const issued = Math.floor(Date.now() / 1000);
  send(response, 200, { expires: issued + 604_800, issued, name: login.username, notBefore: issued, token });
}

function application(fake: FakeSlskd): Json {
  return {
    version: { full: `${VERSION} (${VERSION}+e472ecd7)`, current: VERSION, latest: VERSION, isUpdateAvailable: false, isCanary: false, isDevelopment: false },
    pendingReconnect: false,
    pendingRestart: false,
    server: fake.online ? SERVER_ONLINE : SERVER_OFFLINE,
    connectionWatchdog: { isEnabled: false, isAttemptingConnection: false, isAwaitingVpn: false },
    relay: { mode: 'Controller', controller: { state: 'Disconnected' }, agents: [] },
    shares: { scanPending: false, scanning: false, ready: true, faulted: false, cancelled: false, scanProgress: 1, hosts: ['local'], directories: 0, files: 0 },
    rooms: [],
    users: [],
  };
}

function startSearch(exchange: Exchange): void {
  const { fake, response } = exchange;
  const asked = parseBody(exchange) as { id?: string; searchText?: string; searchTimeout?: number };
  if (!asked.searchText?.trim()) return send(response, 400, 'The field SearchText can not be null, empty, or consist of only whitespace');
  if (asked.searchTimeout !== undefined && asked.searchTimeout < 5) return send(response, 400, 'The field SearchTimeout must be between 5 and 2147483647.');
  const id = asked.id ?? randomUUID();
  const now = new Date().toISOString();
  const search = { fileCount: 0, id, isComplete: false, lockedFileCount: 0, responseCount: 0, responses: [], searchText: asked.searchText, startedAt: now, state: 'InProgress', token: 0 };
  if (!fake.online) {
    // The real daemon stores the search before it finds it cannot run it, and leaves the errored record behind.
    fake.searches.set(id, { ...search, endedAt: now, isComplete: true, state: 'Completed, Errored' });
    return send(response, 409, notSignedIn('perform a search'));
  }
  fake.searches.set(id, search);
  send(response, 200, search);
}

function searches(exchange: Exchange, id: string | undefined, tail: string | undefined): void {
  const { fake, request, response, query } = exchange;
  if (id === undefined) return request.method === 'POST' ? startSearch(exchange) : send(response, 200, [...fake.searches.values()]);
  const search = fake.searches.get(id);
  if (search === undefined) return send(response, 404);
  if (tail === 'responses') return send(response, 200, search.responses);
  if (request.method === 'GET') return send(response, 200, query.get('includeResponses') === 'true' ? search : { ...search, responses: [] });
  if (request.method === 'DELETE') {
    fake.searches.delete(id);
    return send(response, 204);
  }
  if (search.isComplete !== true) fake.searches.set(id, { ...search, isComplete: true, state: 'Completed, Cancelled', endedAt: new Date().toISOString() });
  send(response, 200);
}

function browse({ fake, response }: Exchange, username: string): void {
  if (!fake.online) return send(response, 500, notSignedIn('browse'));
  const peer = fake.peers.get(username);
  if (peer === undefined) return send(response, 404, `User ${username} appears to be offline`);
  if (peer === 'unreachable') {
    return send(response, 500, `Failed to browse user ${username}: Failed to establish a direct or indirect message connection to ${username} (203.0.113.7:2234)`);
  }
  send(response, 200, peer);
}

function listDownloads({ fake, response }: Exchange, username: string): void {
  const files = [...fake.transfers.values()].filter((transfer) => transfer.username === username && transfer.removed !== true);
  if (files.length === 0) return send(response, 404);
  const directory = String(files[0]?.filename).split('\\').slice(0, -1).join('\\');
  send(response, 200, { username, directories: [{ directory, fileCount: files.length, files }] });
}

function isUnfinished(transfer: Json, username: string, filename: string): boolean {
  return transfer.username === username && transfer.filename === filename && !String(transfer.state).includes('Completed');
}

function enqueue(exchange: Exchange, username: string): void {
  const { fake, response } = exchange;
  const asked = parseBody(exchange) as { filename: string; size: number }[];
  if (asked.length === 0) return send(response, 400, 'At least one file is required');
  if (asked.some((file) => /(^|[\\/])\.\.([\\/]|$)/.test(file.filename))) {
    return send(response, 400, 'One or more files in the request contain a dangerous path traversal segment');
  }
  if (!fake.online) return send(response, 500, notSignedIn('fetch user endpoint'));
  if (!fake.peers.has(username)) return send(response, 500, `User ${username} appears to be offline`);
  const enqueued: Json[] = [];
  const failed: Json[] = [];
  for (const file of asked) {
    if ([...fake.transfers.values()].some((transfer) => isUnfinished(transfer, username, file.filename))) {
      // The real list holds (Filename, Message) tuples, which System.Text.Json writes as empty objects.
      failed.push({});
      continue;
    }
    const now = new Date().toISOString();
    const transfer = { id: randomUUID(), username, direction: 'Download', filename: file.filename, size: file.size, state: 'Queued, Locally', requestedAt: now, enqueuedAt: now };
    fake.transfers.set(transfer.id, { ...transfer, bytesTransferred: 0, averageSpeed: 0, attempts: 0, removed: false, bytesRemaining: file.size, percentComplete: 0 });
    enqueued.push(fake.transfers.get(transfer.id) as Json);
  }
  if (fake.answersWithQueued) send(response, 201, { enqueued, failed });
  else send(response, 201);
}

function oneDownload({ fake, request, response, query }: Exchange, id: string): void {
  if (!GUID.test(id)) return send(response, 400);
  const transfer = fake.transfers.get(id);
  // 0.26.2 keeps a removed transfer and still serves it by id, marked `removed: true`; only the per-peer list leaves it out.
  if (request.method === 'GET') return transfer === undefined ? send(response, 404) : send(response, 200, transfer);
  // 0.26.2 answers 204 whether or not it has the transfer.
  if (transfer !== undefined) {
    const cancelled = String(transfer.state).includes('Completed') ? {} : { state: 'Completed, Cancelled', exception: 'A task was canceled.', endedAt: new Date().toISOString() };
    fake.transfers.set(id, { ...transfer, ...cancelled, removed: query.get('remove') === 'true' });
  }
  send(response, 204);
}

function downloads(exchange: Exchange, username: string | undefined, id: string | undefined): void {
  if (username === undefined) return send(exchange.response, 200, []);
  if (id !== undefined) return oneDownload(exchange, id);
  if (exchange.request.method === 'POST') return enqueue(exchange, username);
  listDownloads(exchange, username);
}

function route(exchange: Exchange): void {
  const { fake, request, response } = exchange;
  const [area, first, second, third] = request.path
    .replace(/^\/api\/v0\//, '')
    .split('/')
    .map(decodeURIComponent);
  if (area === 'session' && request.method === 'POST') return signIn(exchange);
  if (!isAuthorised(exchange)) return send(response, 401);
  if (area === 'application') return send(response, 200, application(fake));
  if (area === 'server') return send(response, 200, fake.online ? SERVER_ONLINE : SERVER_OFFLINE);
  if (area === 'searches') return searches(exchange, first, second);
  if (area === 'users' && first !== undefined && second === 'browse') return browse(exchange, first);
  if (area === 'transfers' && first === 'downloads') return downloads(exchange, second, third);
  send(response, 404);
}

function applyFault(fault: SlskdFault, response: ServerResponse): void {
  if (fault.kind === 'hang-up') response.destroy();
  else if (fault.kind === 'answer') response.writeHead(fault.status ?? 200, { 'content-type': 'application/json; charset=utf-8' }).end(fault.body ?? '');
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

/**
 * Starts the stand-in daemon on a free loopback port: offline, as slskd is before it
 * is given a Soulseek login, and with no lock until `lock` is set.
 */
export async function startFakeSlskd(): Promise<FakeSlskd> {
  const tokens = new Set<string>();
  const server = createServer((incoming, response) => {
    void readBody(incoming).then((body) => {
      const [path = '/', query = ''] = (incoming.url ?? '/').split('?');
      const request = { method: incoming.method ?? 'GET', path, headers: incoming.headers, body };
      fake.requests.push(request);
      const fault = fake.faults.findIndex((entry) => entry.method === request.method && entry.path.test(request.path));
      if (fault >= 0) return applyFault(fake.faults.splice(fault, 1)[0] as SlskdFault, response);
      route({ fake, tokens, request, response, query: new URLSearchParams(query) });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const fake: FakeSlskd = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests: [],
    faults: [],
    searches: new Map(),
    transfers: new Map(),
    peers: new Map(),
    lock: undefined,
    online: false,
    answersWithQueued: true,
    finishSearch(id, responses) {
      const search = fake.searches.get(id) as Json;
      const files = responses.flatMap((entry) => (entry.files ?? []) as unknown[]);
      fake.searches.set(id, { ...search, responses, responseCount: responses.length, fileCount: files.length, isComplete: true, state: 'Completed, TimedOut', endedAt: new Date().toISOString() });
    },
    restart: () => tokens.clear(),
    close: () => closeServer(server),
  };
  return fake;
}
