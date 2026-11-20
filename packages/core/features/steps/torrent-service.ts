import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import type { ServiceRuntimeContext } from '@kehto/runtime';
import type { NappletMessage } from '@napplet/core';
import { createTorrentService } from '../../src/downloads/torrent-service.js';
import type { DownloadQuestion, DownloadService } from '../../src/downloads/types.js';
import { memoryRouting } from './memory-routing.js';
import { MemoryTorrentClient } from './memory-torrent-client.js';
import { scratch, type CoreWorld } from './world.js';

type Wire = NappletMessage & Record<string, unknown>;

interface TorrentWindow {
  readonly windowId: string;
  readonly applet: string | undefined;
  /** Whose applet it is, when another publisher's applet goes by the same name. */
  readonly publisher?: string;
  readonly results: Wire[];
  readonly pushes: Wire[];
}

interface Torrents {
  client: MemoryTorrentClient;
  configured: boolean;
  service: DownloadService;
  windows: Map<string, TorrentWindow>;
  questions: Array<{ windowId: string; question: DownloadQuestion }>;
  answer: boolean;
  held: Array<(answer: boolean) => void> | undefined;
  jobs: Map<string, string>;
  nextId: number;
}

const STORAGE_KEY = 'kernl:torrent-jobs:v1';
/** Short enough that scenarios see several real timer ticks without waiting on them. */
const POLL_MS = 20;
const MAX_METAINFO_BYTES = 2 * 1024 * 1024;

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await pause(5);
  }
}

/** A real, canonical v1 `.torrent` for one 1000-byte file called `name`, with a tracker that carries a passkey. */
function torrentFile(name: string, extra = ''): { readonly bytes: Uint8Array; readonly infoHash: string } {
  const text = (value: string): Buffer => Buffer.from(`${Buffer.byteLength(value)}:${value}`);
  const info = Buffer.concat([Buffer.from('d6:lengthi1000e4:name'), text(name), Buffer.from('12:piece lengthi1000e6:pieces20:'), Buffer.alloc(20, 7), Buffer.from(`${extra}e`)]);
  const bytes = Buffer.concat([Buffer.from('d8:announce'), text('https://tracker.example/passkey-hunter2/announce'), Buffer.from('4:info'), info, Buffer.from('e')]);
  return { bytes: new Uint8Array(bytes), infoHash: createHash('sha1').update(info).digest('hex') };
}

/** A BitTorrent v2 torrent with no v1 piece hashes: nothing a v1 program could name. */
function v2TorrentFile(name: string): Uint8Array {
  return new Uint8Array(Buffer.from(`d4:infod6:lengthi1000e12:meta versioni2e4:name${Buffer.byteLength(name)}:${name}12:piece lengthi1000eee`));
}

const hashOf = (name: string): string => torrentFile(name).infoHash;

function torrents(world: CoreWorld): Torrents {
  const state = scratch(world).torrents as Torrents | undefined;
  if (!state) throw new Error('start the torrent program first');
  return state;
}

function windowOf(world: CoreWorld, name: string): TorrentWindow {
  const window = torrents(world).windows.get(name);
  if (!window) throw new Error(`no torrent window called ${name}`);
  return window;
}

/** Builds the service over the scenario's storage and program, as a shell does at start-up. */
function startService(world: CoreWorld, scenario: () => Torrents, pollMs: number | undefined): DownloadService {
  const windowWith = (windowId: string): TorrentWindow | undefined => [...scenario().windows.values()].find((window) => window.windowId === windowId);
  const service = createTorrentService({
    ownerOf: (windowId) => {
      const window = windowWith(windowId);
      return window?.applet === undefined ? undefined : `${window.publisher ?? 'pk'}:35129:${window.applet}`;
    },
    appletOf: (windowId) => {
      const applet = windowWith(windowId)?.applet;
      return applet === undefined ? undefined : { dTag: applet, hash: 'cd'.repeat(32) };
    },
    ask: (windowId, question) => {
      const state = scenario();
      state.questions.push({ windowId, question });
      const held = state.held;
      return held ? new Promise((resolve) => held.push(resolve)) : Promise.resolve(state.answer);
    },
    storage: scratch(world).storage,
    connections: memoryRouting(() => (scenario().configured ? scenario().client : undefined), 'transmission'),
    ...(pollMs === undefined ? {} : { pollMs }),
  });
  service.handler.onRegistered?.({
    sendToEligibleNapplet(windowId: string, message: NappletMessage) {
      windowWith(windowId)?.pushes.push(message as Wire);
      return true;
    },
  } as ServiceRuntimeContext);
  return service;
}

