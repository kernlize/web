import { expect } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import { createSlskdClient } from '../../src/clients/slskd';
import type { ClientEndpoint, SoulseekClient } from '../../src/clients/types';
import { startFakeSlskd, type FakeSlskd, type SlskdFault } from './fake-slskd';
import { expectReason, reasonOf } from './world';

type Json = Record<string, unknown>;

interface SlskdWorld {
  slskd?: FakeSlskd;
  slskdCredentials?: Omit<ClientEndpoint, 'url'>;
  slskdTimeoutMs?: number;
  slskdClient?: SoulseekClient;
  slskdAnswer?: unknown;
  slskdError?: unknown;
  slskdSearch?: string;
  slskdTransfer?: string;
  slskdPeer?: string;
}

const NOTHING = Symbol('nothing answered yet');

function daemon(world: SlskdWorld): FakeSlskd {
  if (!world.slskd) throw new Error('no slskd daemon');
  return world.slskd;
}

/** One client for the whole scenario, as the shell keeps one: what it remembers between requests is part of what is specified. */
function client(world: SlskdWorld): SoulseekClient {
  world.slskdClient ??= createSlskdClient({
    endpoint: { url: daemon(world).url, ...world.slskdCredentials },
    ...(world.slskdTimeoutMs === undefined ? {} : { timeoutMs: world.slskdTimeoutMs }),
  });
  return world.slskdClient;
}

async function ask(world: SlskdWorld, work: (slskd: SoulseekClient) => Promise<unknown>): Promise<unknown> {
  world.slskdAnswer = NOTHING;
  world.slskdError = undefined;
  try {
    world.slskdAnswer = await work(client(world));
  } catch (error) {
    world.slskdError = error;
  }
  return world.slskdAnswer;
}

