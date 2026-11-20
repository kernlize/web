import { expect } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import { createUtorrentClient } from '../../src/clients/utorrent';
import { startFakeUtorrent, UTORRENT_STOPPED, type FakeUtorrent, type FakeUtorrentTorrent } from './fake-utorrent';
import { decodeTorrent } from './fake-transmission-torrents';
import { TORRENT_FILES, defineTorrentClientSteps, type TorrentClientScenario } from './transmission-client';

interface UtorrentScenario extends TorrentClientScenario {
  program?: FakeUtorrent;
}

const scenarios = new WeakMap<object, UtorrentScenario>();

function scenarioOf(world: object): UtorrentScenario {
  let scenario = scenarios.get(world);
  if (!scenario) scenarios.set(world, (scenario = { url: '', create: createUtorrentClient, suffix: '', credentials: {}, fetched: [] }));
  return scenario;
}

function programOf(world: object): FakeUtorrent {
  return scenarioOf(world).program as FakeUtorrent;
}

function torrentOf(world: object): FakeUtorrentTorrent {
  return programOf(world).torrents.get(scenarioOf(world).infoHash as string) as FakeUtorrentTorrent;
}

function seedFile(world: object, name: string, extra: Partial<FakeUtorrentTorrent> = {}): FakeUtorrentTorrent {
  const decoded = decodeTorrent((TORRENT_FILES[name] as () => Uint8Array)());
  if (!decoded) throw new Error(`no torrent file ${name}`);
  const size = decoded.files.reduce((sum, file) => sum + file.length, 0);
  scenarioOf(world).infoHash = decoded.infoHash;
  return programOf(world).seed({
    hash: decoded.infoHash,
    name: decoded.name,
    size,
    remaining: size,
    files: decoded.files.map((file) => [file.path.replaceAll('/', '\\'), file.length, 0, 2]),
    ...extra,
  });
}

After(async (world: object) => {
  await scenarios.get(world)?.program?.close();
});

defineTorrentClientSteps('uTorrent', scenarioOf);

Given('a uTorrent that asks for the name {string} and password {string}', async (world: object, username: string, password: string) => {
  const scenario = scenarioOf(world);
  await scenario.program?.close();
  scenario.program = await startFakeUtorrent();
  scenario.program.credentials = { username, password };
  Object.assign(scenario, { url: scenario.program.url, client: undefined });
});

Given('the uTorrent sets no cookie with its token', (world: object) => {
  programOf(world).setsCookie = false;
});

Given('the uTorrent answers nothing about torrent properties', (world: object) => {
  programOf(world).reportsProps = false;
});

Given('the uTorrent shows a torrent it was sent only after {int} ms', (world: object, delay: number) => {
  programOf(world).arrival = delay;
});

Given('the uTorrent never shows a torrent it was sent', (world: object) => {
  programOf(world).arrival = 'never';
});

When('the uTorrent is started again', (world: object) => {
  programOf(world).restart();
});

Given(
  'the uTorrent has a torrent with status {int}, size {int} and progress {int} per mille',
  (world: object, status: number, size: number, progress: number) => {
    seedFile(world, 'night-mix.flac', { status, size, progress, remaining: Math.round((size * (1000 - progress)) / 1000) });
  },
);

Given('the uTorrent has the torrent file {string}', (world: object, name: string) => {
  seedFile(world, name);
});

Given('the uTorrent has the torrent file {string} stopped', (world: object, name: string) => {
  seedFile(world, name, { status: UTORRENT_STOPPED });
});

Given('the uTorrent has the torrent file {string} paused by its own pause', (world: object, name: string) => {
  seedFile(world, name, { status: 233 });
});

Given('the uTorrent is half way through the torrent file {string}', (world: object, name: string) => {
  const torrent = seedFile(world, name, {
    progress: 500,
    downloaded: 30_000,
    uploaded: 1234,
    remaining: 30_000,
    downloadSpeed: 2048,
    uploadSpeed: 512,
    peersConnected: 4,
    peersInSwarm: 40,
    seedsConnected: 3,
    seedsInSwarm: 12,
    eta: 90,
  });
  Object.assign(torrent.props, { dlrate: 250_000, ulrate: 0, dht: -1, pex: -1 });
});

Given('the uTorrent has a magnet torrent still waiting for its metadata', (world: object) => {
  const scenario = scenarioOf(world);
  scenario.infoHash = 'abcdef0123456789abcdef0123456789abcdef01';
  programOf(world).seed({ hash: scenario.infoHash, name: 'Night Mix' });
});

Given('the uTorrent has a torrent in error saying {string}', (world: object, message: string) => {
  seedFile(world, 'night-mix.flac', { status: 152, progress: 250, message });
});

Given('the uTorrent has a torrent in error without saying why', (world: object) => {
  seedFile(world, 'night-mix.flac', { status: 152, progress: 250 });
});

Given('the uTorrent has {int} torrents', (world: object, count: number) => {
  for (let index = 0; index < count; index += 1) programOf(world).seed({ hash: index.toString(16).padStart(40, 'a'), size: 1000 });
});