function begin(world: CoreWorld, configured: boolean): void {
  const state: Torrents = {
    client: new MemoryTorrentClient(), configured, windows: new Map(), questions: [], answer: true, held: undefined, jobs: new Map(), nextId: 0,
    service: startService(world, () => state, POLL_MS),
  };
  scratch(world).torrents = state;
}

After(async (world: CoreWorld) => {
  (scratch(world).torrents as Torrents | undefined)?.service.dispose();
});

/** `$hash:name`, `$magnet:name` and `$job:name` (or `$job:applet/name`) stand for values only the scenario's run knows. */
function expand(world: CoreWorld, window: TorrentWindow, text: string): string {
  const state = torrents(world);
  return text
    .replace(/\$hash:([a-z0-9-]+)/g, (_, name: string) => hashOf(name))
    .replace(/\$v2hash:([a-z0-9-]+)/g, (_, name: string) => createHash('sha256').update(name).digest('hex'))
    .replace(/\$magnet:([a-z0-9-]+)/g, (_, name: string) => `magnet:?xt=urn:btih:${hashOf(name)}&dn=${name}&tr=https%3A%2F%2Ftracker.example%2Fpasskey-hunter2%2Fannounce`)
    .replace(/\$job:(?:([a-z0-9-]+)\/)?([a-z0-9-]+)/g, (_, applet: string | undefined, name: string) => state.jobs.get(`${applet ?? window.applet}/${name}`) ?? 'no-such-job');
}

/** The forms a page can post a `.torrent` in, which JSON text cannot spell. */
function torrentValue(form: string, name: string): unknown {
  const { bytes } = torrentFile(name);
  const forms: Record<string, () => unknown> = {
    torrent: () => Buffer.from(bytes).toString('base64'),
    'torrent-bytes': () => bytes,
    'torrent-view': () => new DataView(bytes.buffer),
    'torrent-buffer': () => bytes.buffer,
    'torrent-list': () => [...bytes],
    'torrent-private': () => torrentFile(name, '7:privatei1e').bytes,
    'torrent-v2': () => v2TorrentFile(name),
    'torrent-oversized': () => new Uint8Array(MAX_METAINFO_BYTES + 1),
    'torrent-oversized-text': () => 'A'.repeat(MAX_METAINFO_BYTES * 2 + 4),
  };
  return (forms[form] as () => unknown)();
}

function parse(world: CoreWorld, window: TorrentWindow, json: string): Wire {
  return JSON.parse(expand(world, window, json), (_, value: unknown) => {
    const match = typeof value === 'string' ? /^\$(torrent[a-z0-9-]*):([a-z0-9-]+)$/.exec(value) : null;
    return match ? torrentValue(match[1] as string, match[2] as string) : value;
  }) as Wire;
}

/** Sends one request as a window, and waits for its answer unless the person is still being asked. */
async function send(world: CoreWorld, name: string, json: string, withId = true): Promise<void> {
  const state = torrents(world);
  const window = windowOf(world, name);
  const message = parse(world, window, json);
  const id = `request-${(state.nextId += 1)}`;
  const answered = window.results.length;
  const asked = state.questions.length;
  state.service.handler.handleMessage(window.windowId, withId ? { id, ...message } : message, (result) => window.results.push(result as Wire));
  if (!withId) return;
  await until(() => window.results.length > answered || (state.held !== undefined && state.questions.length > asked), `an answer to ${message.type}`);
  const ack = window.results.at(-1)?.ack as { ok?: boolean; jobId?: string } | undefined;
  const named = /\$(?:magnet|hash|torrent[a-z0-9-]*):([a-z0-9-]+)/.exec(json)?.[1];
  if (window.results.length > answered && ack?.ok && named) state.jobs.set(`${window.applet}/${named}`, ack.jobId as string);
}

