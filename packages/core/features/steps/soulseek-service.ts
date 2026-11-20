import { expect } from 'vitest';
import { DataTable, Given, Then, When } from 'quickpickle';
import type { SoulseekClient, SoulseekClientFile, SoulseekClientTransfer } from '@kernlize/bridges';
import type { NappletMessage, SoulseekFailure, SoulseekFile, SoulseekQuery, SoulseekTransfer } from '@napplet/core';
import { createSoulseekService, type SoulseekLimits } from '../../src/downloads/soulseek-service.js';
import type { DownloadQuestion, DownloadService } from '../../src/downloads/types.js';
import { createMemorySoulseekClient, type MemorySoulseekClient, type PeerMood } from './memory-soulseek-client.js';
import { last, scratch, splitList, type CoreWorld } from './world.js';

interface Reply {
  readonly type: string;
  readonly id: string;
  readonly value?: unknown;
  readonly error?: SoulseekFailure;
}

interface AppletWindow {
  readonly replies: Reply[];
  /** The answer to the request sent last, when one came. */
  answer?: Reply;
  query?: string;
  files: SoulseekFile[];
  transfer?: string;
  earlierTransfer?: string;
}

interface Seek {
  readonly daemon: MemorySoulseekClient;
  configured: boolean;
  clock: number;
  realClock: boolean;
  readonly limits: Partial<Record<keyof SoulseekLimits, number>>;
  readonly live: Set<string>;
  readonly windows: Map<string, AppletWindow>;
  readonly questions: DownloadQuestion[];
  reply: string;
  readonly undecided: Array<(yes: boolean) => void>;
  readonly gates: Map<string, () => void>;
  service?: DownloadService;
  serial: number;
}

const FOUND: readonly SoulseekClientFile[] = [
  { username: 'ann', path: 'a.flac', size: '30', locked: false },
  { username: 'ben', path: 'b.flac', size: '0', locked: false },
];

function seek(world: CoreWorld): Seek {
  const state = scratch(world).soulseek as Seek | undefined;
  if (!state) throw new Error('start a Soulseek daemon first');
  return state;
}

function serviceOf(state: Seek): DownloadService {
  state.service ??= createSoulseekService({
    client: (): SoulseekClient | undefined => (state.configured ? state.daemon : undefined),
    appletOf: (windowId) => (state.live.has(windowId) ? { dTag: 'crate', hash: 'cd'.repeat(32) } : undefined),
    async ask(windowId, question) {
      expect(state.live.has(windowId)).toBe(true);
      state.questions.push(question);
      if (state.reply === 'an error') throw new Error('the prompt could not be shown');
      if (state.reply === 'nothing yet') return new Promise<boolean>((resolve) => state.undecided.push(resolve));
      return state.reply === 'yes';
    },
    storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    limits: state.limits,
    ...(state.realClock ? {} : { now: () => state.clock }),
  });
  return state.service;
}

function windowOf(state: Seek, name: string): AppletWindow {
  let found = state.windows.get(name);
  if (!found) {
    found = { replies: [], files: [] };
    state.windows.set(name, found);
  }
  return found;
}

