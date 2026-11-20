import { expect } from 'vitest';
import { After, Given, Then, When, type DataTable } from 'quickpickle';
import { createTransmissionClient } from '../../src/clients/transmission';
import type { ClientFetch, ClientOptions, TorrentClient, TorrentClientFile, TorrentClientJob } from '../../src/clients/types';
import { startFakeTransmission, transmissionFiles, transmissionTracker, type FakeTransmission, type FakeTransmissionTorrent } from './fake-transmission';
import { decodeTorrent, folderTorrent, singleFileTorrent } from './fake-transmission-torrents';
import { expectReason, reasonOf } from './world';

/** What a scenario about one torrent program keeps between steps, whichever program it is. */
export interface TorrentClientScenario {
  /** Where the program's stand-in listens. */
  url: string;
  create: (options: ClientOptions) => TorrentClient;
  suffix: string;
  credentials: { username?: string; password?: string };
  timeoutMs?: number;
  fetch?: ClientFetch;
  fetched: string[];
  client?: TorrentClient;
  /** The torrent the scenario is about. */
  infoHash?: string;
  result?: unknown;
  error?: unknown;
}

export const UNKNOWN_TORRENT = '1111111111111111111111111111111111111111';

export const TORRENT_FILES: Record<string, () => Uint8Array> = {
  'night-mix.flac': () => singleFileTorrent(),
  'Field Recordings': () => folderTorrent(),
  broken: () => Buffer.from('this is not a torrent'),
};

const FILE_CHANGES: Record<string, { selected?: boolean; priority?: number }> = {
  skipped: { selected: false },
  wanted: { selected: true },
  'low priority': { priority: -1 },
  'normal priority': { priority: 0 },
  'high priority': { priority: 1 },
  'wanted at high priority': { selected: true, priority: 1 },
  'skipped at low priority': { selected: false, priority: -1 },
  unchanged: {},
  'priority 5': { priority: 5 },
};

const ACTIONS: Record<string, (client: TorrentClient, infoHash: string) => Promise<unknown>> = {
  'look up': (client, infoHash) => client.get(infoHash),
  'list the files of': (client, infoHash) => client.files(infoHash),
  pause: (client, infoHash) => client.pause(infoHash),
  resume: (client, infoHash) => client.resume(infoHash),
  remove: (client, infoHash) => client.remove(infoHash, false),
  'remove with its data': (client, infoHash) => client.remove(infoHash, true),
  limit: (client, infoHash) => client.setLimits(infoHash, { downloadLimit: 50_000 }),
  'skip the first file of': (client, infoHash) => client.selectFiles(infoHash, [0], { selected: false }),
};

function numbers(text: string): number[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);
}

export function clientOf(scenario: TorrentClientScenario): TorrentClient {
  scenario.client ??= scenario.create({
    endpoint: { url: `${scenario.url}${scenario.suffix}`, ...scenario.credentials },
    ...(scenario.timeoutMs === undefined ? {} : { timeoutMs: scenario.timeoutMs }),
    ...(scenario.fetch ? { fetch: scenario.fetch } : {}),
  });
  return scenario.client;
}

export async function attempt(scenario: TorrentClientScenario, run: (client: TorrentClient) => Promise<unknown>): Promise<void> {
  scenario.result = undefined;
  scenario.error = undefined;
  try {
    scenario.result = await run(clientOf(scenario));
  } catch (error) {
    scenario.error = error;
  }
}

function reconfigure(scenario: TorrentClientScenario, change: Partial<TorrentClientScenario>): void {
  Object.assign(scenario, change, { client: undefined });
}

function expectTable(actual: object | undefined, table: DataTable): void {
  expect(actual).toBeDefined();
  for (const [field, value] of table.raw() as [string, string][]) {
    expect({ [field]: (actual as Record<string, unknown>)[field] }).toEqual({ [field]: value === 'absent' ? undefined : JSON.parse(value) });
  }
}