function lastResult(world: CoreWorld, name: string): Wire {
  const result = windowOf(world, name).results.at(-1);
  if (!result) throw new Error(`the torrent window ${name} got no answer`);
  return result;
}

function pushesFor(world: CoreWorld, name: string, type: string, torrent: string): Wire[] {
  const window = windowOf(world, name);
  const jobId = torrents(world).jobs.get(`${window.applet}/${torrent}`);
  return window.pushes.filter((push) => push.type === type && push.jobId === jobId);
}

Given("the person's torrent program is running", (world: CoreWorld) => {
  begin(world, true);
});

Given('the person has set up no torrent program', (world: CoreWorld) => {
  begin(world, false);
});

Given('a shell that does not say how often to refresh torrents', (world: CoreWorld) => {
  const state = torrents(world);
  state.service.dispose();
  state.windows.clear();
  state.service = startService(world, () => state, undefined);
});

Given('the person takes the torrent program out of their settings', (world: CoreWorld) => {
  torrents(world).configured = false;
});

Given('the applet {string} is open in the torrent window {string}', (world: CoreWorld, applet: string, name: string) => {
  torrents(world).windows.set(name, { windowId: `window-${name}`, applet, results: [], pushes: [] });
});

Given("another publisher's applet, also called {string}, is open in the torrent window {string}", (world: CoreWorld, applet: string, name: string) => {
  torrents(world).windows.set(name, { windowId: `window-${name}`, applet, publisher: 'other-pk', results: [], pushes: [] });
});

Given('the torrent window {string} is not a live applet', (world: CoreWorld, name: string) => {
  torrents(world).windows.set(name, { windowId: `window-${name}`, applet: undefined, results: [], pushes: [] });
});

Given('the person will say no to the torrent question', (world: CoreWorld) => {
  torrents(world).answer = false;
});

Given('the person will say yes to the torrent question', (world: CoreWorld) => {
  torrents(world).answer = true;
});

Given('the person is slow to answer the torrent question', (world: CoreWorld) => {
  torrents(world).held = [];
});

When('the person answers every torrent question with yes', async (world: CoreWorld) => {
  const state = torrents(world);
  const waiting = [...state.windows.values()].reduce((sum, window) => sum + window.results.length, 0) + (state.held as unknown[]).length;
  for (const resolve of state.held as Array<(answer: boolean) => void>) resolve(true);
  state.held = undefined;
  await until(() => [...state.windows.values()].reduce((sum, window) => sum + window.results.length, 0) >= waiting, 'the held torrent requests to be answered');
});

Given('the torrent program stops answering', (world: CoreWorld) => {
  torrents(world).client.failWith('unavailable:unreachable fetch http://nas.local:9091/transmission/rpc failed for admin:hunter2');
});

Given('the torrent program stops answering when asked to {word}', (world: CoreWorld, method: string) => {
  torrents(world).client.failWith('unavailable:timeout http://nas.local:9091/', method);
});

Given("the torrent program refuses kernl's sign-in", (world: CoreWorld) => {
  torrents(world).client.failWith('denied:credentials admin:hunter2');
});

Given('the torrent program declines every torrent', (world: CoreWorld) => {
  torrents(world).client.failWith('unavailable:rejected', 'add');
});

Given('the torrent program cannot change limits', (world: CoreWorld) => {
  torrents(world).client.failWith('unavailable:unsupported', 'setLimits');
});

Given('the torrent program answers again', (world: CoreWorld) => {
  torrents(world).client.recover();
});

Given('the torrent job storage is full', (world: CoreWorld) => {
  scratch(world).storage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
});

Given('the torrent job storage holds {string}', (world: CoreWorld, json: string) => {
  const anyone: TorrentWindow = { windowId: '', applet: undefined, results: [], pushes: [] };
  scratch(world).storage.setItem(STORAGE_KEY, expand(world, anyone, json));
});

When('the shell is reloaded and starts its torrent service again', (world: CoreWorld) => {
  const state = torrents(world);
  state.windows.clear();
  state.service = startService(world, () => state, POLL_MS);
});

When('the shell detaches the torrent service', (world: CoreWorld) => {
  torrents(world).service.handler.onUnregistered?.();
});

When('the shell shuts the torrent service down', (world: CoreWorld) => {
  torrents(world).service.dispose();
});