/** Everything the service and the in-memory daemon do settles within microtasks; one turn of the loop is past them all. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function learn(applet: AppletWindow, value: unknown): void {
  const record = (typeof value === 'object' && value !== null ? value : {}) as { queryId?: string; query?: SoulseekQuery; files?: SoulseekFile[]; transferId?: string };
  const queryId = record.queryId ?? record.query?.queryId;
  if (queryId !== undefined) applet.query = queryId;
  if (record.files) applet.files = record.files;
  if (record.transferId !== undefined && record.transferId !== applet.transfer) {
    if (applet.transfer !== undefined) applet.earlierTransfer = applet.transfer;
    applet.transfer = record.transferId;
  }
}

async function deliver(world: CoreWorld, name: string, message: NappletMessage & Record<string, unknown>): Promise<void> {
  const state = seek(world);
  const applet = windowOf(state, name);
  delete applet.answer;
  serviceOf(state).handler.handleMessage(`window-${name}`, message, (sent) => {
    const reply = sent as Reply;
    applet.replies.push(reply);
    if (reply.id === message.id) applet.answer = reply;
    learn(applet, reply.value);
  });
  await settle();
}

function request(world: CoreWorld, name: string, operation: string, fields: Record<string, unknown> = {}): Promise<void> {
  return deliver(world, name, { type: `soulseek.${operation}`, id: `r${++seek(world).serial}`, ...fields });
}

function answerOf(world: CoreWorld, name: string): Reply {
  const { answer } = windowOf(seek(world), name);
  if (!answer) throw new Error(`window ${name} has no answer to its last request`);
  return answer;
}

function valueOf<T>(world: CoreWorld, name: string): T {
  const answer = answerOf(world, name);
  expect(answer.error).toBeUndefined();
  return answer.value as T;
}

function queryOf(world: CoreWorld, name: string): SoulseekQuery {
  const value = valueOf<SoulseekQuery | { query: SoulseekQuery }>(world, name);
  return 'query' in value ? value.query : value;
}

function transferOf(world: CoreWorld, name: string): SoulseekTransfer {
  const value = valueOf<SoulseekTransfer | SoulseekTransfer[]>(world, name);
  return Array.isArray(value) ? last(value) : value;
}

function fill(world: CoreWorld, name: string, text: string): string {
  const applet = windowOf(seek(world), name);
  return text
    .replaceAll('$long', 'x'.repeat(1025))
    .replaceAll('$query', applet.query ?? 'none')
    .replaceAll('$file', applet.files[0]?.fileId ?? 'none')
    .replaceAll('$transfer', applet.transfer ?? 'none');
}

function filesFrom(table: DataTable, peer?: string): SoulseekClientFile[] {
  const count = (cell: string | undefined): number | undefined => (cell ? Number(cell) : undefined);
  return table.hashes().map((row) => {
    const hints = { extension: row.extension || undefined, bitrateKbps: count(row.bitrateKbps), durationSeconds: count(row.durationSeconds), sampleRateHz: count(row.sampleRateHz), bitDepth: count(row.bitDepth) };
    const locked = row.locked === undefined || row.locked === 'false' ? false : row.locked === 'true' ? true : row.locked;
    return {
      username: peer ?? row.username ?? '',
      path: row.path ?? '',
      size: row.size ?? '',
      locked: locked as boolean,
      ...Object.fromEntries(Object.entries(hints).filter(([, hint]) => hint !== undefined)),
    };
  });
}

function report(world: CoreWorld, path: string, change: Partial<SoulseekClientTransfer>): void {
  const { daemon } = seek(world);
  const { id, username, size } = daemon.transferOf(path);
  daemon.transfers.set(id, { id, username, path, size, state: 'queued', received: '0', ...change });
}

function pass(world: CoreWorld, ms: number): void {
  seek(world).clock += ms;
}

async function find(world: CoreWorld, name: string, text: string, files: readonly SoulseekClientFile[]): Promise<void> {
  await request(world, name, 'search', { request: { text } });
  seek(world).daemon.deliver(text, files);
  pass(world, 1000);
  await request(world, name, 'results', { queryId: windowOf(seek(world), name).query });
}

async function act(world: CoreWorld, name: string, action: string): Promise<void> {
  await request(world, name, action, { transferId: windowOf(seek(world), name).transfer });
}

Given('a Soulseek daemon that is signed in', (world: CoreWorld) => {
  scratch(world).soulseek = { daemon: createMemorySoulseekClient(), configured: true, clock: 1_700_000_000_000, realClock: false, limits: {}, live: new Set(), windows: new Map(), questions: [], reply: 'yes', undecided: [], gates: new Map(), serial: 0 } satisfies Seek;
});

Given('Soulseek applets run in the windows {string}', (world: CoreWorld, names: string) => {
  for (const name of splitList(names)) seek(world).live.add(`window-${name}`);
});

Given('the person will say {string} to the Soulseek question', (world: CoreWorld, reply: string) => {
  seek(world).reply = reply;
});

Given('the Soulseek daemon is {string}', (world: CoreWorld, condition: string) => {
  const state = seek(world);
  state.configured = condition !== 'not set up';
  state.daemon.signedIn = condition !== 'signed out';
  state.daemon.reachable = condition !== 'unreachable';
  state.daemon.refusesSignIn = condition === "refusing kernl's sign-in";
});

Given('the Soulseek limit {string} is {int}', (world: CoreWorld, limit: keyof SoulseekLimits, value: number) => {
  expect(seek(world).service, 'limits are fixed once the service has started').toBeUndefined();
  seek(world).limits[limit] = value;
});

Given('the Soulseek service keeps time by the real clock', (world: CoreWorld) => {
  seek(world).realClock = true;
});

Given('the Soulseek peer {string} shares:', (world: CoreWorld, peer: string, table: DataTable) => {
  seek(world).daemon.peers.set(peer, { mood: 'sharing', files: filesFrom(table, peer) });
});

Given('the Soulseek peer {string} is {string}', (world: CoreWorld, peer: string, mood: PeerMood) => {
  seek(world).daemon.peers.set(peer, { mood, files: [] });
});

Given('the next Soulseek daemon {string} fails with {string}', (world: CoreWorld, method: keyof SoulseekClient, reason: string) => {
  seek(world).daemon.failNext(method, reason);
});

Given('the Soulseek daemon takes its time over {string}', (world: CoreWorld, method: keyof SoulseekClient) => {
  const state = seek(world);
  for (const applet of state.windows.values()) applet.replies.length = 0;
  state.gates.set(method, state.daemon.hold(method));
});

Given('the Soulseek daemon picks a stopped download up again under its old id', (world: CoreWorld) => {
  seek(world).daemon.revives = true;
});

Given('window {string} has searched Soulseek for {string} and found:', async (world: CoreWorld, name: string, text: string, table: DataTable) => {
  await find(world, name, text, filesFrom(table));
});

Given('window {string} holds a Soulseek transfer that is {string}', async (world: CoreWorld, name: string, state: string) => {
  await find(world, name, 'rain', FOUND);
  await request(world, name, 'download', { fileId: windowOf(seek(world), name).files[0]?.fileId });
  const reported: Record<string, Partial<SoulseekClientTransfer>> = {
    transferring: { state: 'transferring', received: '12' },
    paused: { state: 'transferring', received: '12' },
    complete: { state: 'complete', received: '30' },
    failed: { state: 'failed', received: '12', failure: 'peer_unavailable' },
  };
  if (reported[state]) {
    report(world, 'a.flac', reported[state]);
    pass(world, 1000);
    await act(world, name, 'status');
  }
  if (state === 'paused') await act(world, name, 'pause');
  if (state === 'cancelled') await act(world, name, 'cancel');
  expect(transferOf(world, name).state).toBe(state);
});

Given('the Soulseek window {string} stops being an applet', (world: CoreWorld, name: string) => {
  seek(world).live.delete(`window-${name}`);
});

When('window {string} asks for Soulseek info', (world: CoreWorld, name: string) => request(world, name, 'info'));

When('window {string} searches Soulseek for {string}', (world: CoreWorld, name: string, text: string) => request(world, name, 'search', { request: { text } }));

When('window {string} searches the Soulseek peer {string} for {string}', (world: CoreWorld, name: string, username: string, text: string) => request(world, name, 'search', { request: { text, username } }));

When('window {string} browses the Soulseek peer {string}', (world: CoreWorld, name: string, username: string) => request(world, name, 'browse', { username }));

When('Soulseek peers answer {string} with:', (world: CoreWorld, text: string, table: DataTable) => {
  seek(world).daemon.deliver(text, filesFrom(table));
});

When('the Soulseek daemon ends the search for {string}', (world: CoreWorld, text: string) => {
  seek(world).daemon.finishSearch(text);
});

When('{int} ms pass for Soulseek', pass);

When('window {string} reads its Soulseek results', (world: CoreWorld, name: string) => request(world, name, 'results', { queryId: windowOf(seek(world), name).query }));

When('window {string} reads {int} Soulseek results after {int}', (world: CoreWorld, name: string, limit: number, after: number) => request(world, name, 'results', { queryId: windowOf(seek(world), name).query, after, limit }));

When('window {string} stops its Soulseek query', (world: CoreWorld, name: string) => request(world, name, 'stop', { queryId: windowOf(seek(world), name).query }));

When('window {string} releases its Soulseek {string}', (world: CoreWorld, name: string, kind: 'query' | 'transfer') => {
  const applet = windowOf(seek(world), name);
  return request(world, name, 'release', { kind, handle: kind === 'query' ? applet.query : applet.transfer });
});

When('window {string} downloads Soulseek file {int}', (world: CoreWorld, name: string, position: number) => request(world, name, 'download', { fileId: windowOf(seek(world), name).files[position - 1]?.fileId }));

When('window {string} asks Soulseek to {string} its transfer', act);

When('window {string} lists its Soulseek transfers', (world: CoreWorld, name: string) => request(world, name, 'transfers'));

When('window {string} reads {int} bytes of its Soulseek transfer from {string}', (world: CoreWorld, name: string, length: number, offset: string) => request(world, name, 'read', { transferId: windowOf(seek(world), name).transfer, offset, length }));

When('window {string} sends Soulseek {string} with {string}', (world: CoreWorld, name: string, operation: string, fields: string) => request(world, name, operation, JSON.parse(fill(world, name, fields)) as Record<string, unknown>));

When('window {string} sends the raw Soulseek message {string}', (world: CoreWorld, name: string, message: string) => deliver(world, name, JSON.parse(fill(world, name, message)) as NappletMessage & Record<string, unknown>));

When("window {string} learns window {string}'s Soulseek handles", (world: CoreWorld, name: string, other: string) => {
  const state = seek(world);
  const { query, files, transfer } = windowOf(state, other);
  Object.assign(windowOf(state, name), { query, files, transfer });
});

When('the Soulseek daemon reports {string} as {string} with {string} bytes', (world: CoreWorld, path: string, state: SoulseekClientTransfer['state'], received: string) => {
  report(world, path, { state, received });
});

When('the Soulseek daemon reports {string} as {string} with {string} bytes at queue position {int}', (world: CoreWorld, path: string, state: SoulseekClientTransfer['state'], received: string, queuePosition: number) => {
  report(world, path, { state, received, queuePosition });
});

When('the Soulseek daemon reports {string} as {string} with {string} bytes arriving at {int} bytes a second', (world: CoreWorld, path: string, state: SoulseekClientTransfer['state'], received: string, bytesPerSecond: number) => {
  report(world, path, { state, received, bytesPerSecond });
});

When('the Soulseek daemon reports {string} as failed because of {string}', (world: CoreWorld, path: string, failure: string) => {
  report(world, path, { state: 'failed', ...(failure ? { failure: failure as NonNullable<SoulseekClientTransfer['failure']> } : {}) });
});

When('the Soulseek daemon reports {string} as {string} bytes long', (world: CoreWorld, path: string, size: string) => {
  report(world, path, { size });
});

When('the Soulseek daemon loses the transfer of {string}', (world: CoreWorld, path: string) => {
  seek(world).daemon.lose(path);
});

When('the Soulseek peer {string} answers at last', async (world: CoreWorld, peer: string) => {
  seek(world).daemon.speak(peer);
  await settle();
});

When('the Soulseek daemon gets on with {string}', async (world: CoreWorld, method: string) => {
  seek(world).gates.get(method)?.();
  await settle();
});

When('the person answers the Soulseek question with {string}', async (world: CoreWorld, reply: string) => {
  for (const decide of seek(world).undecided.splice(0)) decide(reply === 'yes');
  await settle();
});

When('the Soulseek window {string} is closed', async (world: CoreWorld, name: string) => {
  serviceOf(seek(world)).handler.onWindowDestroyed?.(`window-${name}`);
  await settle();
});

When('the Soulseek grant of window {string} is taken back', async (world: CoreWorld, name: string) => {
  serviceOf(seek(world)).handler.onPermissionRevoked?.(`window-${name}`);
  await settle();
});

When('the Soulseek service is shut down', async (world: CoreWorld) => {
  serviceOf(seek(world)).dispose();
  await settle();
});

When('the Soulseek service is unregistered', async (world: CoreWorld) => {
  serviceOf(seek(world)).handler.onUnregistered?.();
  await settle();
});

Then('window {string} learns the Soulseek daemon is {string}', (world: CoreWorld, name: string, state: string) => {
  expect(valueOf<{ state: string }>(world, name).state).toBe(state);
});

Then('window {string} learns it cannot save Soulseek files', (world: CoreWorld, name: string) => {
  expect(valueOf<{ canSave: boolean }>(world, name).canSave).toBe(false);
});

Then('window {string} learns the Soulseek limits:', (world: CoreWorld, name: string, table: DataTable) => {
  const expected = Object.fromEntries(table.raw().map(([limit, value]) => [limit, Number(value)]));
  expect(valueOf<Record<string, unknown>>(world, name)).toMatchObject(expected);
});

Then("window {string}'s Soulseek query is {string}", (world: CoreWorld, name: string, state: string) => {
  const query = queryOf(world, name);
  expect(query).toMatchObject({ state, maxResults: seek(world).limits.maxResults ?? 500, maxPageSize: 100, timeoutMs: 30000 });
  expect(query.reason).toBeUndefined();
  expect(query.error).toBeUndefined();
});

Then("window {string}'s Soulseek query is {string} because {string}", (world: CoreWorld, name: string, state: string, reason: string) => {
  const query = queryOf(world, name);
  expect(query).toMatchObject({ state, reason });
  expect(query.error).toBeUndefined();
});

Then("window {string}'s Soulseek query has failed with {string}", (world: CoreWorld, name: string, code: string) => {
  const query = queryOf(world, name);
  expect(query).toMatchObject({ state: 'failed', error: { code } });
  expect(query.error?.message).not.toBe('');
  expect(query.reason).toBeUndefined();
});

Then("window {string}'s Soulseek query holds {int} files", (world: CoreWorld, name: string, count: number) => {
  expect(queryOf(world, name).count).toBe(count);
});

Then("window {string}'s Soulseek page lists {string}", (world: CoreWorld, name: string, paths: string) => {
  const page = valueOf<{ files: SoulseekFile[] }>(world, name);
  expect(page.files.map((file) => file.path)).toEqual(splitList(paths));
  expect(new Set(page.files.map((file) => file.fileId)).size).toBe(page.files.length);
});

Then("window {string}'s Soulseek page continues at {int}", (world: CoreWorld, name: string, next: number) => {
  expect(valueOf<{ next: number }>(world, name).next).toBe(next);
});

Then("window {string}'s Soulseek page shows:", (world: CoreWorld, name: string, table: DataTable) => {
  const columns = table.raw()[0] ?? [];
  const shown = valueOf<{ files: SoulseekFile[] }>(world, name).files.map((file) => {
    const told = new Map<string, unknown>(Object.entries(file));
    return Object.fromEntries(columns.map((column) => [column, String(told.get(column) ?? '')]));
  });
  expect(shown).toEqual(table.hashes());
});

Then("window {string}'s Soulseek transfer is {string} with {string} bytes", (world: CoreWorld, name: string, state: string, received: string) => {
  const transfer = transferOf(world, name);
  expect(transfer).toMatchObject({ state, received, maxReadBytes: 65536, transferId: windowOf(seek(world), name).transfer });
  expect(transfer.error).toBeUndefined();
});

Then("window {string}'s Soulseek transfer has failed with {string}", (world: CoreWorld, name: string, code: string) => {
  const transfer = transferOf(world, name);
  expect(transfer).toMatchObject({ state: 'failed', error: { code } });
  expect(transfer.error?.message).not.toBe('');
  expect(transfer.queuePosition).toBeUndefined();
});

Then("window {string}'s Soulseek transfer is at queue position {int}", (world: CoreWorld, name: string, position: number) => {
  expect(transferOf(world, name).queuePosition).toBe(position);
});

Then("window {string}'s Soulseek transfer arrives at {int} bytes a second", (world: CoreWorld, name: string, rate: number) => {
  expect(transferOf(world, name).bytesPerSecond).toBe(rate);
});

Then("window {string}'s Soulseek transfer shows no queue position or speed", (world: CoreWorld, name: string) => {
  const transfer = transferOf(world, name);
  expect('queuePosition' in transfer || 'bytesPerSecond' in transfer).toBe(false);
});

Then('window {string} holds {int} Soulseek transfers', (world: CoreWorld, name: string, count: number) => {
  expect(valueOf<SoulseekTransfer[]>(world, name)).toHaveLength(count);
});

Then('window {string} has the same Soulseek transfer as before', (world: CoreWorld, name: string) => {
  const applet = windowOf(seek(world), name);
  expect(valueOf<SoulseekTransfer>(world, name).transferId).toBe(applet.transfer);
  expect(applet.earlierTransfer).toBeUndefined();
});

Then('window {string} has a new Soulseek transfer', (world: CoreWorld, name: string) => {
  const applet = windowOf(seek(world), name);
  expect(applet.earlierTransfer).toBeDefined();
  expect(valueOf<SoulseekTransfer>(world, name).transferId).not.toBe(applet.earlierTransfer);
});

Then('window {string} is refused by Soulseek with {string}', (world: CoreWorld, name: string, code: string) => {
  const answer = answerOf(world, name);
  expect(answer.error?.code).toBe(code);
  expect('value' in answer).toBe(false);
});

Then('window {string} is refused by Soulseek with {string} saying {string}', (world: CoreWorld, name: string, code: string, message: string) => {
  expect(answerOf(world, name).error).toEqual({ code, message });
});

Then('window {string} is told Soulseek released {string}', (world: CoreWorld, name: string, what: string) => {
  expect(valueOf(world, name)).toEqual({ released: what === 'something' });
});

Then('window {string} got {int} Soulseek answers', (world: CoreWorld, name: string, count: number) => {
  expect(windowOf(seek(world), name).replies).toHaveLength(count);
});

Then('window {string} got {int} Soulseek answers for one transfer', (world: CoreWorld, name: string, count: number) => {
  const ids = windowOf(seek(world), name).replies.map((reply) => (reply.value as SoulseekTransfer).transferId);
  expect(ids).toHaveLength(count);
  expect(new Set(ids).size).toBe(1);
});

Then('window {string} got Soulseek answers {string}', (world: CoreWorld, name: string, expected: string) => {
  const told = windowOf(seek(world), name).replies.map((reply) => {
    const value = (reply.value ?? {}) as { released?: boolean; state?: string };
    return reply.error?.code ?? (value.released ? 'released' : value.state);
  });
  expect(told).toEqual(splitList(expected));
});

Then('the person was asked the Soulseek question {int} times', (world: CoreWorld, count: number) => {
  expect(seek(world).questions).toHaveLength(count);
});

Then('the Soulseek question is titled {string}', (world: CoreWorld, title: string) => {
  expect(last(seek(world).questions)).toMatchObject({ kind: 'session', title });
});

Then('the Soulseek question says {string}', (world: CoreWorld, words: string) => {
  expect(last(seek(world).questions).lines.map((line) => line.value).join('\n')).toContain(words);
});

Then('the Soulseek daemon was asked to {string} {int} times', (world: CoreWorld, method: keyof SoulseekClient, count: number) => {
  expect(seek(world).daemon.count(method)).toBe(count);
});

Then('the Soulseek daemon searched for {string} from {string}', (world: CoreWorld, text: string, username: string) => {
  expect([...seek(world).daemon.searches.values()]).toEqual([expect.objectContaining({ text, username })]);
  expect(last(seek(world).daemon.calls.filter((call) => call.method === 'startSearch')).args[1]).toEqual({ username, timeoutMs: 30000, limit: 500 });
});

Then('the Soulseek daemon holds {int} searches', (world: CoreWorld, count: number) => {
  expect(seek(world).daemon.searches.size).toBe(count);
});

Then('the Soulseek daemon holds {int} transfers', (world: CoreWorld, count: number) => {
  expect(seek(world).daemon.transfers.size).toBe(count);
});

Then('the Soulseek daemon holds the transfer of {string} as {string}', (world: CoreWorld, path: string, state: string) => {
  expect(seek(world).daemon.transferOf(path).state).toBe(state);
});

Then('the Soulseek daemon holds no transfer of {string}', (world: CoreWorld, path: string) => {
  expect([...seek(world).daemon.transfers.values()].filter((transfer) => transfer.path === path)).toEqual([]);
});

Then("no Soulseek answer named the daemon's own ids", (world: CoreWorld) => {
  const state = seek(world);
  const told = JSON.stringify([...state.windows.values()].flatMap((applet) => applet.replies));
  for (const id of [...state.daemon.searches.keys(), ...state.daemon.transfers.keys()]) expect(told).not.toContain(id);
  expect(told).not.toMatch(/https?:|password|apiKey/i);
});

Then('every Soulseek answer carried exactly one of a value or an error', (world: CoreWorld) => {
  const replies = [...seek(world).windows.values()].flatMap((applet) => applet.replies);
  expect(replies.length).toBeGreaterThan(0);
  for (const reply of replies) {
    expect(reply.type).toMatch(/^soulseek\.[a-z]+\.result$/);
    expect(Object.keys(reply).filter((key) => key === 'value' || key === 'error')).toHaveLength(1);
  }
});

Then('the Soulseek service takes the messages {string} and asks no further grant for any', (world: CoreWorld, names: string) => {
  const { handler } = serviceOf(seek(world));
  expect(handler.descriptor.name).toBe('soulseek');
  expect(handler.messageCapabilities).toEqual(Object.fromEntries(splitList(names).map((name) => [`soulseek.${name}`, null])));
});