type ScenarioOf = (world: object) => TorrentClientScenario;

function defineSetupSteps(label: string, scenarioOf: ScenarioOf): void {
  Given(`the ${label} client signs in as {string} with password {string}`, (world: object, username: string, password: string) => {
    reconfigure(scenarioOf(world), { credentials: { username, password } });
  });

  Given(`the ${label} client signs in with only the name {string}`, (world: object, username: string) => {
    reconfigure(scenarioOf(world), { credentials: { username } });
  });

  Given(`the ${label} client signs in with only the password {string}`, (world: object, password: string) => {
    reconfigure(scenarioOf(world), { credentials: { password } });
  });

  Given(`the ${label} client signs in with nothing`, (world: object) => {
    reconfigure(scenarioOf(world), { credentials: {} });
  });

  Given(`the ${label} client uses the program's address followed by {string}`, (world: object, suffix: string) => {
    reconfigure(scenarioOf(world), { suffix });
  });

  Given(`the ${label} client is pointed at an address where nothing listens`, (world: object) => {
    reconfigure(scenarioOf(world), { url: 'http://127.0.0.1:9' });
  });

  Given(`the ${label} client gives up after {int} ms`, (world: object, timeoutMs: number) => {
    reconfigure(scenarioOf(world), { timeoutMs });
  });

  // The host's fetch is the real one, observed: the scenario is about whose fetch is called, not about faking answers.
  Given(`the ${label} client is given its host's own fetch`, (world: object) => {
    const scenario = scenarioOf(world);
    reconfigure(scenario, {
      fetch: (input, init) => {
        scenario.fetched.push(input);
        return fetch(input, init);
      },
    });
  });

}

function defineActionSteps(label: string, scenarioOf: ScenarioOf): void {
  When(`the ${label} client probes the program`, (world: object) => attempt(scenarioOf(world), (client) => client.probe()));

  When(new RegExp(`^the ${label} client adds the (magnet link|torrent file) "([^"]*)"( paused| to start at once)?$`), async (world: object, kind: string, what: string, how?: string) => {
    const scenario = scenarioOf(world);
    const source = kind === 'magnet link' ? ({ kind: 'magnet', magnet: what } as const) : ({ kind: 'metainfo', bytes: (TORRENT_FILES[what] as () => Uint8Array)() } as const);
    await attempt(scenario, (client) => (how ? client.add(source, { paused: how === ' paused' }) : client.add(source)));
    const added = (scenario.result as { infoHash?: string } | undefined)?.infoHash;
    if (added) scenario.infoHash = added;
  });

  When(`the ${label} client lists the torrents`, (world: object) => attempt(scenarioOf(world), (client) => client.list()));

  When(new RegExp(`^the ${label} client is asked to "([^"]*)" the torrent(?: "([^"]*)")?$`), (world: object, action: string, named?: string) => {
    const scenario = scenarioOf(world);
    return attempt(scenario, (client) => (ACTIONS[action] as (typeof ACTIONS)[string])(client, named ?? (scenario.infoHash as string)));
  });

  When(new RegExp(`^the ${label} client marks files "([^"]*)" of the torrent as (.+)$`), (world: object, files: string, change: string) => {
    const scenario = scenarioOf(world);
    return attempt(scenario, (client) => client.selectFiles(scenario.infoHash as string, numbers(files), FILE_CHANGES[change] as (typeof FILE_CHANGES)[string]));
  });

  When(`the ${label} client limits the torrent to {int} down and {int} up`, (world: object, downloadLimit: number, uploadLimit: number) => {
    const scenario = scenarioOf(world);
    return attempt(scenario, (client) => client.setLimits(scenario.infoHash as string, { downloadLimit, uploadLimit }));
  });

  When(new RegExp(`^the ${label} client limits only the torrent's (download|upload) to (-?\\d+)$`), (world: object, which: string, limit: string) => {
    const scenario = scenarioOf(world);
    return attempt(scenario, (client) => client.setLimits(scenario.infoHash as string, { [`${which}Limit`]: Number(limit) }));
  });

  When(`the ${label} client sets no limit on the torrent`, (world: object) => {
    const scenario = scenarioOf(world);
    return attempt(scenario, (client) => client.setLimits(scenario.infoHash as string, {}));
  });

}