When('the torrent window {string} is closed', (world: CoreWorld, name: string) => {
  torrents(world).service.handler.onWindowDestroyed?.(windowOf(world, name).windowId);
});

When('the person takes the torrent permission back from the window {string}', (world: CoreWorld, name: string) => {
  torrents(world).service.handler.onPermissionRevoked?.(windowOf(world, name).windowId);
});

When('the torrent program reads what is in {string}', (world: CoreWorld, name: string) => {
  torrents(world).client.learn(hashOf(name), name, false);
});

When('the torrent program reads what is in {string} but cannot tell whether it is private', (world: CoreWorld, name: string) => {
  torrents(world).client.learn(hashOf(name), name, undefined);
});

When('the torrent program has {int} of the 1000 bytes of {string}', (world: CoreWorld, bytes: number, name: string) => {
  torrents(world).client.download(hashOf(name), bytes);
});

When('the torrent program finishes {string}', (world: CoreWorld, name: string) => {
  torrents(world).client.download(hashOf(name), 1000);
});

When('the torrent program has shared {int} bytes of {string}', (world: CoreWorld, bytes: number, name: string) => {
  torrents(world).client.upload(hashOf(name), bytes);
});

When('the person removes {string} from the torrent program themselves', (world: CoreWorld, name: string) => {
  torrents(world).client.lose(hashOf(name));
});

When('the torrent program reports a problem with {string}', (world: CoreWorld, name: string) => {
  torrents(world).client.report(hashOf(name), 'Tracker https://tracker.example/passkey-hunter2/announce gave an error');
});

When('the person limits {string} in the torrent program to {int} down and {int} up', (world: CoreWorld, name: string, downloadLimit: number, uploadLimit: number) => {
  torrents(world).client.limit(hashOf(name), { downloadLimit, uploadLimit });
});

When('the torrent window {string} sends {string}', async (world: CoreWorld, name: string, json: string) => {
  await send(world, name, json);
});

When('the torrent window {string} sends {string} without an id', async (world: CoreWorld, name: string, json: string) => {
  await send(world, name, json, false);
  await pause(POLL_MS * 2);
});

When('the torrent window {string} adds {string}', async (world: CoreWorld, name: string, torrent: string) => {
  await send(world, name, `{"type":"torrent.add","request":{"source":{"sourceType":"magnet","magnet":"$magnet:${torrent}"}}}`);
});

When('the torrent window {string} adds {string} with {string}', async (world: CoreWorld, name: string, torrent: string, options: string) => {
  await send(world, name, `{"type":"torrent.add","request":{"source":{"sourceType":"magnet","magnet":"$magnet:${torrent}"},"options":${options}}}`);
});

When('the torrent window {string} asks to {word} {string}', async (world: CoreWorld, name: string, action: string, torrent: string) => {
  await send(world, name, `{"type":"torrent.${action}","jobId":"$job:${torrent}"}`);
});

When('the torrent window {string} asks to remove {string} and delete its files', async (world: CoreWorld, name: string, torrent: string) => {
  await send(world, name, `{"type":"torrent.remove","jobId":"$job:${torrent}","options":{"deleteData":true}}`);
});

When('the torrent window {string} changes {string} at revision {int} with {string}', async (world: CoreWorld, name: string, torrent: string, revision: number, patch: string) => {
  await send(world, name, `{"type":"torrent.update","request":{"jobId":"$job:${torrent}","expectedRevision":${revision},"patch":${patch}}}`);
});

When('the torrent window {string} adds {int} different torrents', async (world: CoreWorld, name: string, count: number) => {
  for (let index = 0; index < count; index += 1) await send(world, name, `{"type":"torrent.add","request":{"source":{"sourceType":"magnet","magnet":"$magnet:filler-${index}"}}}`);
});

When('a few torrent refreshes pass', async () => {
  await pause(POLL_MS * 6);
});

Then('the torrent window {string} gets back {string}', (world: CoreWorld, name: string, json: string) => {
  expect(lastResult(world, name)).toMatchObject(parse(world, windowOf(world, name), json));
});