Given('the uTorrent holds {int} bytes of file {int}, skips file {int} and has file {int} at high priority', (world: object, bytes: number, held: number, skipped: number, high: number) => {
  const files = torrentOf(world).files as [string, number, number, number][];
  (files[held] as number[])[2] = bytes;
  (files[skipped] as number[])[3] = 0;
  (files[high] as number[])[3] = 3;
});

Given('the uTorrent has file {int} of the torrent at low priority', (world: object, low: number) => {
  ((torrentOf(world).files as [string, number, number, number][])[low] as number[])[3] = 1;
});

Given(
  /^the uTorrent (goes silent on|hangs up on|stalls while answering|breaks off while answering) (?:its (\d+)(?:st|nd|rd|th) )?"([^"]*)"(?: request)?$/,
  (world: object, how: string, nth: string | undefined, action: string) => {
    const kind = ({ 'goes silent on': 'silence', 'hangs up on': 'hang-up', 'stalls while answering': 'stall', 'breaks off while answering': 'break' } as const)[how as 'hangs up on'];
    programOf(world).faults.push({ action, kind, skip: Number(nth ?? 1) - 1 });
  },
);

Given(/^the uTorrent answers "([^"]*)" with status (\d+) and the body (.*)$/, (world: object, action: string, status: string, body: string) => {
  programOf(world).faults.push({ action, kind: 'answer', status: Number(status), body, skip: 0 });
});

Then('the uTorrent handed out {int} token(s)', (world: object, count: number) => {
  expect(programOf(world).tokensIssued).toBe(count);
});

Then('every uTorrent request carried its token first and the cookie that came with it', (world: object) => {
  const { requests } = programOf(world);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((request) => request.tokenFirst && /^GUID=Gd\d+b7c1e5f0a94d2$/.test(String(request.cookie)))).toBe(true);
});

Then('no uTorrent request carried a cookie', (world: object) => {
  expect(programOf(world).requests.map((request) => request.cookie)).toEqual(programOf(world).requests.map(() => undefined));
});

Then('the uTorrent was asked {string} {int} time(s)', (world: object, action: string, count: number) => {
  expect(programOf(world).requests.filter((request) => request.action === action)).toHaveLength(count);
});

Then('the uTorrent was never asked {string}', (world: object, action: string) => {
  expect(programOf(world).requests.filter((request) => request.action === action)).toEqual([]);
});

Then('the uTorrent was asked nothing at all', (world: object) => {
  expect(programOf(world).requests).toEqual([]);
  expect(programOf(world).tokensIssued).toBe(0);
});

Then(/^the uTorrent was last asked "([^"]*)" with (.+)$/, (world: object, action: string, query: string) => {
  const sent = programOf(world).requests.filter((request) => request.action === action).at(-1);
  expect(sent?.query).toBe(`action=${action}&hash=${String(scenarioOf(world).infoHash).toUpperCase()}&${query}`);
});

Then('the uTorrent was asked to fetch exactly {string}', (world: object, link: string) => {
  const sent = programOf(world).requests.filter((request) => request.action === 'add-url').at(-1);
  expect(sent?.method).toBe('GET');
  expect(new URLSearchParams(sent?.query).get('s')).toBe(link);
});

Then('the uTorrent received the torrent file {string} byte for byte as the upload {string}', (world: object, name: string, field: string) => {
  const sent = programOf(world).requests.filter((request) => request.action === 'add-file').at(-1);
  expect(sent?.method).toBe('POST');
  expect(sent?.upload?.field).toBe(field);
  expect(sent?.upload?.filename).toBe(`${scenarioOf(world).infoHash}.torrent`);
  expect(sent?.upload?.bytes.equals(Buffer.from((TORRENT_FILES[name] as () => Uint8Array)()))).toBe(true);
});

Then(/^the uTorrent holds the torrent "([^"]*)" (stopped|running)$/, (world: object, name: string, how: string) => {
  expect(torrentOf(world).name).toBe(name);
  expect(torrentOf(world).status).toBe({ stopped: 136, running: 201 }[how]);
});

Then('the uTorrent holds {int} torrent(s)', (world: object, count: number) => {
  expect(programOf(world).torrents.size).toBe(count);
});

Then('the uTorrent requests ran in the order {string}', (world: object, order: string) => {
  expect(programOf(world).requests.map((request) => request.action).join(', ')).toBe(order);
});

Then(/^the uTorrent removed the torrent and (kept|deleted) its data$/, (world: object, what: string) => {
  expect(programOf(world).removed).toEqual([{ infoHash: scenarioOf(world).infoHash, deleteData: what === 'deleted' }]);
});

Then('the uTorrent limits the torrent to {int} down and {int} up', (world: object, down: number, up: number) => {
  expect({ dlrate: torrentOf(world).props.dlrate, ulrate: torrentOf(world).props.ulrate }).toEqual({ dlrate: down, ulrate: up });
});