function defineOutcomeSteps(label: string, scenarioOf: ScenarioOf): void {
  Then(`the ${label} client succeeds`, (world: object) => {
    expect(scenarioOf(world).error).toBeUndefined();
  });

  Then(`the ${label} client fails with {string}`, (world: object, reason: string) => {
    const scenario = scenarioOf(world);
    expectReason(scenario.error, reason);
    for (const secret of Object.values(scenario.credentials).filter(Boolean)) expect(reasonOf(scenario.error)).not.toContain(secret);
  });

  Then(`the ${label} client reports version {string}`, (world: object, version: string) => {
    expect(scenarioOf(world).error).toBeUndefined();
    expect(scenarioOf(world).result).toEqual({ version });
  });

  Then(`the ${label} client names the torrent {string}`, (world: object, infoHash: string) => {
    expect(scenarioOf(world).error).toBeUndefined();
    expect(scenarioOf(world).result).toEqual({ infoHash });
  });

  Then(`the ${label} client names the torrent file {string} by the SHA-1 of its info dictionary`, (world: object, name: string) => {
    expect(scenarioOf(world).error).toBeUndefined();
    expect(scenarioOf(world).result).toEqual({ infoHash: decodeTorrent((TORRENT_FILES[name] as () => Uint8Array)())?.infoHash });
  });

  Then(`the ${label} client finds no such torrent`, (world: object) => {
    expect(scenarioOf(world).error).toBeUndefined();
    expect(scenarioOf(world).result).toBeUndefined();
  });

  Then(`the ${label} client reports the torrent as {string}`, (world: object, state: string) => {
    expect(scenarioOf(world).error).toBeUndefined();
    expect((scenarioOf(world).result as TorrentClientJob).state).toBe(state);
  });

  Then(`the ${label} client reports {int} torrent(s)`, (world: object, count: number) => {
    expect(scenarioOf(world).error).toBeUndefined();
    expect(scenarioOf(world).result).toHaveLength(count);
  });

  Then(`the ${label} client reports the job:`, (world: object, table: DataTable) => {
    const { result, error } = scenarioOf(world);
    expect(error).toBeUndefined();
    expectTable(Array.isArray(result) ? (result as TorrentClientJob[])[0] : (result as TorrentClientJob), table);
  });

  Then(`the ${label} client reports the files:`, (world: object, table: DataTable) => {
    expect(scenarioOf(world).error).toBeUndefined();
    const expected = table.hashes().map((row): TorrentClientFile => ({
      index: Number(row.index),
      path: String(row.path),
      size: Number(row.size),
      downloadedBytes: Number(row.downloaded),
      selected: row.selected === 'yes',
      priority: Number(row.priority),
    }));
    expect(scenarioOf(world).result).toEqual(expected);
  });

  Then(`the ${label} client reports no files`, (world: object) => {
    expect(scenarioOf(world).error).toBeUndefined();
    expect(scenarioOf(world).result).toEqual([]);
  });

  Then(`the ${label} client's requests all went through its host's fetch`, (world: object) => {
    expect(scenarioOf(world).fetched.length).toBeGreaterThan(0);
    expect(scenarioOf(world).fetched.every((url) => url.startsWith(scenarioOf(world).url))).toBe(true);
  });
}

/**
 * The steps every torrent program's scenarios share, phrased with the program's name so
 * each feature reads on its own and no two programs claim the same sentence.
 */
export function defineTorrentClientSteps(label: string, scenarioOf: ScenarioOf): void {
  defineSetupSteps(label, scenarioOf);
  defineActionSteps(label, scenarioOf);
  defineOutcomeSteps(label, scenarioOf);
}