Then('the torrent window {string} gets back exactly {string}', (world: CoreWorld, name: string, json: string) => {
  const { id, ...result } = lastResult(world, name);
  expect(id).toBe(`request-${torrents(world).nextId}`);
  expect(result).toEqual(parse(world, windowOf(world, name), json));
});

Then('the torrent window {string} is told the job is {word}', (world: CoreWorld, name: string, state: string) => {
  const result = lastResult(world, name);
  expect((result.ack ?? result.status) as object).toMatchObject({ ok: true, state });
});

Then('the torrent window {string} is refused with {string}', (world: CoreWorld, name: string, error: string) => {
  const result = lastResult(world, name);
  const refusal = (result.ack ?? result.result ?? result) as Record<string, unknown>;
  expect(refusal.error).toBe(error);
  expect(result.status ?? result.jobs ?? result.files ?? result.capabilities).toBeUndefined();
});

Then('the torrent window {string} is given the reason {string}', (world: CoreWorld, name: string, reason: string) => {
  const result = lastResult(world, name);
  expect((result.ack ?? result.result) as object).toMatchObject({ ok: false, reason });
});

Then('the torrent window {string} has had {int} answer(s)', (world: CoreWorld, name: string, count: number) => {
  expect(windowOf(world, name).results).toHaveLength(count);
});

Then('the torrent job the window {string} was given for {string} is not named after its hash', (world: CoreWorld, name: string, torrent: string) => {
  const jobId = torrents(world).jobs.get(`${windowOf(world, name).applet}/${torrent}`) as string;
  expect(jobId).toMatch(/^tor-[0-9a-f-]{36}$/);
  expect(jobId).not.toContain(hashOf(torrent));
});

Then('the person was asked {string} as a torrent {string} question', (world: CoreWorld, title: string, kind: string) => {
  expect(torrents(world).questions.at(-1)?.question).toMatchObject({ title, kind });
});

Then('the torrent question says {string} is {string}', (world: CoreWorld, label: string, value: string) => {
  const anyone: TorrentWindow = { windowId: '', applet: undefined, results: [], pushes: [] };
  expect(torrents(world).questions.at(-1)?.question.lines).toContainEqual({ label, value: expand(world, anyone, value) });
});

Then('the torrent question has no {string} line', (world: CoreWorld, label: string) => {
  expect(torrents(world).questions.at(-1)?.question.lines.map((line) => line.label)).not.toContain(label);
});

Then('the person was asked {int} torrent question(s)', (world: CoreWorld, count: number) => {
  expect(torrents(world).questions).toHaveLength(count);
});

Then('the torrent program was never called', (world: CoreWorld) => {
  expect(torrents(world).client.calls).toEqual([]);
});

Then('the torrent program was not handed anything', (world: CoreWorld) => {
  expect(torrents(world).client.calls.filter((call) => call === 'add')).toEqual([]);
});

Then('the torrent program shows {string} as {word}', async (world: CoreWorld, name: string, state: string) => {
  const { client } = torrents(world);
  await until(() => client.snapshot(hashOf(name))?.state === state, `the torrent program to show ${name} as ${state}, not ${client.snapshot(hashOf(name))?.state}`);
});

Then('the torrent program was handed {string} {word}', (world: CoreWorld, name: string, how: string) => {
  expect(torrents(world).client.calls).toContain(`added:${hashOf(name)}:${how}`);
});

Then('the torrent program no longer has {string}', (world: CoreWorld, name: string) => {
  expect(torrents(world).client.has(hashOf(name))).toBe(false);
});

Then('the torrent program has never had {string}', (world: CoreWorld, name: string) => {
  expect(torrents(world).client.calls.join(' ')).not.toContain(hashOf(name));
});

Then('the torrent window {string} is shown {int} torrent job(s)', (world: CoreWorld, name: string, count: number) => {
  expect(lastResult(world, name).jobs).toHaveLength(count);
});

Then('the torrent program still has {string}', (world: CoreWorld, name: string) => {
  expect(torrents(world).client.has(hashOf(name))).toBe(true);
});

Then('the torrent program was told to delete the files of {string}', (world: CoreWorld, name: string) => {
  expect(torrents(world).client.deleted).toContain(hashOf(name));
});

Then('the torrent program was not told to delete any files', (world: CoreWorld) => {
  expect(torrents(world).client.deleted).toEqual([]);
});