function fault(world: SlskdWorld, request: string, rest: Omit<SlskdFault, 'method' | 'path'>): void {
  const [method = '', path = ''] = request.split(' ');
  daemon(world).faults.push({ method, path: new RegExp(`^/api/v0${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), ...rest });
}

/** Ids are the daemon's own random ones, so a feature names them `$search` and `$transfer`. */
function withIds(world: SlskdWorld, text: string): string {
  return text.replaceAll('$search', world.slskdSearch ?? '').replaceAll('$transfer', world.slskdTransfer ?? '');
}

function search(world: SlskdWorld): string {
  if (world.slskdSearch === undefined) throw new Error('no search was started');
  return world.slskdSearch;
}

function transfer(world: SlskdWorld): { readonly id: string; readonly peer: string } {
  if (world.slskdTransfer === undefined || world.slskdPeer === undefined) throw new Error('no download was queued');
  return { id: world.slskdTransfer, peer: world.slskdPeer };
}

async function startSearch(world: SlskdWorld, text: string, options: { username?: string; timeoutMs: number; limit: number }): Promise<void> {
  const started = (await ask(world, (slskd) => slskd.startSearch(text, options))) as { id: string } | typeof NOTHING;
  if (started !== NOTHING) world.slskdSearch = started.id;
}

After(async (world: SlskdWorld) => {
  await world.slskd?.close();
});

Given('a slskd daemon', async (world: SlskdWorld) => {
  world.slskd = await startFakeSlskd();
});

Given('the slskd daemon asks for the key {string}', (world: SlskdWorld, apiKey: string) => {
  daemon(world).lock = { ...daemon(world).lock, apiKey };
});

Given('the slskd daemon asks for the name {string} and the password {string}', (world: SlskdWorld, username: string, password: string) => {
  daemon(world).lock = { ...daemon(world).lock, username, password };
});

Given('the slskd daemon is signed in to the network', (world: SlskdWorld) => {
  daemon(world).online = true;
});

Given('the slskd daemon is from before downloads were answered with what was queued', (world: SlskdWorld) => {
  daemon(world).answersWithQueued = false;
});

Given('the slskd daemon is switched off', async (world: SlskdWorld) => {
  await daemon(world).close();
});

Given('the slskd daemon will answer {string} with status {int} and body {string}', (world: SlskdWorld, request: string, status: number, body: string) => {
  fault(world, request, { kind: 'answer', status, body });
});

Given('the slskd daemon will hang up on {string}', (world: SlskdWorld, request: string) => {
  fault(world, request, { kind: 'hang-up' });
});

Given('the slskd daemon will stay silent on {string}', (world: SlskdWorld, request: string) => {
  fault(world, request, { kind: 'silence' });
});

Given('the slskd peer {string} shares:', (world: SlskdWorld, username: string, listing: string) => {
  daemon(world).peers.set(username, JSON.parse(listing) as Json);
});

Given('the slskd peer {string} is online', (world: SlskdWorld, username: string) => {
  daemon(world).peers.set(username, { directories: [], directoryCount: 0, lockedDirectories: [], lockedDirectoryCount: 0 });
});

Given('the slskd peer {string} cannot be reached', (world: SlskdWorld, username: string) => {
  daemon(world).peers.set(username, 'unreachable');
});

Given('the slskd daemon holds a finished search {string} with these answers:', (world: SlskdWorld, id: string, answers: string) => {
  daemon(world).searches.set(id, { id, searchText: 'someone else asked', state: 'InProgress', isComplete: false, responses: [] });
  daemon(world).finishSearch(id, JSON.parse(answers) as Json[]);
  world.slskdSearch = id;
});

Given('the slskd client knows of a search {string}', (world: SlskdWorld, id: string) => {
  world.slskdSearch = id;
});

Given('the slskd client knows of a transfer {string} from the peer {string}', (world: SlskdWorld, id: string, peer: string) => {
  world.slskdTransfer = id;
  world.slskdPeer = peer;
});

Given('the slskd client holds the key {string}', (world: SlskdWorld, apiKey: string) => {
  world.slskdCredentials = { apiKey };
});

Given('the slskd client holds the name {string} and the password {string}', (world: SlskdWorld, username: string, password: string) => {
  world.slskdCredentials = { username, password };
});

Given('the slskd client holds only the name {string}', (world: SlskdWorld, username: string) => {
  world.slskdCredentials = { username };
});

Given('the slskd client holds only the password {string}', (world: SlskdWorld, password: string) => {
  world.slskdCredentials = { password };
});

Given('the slskd client waits at most {int} ms for an answer', (world: SlskdWorld, timeoutMs: number) => {
  world.slskdTimeoutMs = timeoutMs;
});

When('the slskd daemon starts again and forgets its sessions', (world: SlskdWorld) => {
  daemon(world).restart();
});

When('the slskd client asks which version is running', async (world: SlskdWorld) => {
  await ask(world, (slskd) => slskd.probe());
});

When('the slskd client asks whether the daemon is signed in', async (world: SlskdWorld) => {
  await ask(world, (slskd) => slskd.state());
});

When('the slskd client searches for {string}', async (world: SlskdWorld, text: string) => {
  await startSearch(world, JSON.parse(`"${text}"`) as string, { timeoutMs: 15_000, limit: 500 });
});

When('the slskd client searches for {string} for {float} ms keeping at most {float} files', async (world: SlskdWorld, text: string, timeoutMs: number, limit: number) => {
  await startSearch(world, text, { timeoutMs, limit });
});

When('the slskd client searches the peer {string} for {string} keeping at most {int} files', async (world: SlskdWorld, username: string, text: string, limit: number) => {
  await startSearch(world, text, { username, timeoutMs: 15_000, limit });
});

When('the slskd daemon finishes the search with these answers:', (world: SlskdWorld, answers: string) => {
  daemon(world).finishSearch(search(world), JSON.parse(answers) as Json[]);
});

When('the slskd client reads the search', async (world: SlskdWorld) => {
  await ask(world, (slskd) => slskd.searchResults(search(world)));
});

When('the slskd client stops the search', async (world: SlskdWorld) => {
  await ask(world, (slskd) => slskd.stopSearch(search(world)));
});

When('the slskd client forgets the search', async (world: SlskdWorld) => {
  await ask(world, (slskd) => slskd.deleteSearch(search(world)));
});

When('the slskd client browses the peer {string}', async (world: SlskdWorld, username: string) => {
  await ask(world, (slskd) => slskd.browse(username));
});

When('the slskd client downloads {string} of size {string} from the peer {string}', async (world: SlskdWorld, path: string, size: string, username: string) => {
  const queued = (await ask(world, (slskd) => slskd.download({ username, path: JSON.parse(`"${path}"`) as string, size }))) as { id: string } | typeof NOTHING;
  world.slskdPeer = username;
  if (queued !== NOTHING) world.slskdTransfer = queued.id;
});

When('the slskd daemon reports the transfer as:', (world: SlskdWorld, report: string) => {
  const { id } = transfer(world);
  daemon(world).transfers.set(id, { ...daemon(world).transfers.get(id), ...(JSON.parse(report) as Json) });
});

When('the slskd daemon reports the transfer in state {string} saying {string}', (world: SlskdWorld, state: string, exception: string) => {
  const { id } = transfer(world);
  daemon(world).transfers.set(id, { ...daemon(world).transfers.get(id), state, ...(exception === '' ? {} : { exception }) });
});

When('the slskd client reads the transfer', async (world: SlskdWorld) => {
  const { id, peer } = transfer(world);
  await ask(world, (slskd) => slskd.transfer(peer, id));
});

When('the slskd client reads the transfer as one from the peer {string}', async (world: SlskdWorld, peer: string) => {
  await ask(world, (slskd) => slskd.transfer(peer, transfer(world).id));
});

When('the slskd client cancels the transfer', async (world: SlskdWorld) => {
  const { id, peer } = transfer(world);
  await ask(world, (slskd) => slskd.cancel(peer, id, false));
});

When('the slskd client cancels the transfer and has the daemon forget it', async (world: SlskdWorld) => {
  const { id, peer } = transfer(world);
  await ask(world, (slskd) => slskd.cancel(peer, id, true));
});

Then('the slskd client answers:', (world: SlskdWorld, expected: string) => {
  expect(world.slskdError).toBeUndefined();
  expect(world.slskdAnswer).toEqual(JSON.parse(withIds(world, expected)));
});

Then("the slskd client answers with the daemon's own id for its transfer of {string}", (world: SlskdWorld, path: string) => {
  const filename = JSON.parse(`"${path}"`) as string;
  const held = [...daemon(world).transfers.values()].filter((entry) => entry.filename === filename);
  expect(held).toHaveLength(1);
  expect(world.slskdAnswer).toEqual({ id: held[0]?.id });
});

Then('the slskd daemon holds {int} transfer(s)', (world: SlskdWorld, transfers: number) => {
  expect(daemon(world).transfers.size).toBe(transfers);
});

Then('the slskd client answers nothing', (world: SlskdWorld) => {
  expect(world.slskdError).toBeUndefined();
  expect(world.slskdAnswer).toBeUndefined();
});

Then('the slskd transfer is {word}', (world: SlskdWorld, state: string) => {
  expect(world.slskdError).toBeUndefined();
  expect(world.slskdAnswer).toMatchObject({ state });
});

Then('the slskd transfer has failed as {string} with the words {string}', (world: SlskdWorld, failure: string, message: string) => {
  expect(world.slskdAnswer).toMatchObject({ state: 'failed', failure, message });
});

Then('the slskd transfer carries no failure', (world: SlskdWorld) => {
  expect(world.slskdAnswer).not.toHaveProperty('failure');
  expect(world.slskdAnswer).not.toHaveProperty('message');
});

Then('the slskd client fails with {string}', (world: SlskdWorld, reason: string) => {
  expect(world.slskdAnswer).toBe(NOTHING);
  expectReason(world.slskdError, reason);
});

Then('the slskd failure says exactly {string}', (world: SlskdWorld, message: string) => {
  expect(reasonOf(world.slskdError)).toBe(message);
});

Then('the slskd daemon was never asked', (world: SlskdWorld) => {
  expect(daemon(world).requests).toEqual([]);
});

Then('the slskd daemon was asked {string} {int} time(s)', (world: SlskdWorld, request: string, times: number) => {
  const asked = daemon(world).requests.filter((entry) => withIds(world, request) === `${entry.method} ${entry.path.replace('/api/v0', '')}`);
  expect(asked).toHaveLength(times);
});

Then('the slskd daemon still holds the transfer, marked removed', (world: SlskdWorld) => {
  expect(daemon(world).transfers.get(transfer(world).id)?.removed).toBe(true);
});

Then('every slskd request carried {string} as {string} and nothing else that opens the daemon', (world: SlskdWorld, value: string, header: string) => {
  const other = header === 'x-api-key' ? 'authorization' : 'x-api-key';
  expect(daemon(world).requests.length).toBeGreaterThan(0);
  for (const request of daemon(world).requests) {
    expect(request.headers[header]).toBe(value);
    expect(request.headers[other]).toBeUndefined();
  }
});

Then('the slskd daemon received {string} with the body:', (world: SlskdWorld, request: string, body: string) => {
  const [method, path] = request.split(' ');
  const received = daemon(world).requests.find((entry) => entry.method === method && entry.path === `/api/v0${path}`);
  expect(received?.body).toBe(withIds(world, body.trim()));
});

Then('the slskd daemon holds {int} search(es)', (world: SlskdWorld, searches: number) => {
  expect(daemon(world).searches.size).toBe(searches);
});

Then('the slskd search id is a random identifier of the kind the daemon makes itself', (world: SlskdWorld) => {
  expect(search(world)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