interface TransmissionScenario extends TorrentClientScenario {
  daemon?: FakeTransmission;
}

const scenarios = new WeakMap<object, TransmissionScenario>();

function scenarioOf(world: object): TransmissionScenario {
  let scenario = scenarios.get(world);
  if (!scenario) scenarios.set(world, (scenario = { url: '', create: createTransmissionClient, suffix: '', credentials: {}, fetched: [] }));
  return scenario;
}

function daemonOf(world: object): FakeTransmission {
  return scenarioOf(world).daemon as FakeTransmission;
}

function torrentOf(world: object): FakeTransmissionTorrent {
  return daemonOf(world).torrents.get(scenarioOf(world).infoHash as string) as FakeTransmissionTorrent;
}

async function startDaemon(world: object, credentials?: { username: string; password: string }): Promise<void> {
  const scenario = scenarioOf(world);
  await scenario.daemon?.close();
  scenario.daemon = await startFakeTransmission();
  scenario.daemon.credentials = credentials;
  Object.assign(scenario, { url: scenario.daemon.url, client: undefined });
}

function seedFile(world: object, name: string, extra: Partial<FakeTransmissionTorrent> = {}): FakeTransmissionTorrent {
  const decoded = decodeTorrent((TORRENT_FILES[name] as () => Uint8Array)());
  if (!decoded) throw new Error(`no torrent file ${name}`);
  scenarioOf(world).infoHash = decoded.infoHash;
  return daemonOf(world).seed({ hashString: decoded.infoHash, ...transmissionFiles(decoded.name, decoded.files), isPrivate: decoded.private, ...extra });
}

After(async (world: object) => {
  await scenarios.get(world)?.daemon?.close();
});

defineTorrentClientSteps('Transmission', scenarioOf);

Given('a Transmission daemon that asks for the name {string} and password {string}', (world: object, username: string, password: string) =>
  startDaemon(world, { username, password }),
);

Given('a Transmission daemon that asks for no password', (world: object) => startDaemon(world));

Given('the Transmission daemon serves its RPC at {string}', (world: object, path: string) => {
  daemonOf(world).rpcPath = path;
});

Given('the Transmission daemon keeps its session id to itself', (world: object) => {
  daemonOf(world).namesSession = false;
});

Given('the Transmission daemon keeps added torrents stopped', (world: object) => {
  daemonOf(world).startAdded = false;
});

When('the Transmission daemon starts a new session', (world: object) => {
  daemonOf(world).newSession();
});

Given(
  'the Transmission daemon has a torrent with status {int}, error {int}, {word} of its metadata and {int} bytes left',
  (world: object, status: number, error: number, metadata: string, left: number) => {
    const known = metadata === 'all';
    seedFile(world, 'night-mix.flac', {
      status,
      error,
      errorString: error === 0 ? '' : 'Tracker gave an error: unregistered torrent',
      metadataPercentComplete: known ? 1 : 0,
      totalSize: known ? 40_000 : 0,
      leftUntilDone: left,
      percentDone: known ? (40_000 - left) / 40_000 : 0,
      haveValid: known ? 40_000 - left : 0,
    });
  },
);

Given('the Transmission daemon has the torrent file {string}', (world: object, name: string) => {
  seedFile(world, name);
});

Given('the Transmission daemon is half way through the torrent file {string}', (world: object, name: string) => {
  seedFile(world, name, {
    status: 4,
    haveValid: 25_000,
    haveUnchecked: 5000,
    uploadedEver: 1234,
    percentDone: 0.5,
    leftUntilDone: 30_000,
    rateDownload: 2048,
    rateUpload: 512,
    peersConnected: 7,
    trackerStats: [transmissionTracker('https://private.example/announce', 12, 3), transmissionTracker('https://backup.example/announce', -1, 40)],
    eta: 90,
    downloadLimit: 250,
    downloadLimited: true,
  });
});