Then('the torrent program limits {string} to {int} down and {int} up', (world: CoreWorld, name: string, downloadLimit: number, uploadLimit: number) => {
  expect(torrents(world).client.snapshot(hashOf(name))).toMatchObject({ downloadLimit, uploadLimit });
});

Then('the torrent program skips {string} of {string}', async (world: CoreWorld, path: string, name: string) => {
  const files = await torrents(world).client.files(hashOf(name));
  expect(files.find((file) => file.path === path)).toMatchObject({ selected: false });
});

Then('the torrent program fetches {string} of {string} at priority {int}', async (world: CoreWorld, path: string, name: string, priority: number) => {
  const files = await torrents(world).client.files(hashOf(name));
  expect(files.find((file) => file.path === path)).toMatchObject({ selected: true, priority });
});

Then('the torrent window {string} is pushed the state {string} for {string}', async (world: CoreWorld, name: string, state: string, torrent: string) => {
  await until(() => pushesFor(world, name, 'torrent.state', torrent).some((push) => push.state === state), `a push of the state ${state}`);
});

Then('the torrent window {string} is pushed the state {string} for {string} within {int} seconds', async (world: CoreWorld, name: string, state: string, torrent: string, seconds: number) => {
  await until(() => pushesFor(world, name, 'torrent.state', torrent).some((push) => push.state === state), `a push of the state ${state}`, seconds * 1_000);
});

Then('the torrent window {string} is pushed {string} for {string}', async (world: CoreWorld, name: string, json: string, torrent: string) => {
  const expected = parse(world, windowOf(world, name), json);
  const matches = (push: Wire): boolean => {
    try {
      expect(push).toMatchObject(expected);
      return true;
    } catch {
      return false;
    }
  };
  await until(() => pushesFor(world, name, expected.type, torrent).some(matches), `the push ${json} among ${JSON.stringify(windowOf(world, name).pushes)}`);
});

Then('the torrent window {string} has been pushed the error {string} for {string} {int} time(s)', async (world: CoreWorld, name: string, error: string, torrent: string, count: number) => {
  await pause(POLL_MS * 6);
  expect(pushesFor(world, name, 'torrent.error', torrent).filter((push) => push.error === error)).toHaveLength(count);
});

Then('the torrent window {string} has been pushed nothing', async (world: CoreWorld, name: string) => {
  await pause(POLL_MS * 6);
  expect(windowOf(world, name).pushes).toEqual([]);
});

Then('the torrent service has stopped asking the torrent program', async (world: CoreWorld) => {
  const { client } = torrents(world);
  await pause(POLL_MS * 3);
  const before = client.calls.length;
  await pause(POLL_MS * 6);
  expect(client.calls.length).toBe(before);
});

Then('the torrent service keeps asking the torrent program', async (world: CoreWorld) => {
  const { client } = torrents(world);
  const before = client.calls.length;
  await until(() => client.calls.length > before + 2, 'more calls to the torrent program');
});

Then('nothing the torrent service said mentions {string}', (world: CoreWorld, secret: string) => {
  const state = torrents(world);
  const said = JSON.stringify([...state.windows.values()].map((window) => [window.results, window.pushes]));
  expect(said).not.toContain(secret);
  expect(JSON.stringify(state.questions)).not.toContain(secret);
});

Then('the torrent job storage holds {int} job(s)', (world: CoreWorld, count: number) => {
  expect(JSON.parse(scratch(world).storage.getItem(STORAGE_KEY) ?? '[]')).toHaveLength(count);
});

Then('the torrent service declares every request and push type of the torrent domain', (world: CoreWorld) => {
  const { handler } = torrents(world).service;
  const requests = ['capabilities', 'pickFiles', 'add', 'status', 'jobs', 'files', 'selectFiles', 'pause', 'resume', 'remove', 'metadata', 'read', 'exportMetainfo', 'saveFile', 'openFile', 'cancel', 'update'];
  expect(handler.messageCapabilities).toEqual(Object.fromEntries(requests.map((request) => [`torrent.${request}`, null])));
  expect(handler.pushCapabilities).toEqual({ 'torrent.state': null, 'torrent.progress': null, 'torrent.error': null });
  expect(handler.descriptor.name).toBe('torrent');
});