Given('the Transmission daemon has a magnet torrent still waiting for its metadata', (world: object) => {
  const scenario = scenarioOf(world);
  scenario.infoHash = 'abcdef0123456789abcdef0123456789abcdef01';
  daemonOf(world).seed({ hashString: scenario.infoHash, name: 'Night Mix', status: 4 });
});

Given('the Transmission daemon has a torrent whose data went missing', (world: object) => {
  seedFile(world, 'night-mix.flac', {
    error: 3,
    errorString: 'Paused torrent as no data was found! Ensure your drives are connected or use "Set Location", then use "Verify Local Data" again. To re-download, start the torrent.',
  });
});

Given('the Transmission daemon holds {int} bytes of file {int} and skips file {int} at low priority', (world: object, bytes: number, held: number, skipped: number) => {
  const torrent = torrentOf(world);
  (torrent.files[held] as { bytesCompleted: number }).bytesCompleted = bytes;
  torrent.fileStats[held] = { bytesCompleted: bytes, priority: 0, wanted: true };
  torrent.fileStats[skipped] = { bytesCompleted: 0, priority: -1, wanted: false };
});

Given(/^the Transmission daemon (goes silent on|hangs up on|stalls while answering|breaks off while answering) "([^"]*)"$/, (world: object, how: string, method: string) => {
  const kind = ({ 'goes silent on': 'silence', 'hangs up on': 'hang-up', 'stalls while answering': 'stall', 'breaks off while answering': 'break' } as const)[how as 'hangs up on'];
  daemonOf(world).faults.push({ method, kind });
});

Given(/^the Transmission daemon answers "([^"]*)" with status (\d+) and the body (.*)$/, (world: object, method: string, status: string, body: string) => {
  daemonOf(world).faults.push({ method, kind: 'answer', status: Number(status), body });
});

Then('the Transmission daemon turned away {int} request(s) for lacking its session id', (world: object, count: number) => {
  expect(daemonOf(world).conflicts).toBe(count);
});

Then('the Transmission daemon was asked {string} {int} time(s)', (world: object, method: string, count: number) => {
  expect(daemonOf(world).calls.filter((call) => call.method === method)).toHaveLength(count);
});

Then('the Transmission daemon was never asked {string}', (world: object, method: string) => {
  expect(daemonOf(world).calls.filter((call) => call.method === method)).toEqual([]);
});

Then(/^the Transmission daemon was last asked "([^"]*)" with (.+)$/, (world: object, method: string, json: string) => {
  const { ids: _ids, metainfo: _metainfo, ...sent } = daemonOf(world).calls.filter((call) => call.method === method).at(-1)?.arguments ?? {};
  expect(sent).toEqual(JSON.parse(json));
});

Then(/^the Transmission daemon holds the torrent "([^"]*)" (stopped|downloading|seeding)$/, (world: object, name: string, how: string) => {
  const torrent = torrentOf(world);
  expect(torrent.name).toBe(name);
  expect(torrent.status).toBe({ stopped: 0, downloading: 4, seeding: 6 }[how]);
});

Then('the Transmission daemon holds {int} torrent(s)', (world: object, count: number) => {
  expect(daemonOf(world).torrents.size).toBe(count);
});

Then('the Transmission daemon received the torrent file {string} byte for byte', (world: object, name: string) => {
  const sent = daemonOf(world).calls.filter((call) => call.method === 'torrent-add').at(-1)?.arguments.metainfo;
  expect(Buffer.from(String(sent), 'base64').equals(Buffer.from((TORRENT_FILES[name] as () => Uint8Array)()))).toBe(true);
});

Then(/^the Transmission daemon removed the torrent and (kept|deleted) its data$/, (world: object, what: string) => {
  expect(daemonOf(world).removed).toEqual([{ infoHash: scenarioOf(world).infoHash, deleteData: what === 'deleted' }]);
});
