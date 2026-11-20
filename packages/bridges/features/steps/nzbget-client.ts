import { expect } from 'vitest';
import { After, Given, Then, When, type DataTable, type DocString } from 'quickpickle';
import { createNzbgetClient } from '../../src/clients/nzbget';
import type { ClientEndpoint, NzbClient, NzbClientAction, NzbClientAdd, NzbClientJob } from '../../src/clients/types';
import { startFakeNzbget, type FakeNzbget, type NzbgetFault } from './fake-nzbget';
import { expectReason, splitList } from './world';

type Json = Record<string, unknown>;

/** What one scenario keeps about the NZB downloader it talks to. */
export interface NzbClientScenario {
  /** The adapter under test, made on first use so the Givens can still change how it signs in. */
  client?: () => NzbClient;
  /** The downloader's current id for a job, by the job's name. */
  idOf?: (name: string) => string;
  answer?: unknown;
  error?: unknown;
}

const NOTHING = Symbol('nothing answered yet');
const NEVER_HAD = 'a-job-the-downloader-never-had';

/**
 * A small well-formed NZB. The article id comes from the name, so adding the same
 * name twice hands the downloader the same document twice.
 */
export function nzbDocument(name: string): Uint8Array {
  const article = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}@example.net`;
  return new TextEncoder().encode(
    `<?xml version="1.0" encoding="UTF-8"?>\n<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb"><file poster="example@example.net" date="1793361600" subject="example.txt (1/1)"><groups><group>alt.test</group></groups><segments><segment bytes="8" number="1">${article}</segment></segments></file></nzb>\n`,
  );
}

function parseAddOptions(text: string): Omit<NzbClientAdd, 'bytes' | 'name'> {
  const options: { category?: string; priority?: NonNullable<NzbClientAdd['priority']>; paused?: boolean; password?: string } = {};
  for (const entry of splitList(text)) {
    const [key = '', ...rest] = entry.split(' ');
    const value = rest.join(' ');
    if (key === 'held') options.paused = true;
    else if (key === 'released') options.paused = false;
    else if (key === 'priority') options.priority = value as NonNullable<NzbClientAdd['priority']>;
    else if (key === 'category') options.category = value;
    else if (key === 'password') options.password = value;
    else throw new Error(`unknown add option ${entry}`);
  }
  return options;
}

function shown(value: unknown): string {
  if (value === undefined) return 'absent';
  return Array.isArray(value) ? value.join(' ') : String(value);
}

function tableOf(table: DataTable): Json {
  return Object.fromEntries(table.raw().map(([key = '', value = '']) => [key, /^-?\d+$/.test(value) ? Number(value) : value]));
}

/** What the shared steps use to reach one scenario's adapter and remember what it said. */
interface NzbStepTools {
  readonly label: string;
  client(world: object): NzbClient;
  idOf(world: object, name: string): string;
  ask(world: object, work: (nzb: NzbClient) => Promise<unknown>): Promise<void>;
  answered<T>(world: object): T;
  refusal(world: object): unknown;
}

function toolsFor(label: string, scenarioOf: (world: object) => NzbClientScenario): NzbStepTools {
  function client(world: object): NzbClient {
    const make = scenarioOf(world).client;
    if (!make) throw new Error(`no ${label}`);
    return make();
  }

  function idOf(world: object, name: string): string {
    const find = scenarioOf(world).idOf;
    if (!find) throw new Error(`no ${label}`);
    return find(name);
  }

  async function ask(world: object, work: (nzb: NzbClient) => Promise<unknown>): Promise<void> {
    const scenario = scenarioOf(world);
    scenario.answer = NOTHING;
    scenario.error = undefined;
    try {
      scenario.answer = await work(client(world));
    } catch (error) {
      scenario.error = error;
    }
  }

  function answered<T>(world: object): T {
    const scenario = scenarioOf(world);
    expect(scenario.error).toBeUndefined();
    expect(scenario.answer).not.toBe(NOTHING);
    return scenario.answer as T;
  }

  return { label, client, idOf, ask, answered, refusal: (world) => scenarioOf(world).error };
}

function defineDescribingSteps({ label, client, ask, answered }: NzbStepTools): void {
  Then(`the ${label} client offers the actions {string}`, (world: object, actions: string) => {
    expect(client(world).actions).toEqual(splitList(actions));
  });

  Then(`the ${label} client honours the add options {string}`, (world: object, options: string) => {
    expect(client(world).addOptions).toEqual(splitList(options));
  });

  When(`the ${label} client is asked what it is talking to`, (world: object) => ask(world, (nzb) => nzb.probe()));

  Then(`the ${label} client reports version {string}`, (world: object, version: string) => {
    expect(answered(world)).toEqual({ version });
  });

  When(`the ${label} client lists the categories`, (world: object) => ask(world, (nzb) => nzb.categories()));

  Then(`the ${label} client names the categories {string}`, (world: object, names: string) => {
    expect(answered<{ name: string }[]>(world).map((category) => category.name)).toEqual(splitList(names));
  });
}

function defineAddingSteps({ label, ask }: NzbStepTools): void {
  When(`the ${label} client adds an NZB named {string}`, (world: object, name: string) => ask(world, (nzb) => nzb.add({ bytes: nzbDocument(name), name })));

  When(`the ${label} client adds an NZB named {string} with {string}`, (world: object, name: string, options: string) =>
    ask(world, (nzb) => nzb.add({ bytes: nzbDocument(name), name, ...parseAddOptions(options) })),
  );

  When(`the ${label} client adds an NZB whose name holds a tab and a line break`, (world: object) =>
    ask(world, (nzb) => nzb.add({ bytes: nzbDocument('tabs'), name: '\ttabs\tand\nlines' })),
  );

  When(`the ${label} client adds an NZB named {string} with a password holding a {word}`, (world: object, name: string, awkward: string) => {
    const character = { quote: '"', backslash: '\\', tab: '\t' }[awkward] ?? '';
    return ask(world, (nzb) => nzb.add({ bytes: nzbDocument(name), name, password: `s3cret${character}tail` }));
  });

  When(`the ${label} client adds an NZB of {int} bytes named {string}`, (world: object, size: number, name: string) => {
    const document = nzbDocument(name);
    const bytes = new Uint8Array(size).fill(0x20);
    bytes.set(document);
    return ask(world, (nzb) => nzb.add({ bytes, name }));
  });

  When(`the ${label} client adds something that is not an NZB, named {string}`, (world: object, name: string) =>
    ask(world, (nzb) => nzb.add({ bytes: new TextEncoder().encode('not xml'), name })),
  );
}

function defineListingSteps({ label, idOf, ask, answered }: NzbStepTools): void {
  When(`the ${label} client lists the jobs`, (world: object) => ask(world, (nzb) => nzb.list()));

  Then(`the ${label} client shows the jobs:`, (world: object, table: DataTable) => {
    const jobs = answered<NzbClientJob[]>(world).map((job) => [job.name, job.state, shown(job.actions) || 'nothing']);
    expect(jobs).toEqual(table.raw().slice(1));
  });

  Then(`the ${label} client shows {int} jobs`, (world: object, count: number) => {
    expect(answered<NzbClientJob[]>(world)).toHaveLength(count);
  });

  When(`the ${label} client looks up the job {string}`, (world: object, name: string) => ask(world, (nzb) => nzb.get(idOf(world, name))));

  When(`the ${label} client looks up a job the downloader never had`, (world: object) => ask(world, (nzb) => nzb.get(NEVER_HAD)));

  When(`the ${label} client looks up a job by the id {string}`, (world: object, id: string) => ask(world, (nzb) => nzb.get(id)));

  Then(`the ${label} client finds no such job`, (world: object) => {
    expect(answered(world)).toBeUndefined();
  });

  Then(`the ${label} client describes the job as:`, (world: object, table: DataTable) => {
    const job = answered<Json>(world);
    const described = table.raw().map(([field = '']) => [field, shown(job[field]) || 'nothing']);
    expect(described).toEqual(table.raw());
  });
}

function defineControlSteps({ label, idOf, ask, answered, refusal }: NzbStepTools): void {
  When(`the ${label} client is asked to {word} the job {string}`, (world: object, action: string, name: string) =>
    ask(world, (nzb) => nzb.control(idOf(world, name), action as NzbClientAction)),
  );

  When(`the ${label} client is asked to {word} a job the downloader never had`, (world: object, action: string) =>
    ask(world, (nzb) => nzb.control(NEVER_HAD, action as NzbClientAction)),
  );

  When(`the ${label} client is asked to {word} a job by the id {string}`, (world: object, action: string, id: string) =>
    ask(world, (nzb) => nzb.control(id, action as NzbClientAction)),
  );

  Then(`the ${label} client answers with the job {string}`, (world: object, name: string) => {
    expect(answered(world)).toEqual({ id: idOf(world, name) });
  });

  Then(`the ${label} client answers with the job id {string}`, (world: object, id: string) => {
    expect(answered(world)).toEqual({ id });
  });

  Then(`the ${label} client succeeds in that`, (world: object) => {
    expect(answered<{ id: string }>(world).id).toEqual(expect.any(String));
  });

  Then(`the ${label} client refuses with {string}`, (world: object, reason: string) => {
    expectReason(refusal(world), reason);
  });

  Then(`the ${label} client's refusal never mentions {string}`, (world: object, secret: string) => {
    expect(String(refusal(world))).not.toContain(secret);
  });
}

/**
 * Registers the steps every NZB downloader adapter shares, under the program's own
 * name so each phrase stays unique.
 */
export function defineNzbClientSteps(label: string, scenarioOf: (world: object) => NzbClientScenario): void {
  const tools = toolsFor(label, scenarioOf);
  defineDescribingSteps(tools);
  defineAddingSteps(tools);
  defineListingSteps(tools);
  defineControlSteps(tools);
}

interface NzbgetScenario extends NzbClientScenario {
  program?: FakeNzbget;
  credentials?: Omit<ClientEndpoint, 'url'>;
  timeoutMs?: number;
  made?: NzbClient;
}

const scenarios = new WeakMap<object, NzbgetScenario>();

function scenarioOf(world: object): NzbgetScenario {
  let scenario = scenarios.get(world);
  if (!scenario) {
    scenario = {};
    scenarios.set(world, scenario);
  }
  return scenario;
}

function programOf(world: object): FakeNzbget {
  const program = scenarioOf(world).program;
  if (!program) throw new Error('no NZBGet');
  return program;
}

function jobOf(world: object, name: string): Json {
  const program = programOf(world);
  const job = [...program.queue, ...program.history].find((entry) => entry['NZBName'] === name);
  if (!job) throw new Error(`NZBGet has no job ${name}`);
  return job;
}

function edits(world: object): string[] {
  return programOf(world)
    .calls.filter((call) => call.method === 'editqueue')
    .map((call) => String(call.params[0]));
}

async function start(world: object, login?: { username: string; password: string }): Promise<void> {
  const scenario = scenarioOf(world);
  const program = await startFakeNzbget();
  program.login = login;
  scenario.program = program;
  if (login !== undefined) scenario.credentials = login;
  scenario.idOf = (name) => String(jobOf(world, name)['NZBID']);
  scenario.client = () => {
    scenario.made ??= createNzbgetClient({
      endpoint: { url: `${program.url}/`, ...scenario.credentials },
      ...(scenario.timeoutMs === undefined ? {} : { timeoutMs: scenario.timeoutMs }),
    });
    return scenario.made;
  };
}

function fault(world: object, method: string, rest: Omit<NzbgetFault, 'method'>): void {
  programOf(world).faults.push({ method, ...rest });
}

After(async (world: object) => {
  await scenarios.get(world)?.program?.close();
});

defineNzbClientSteps('NZBGet', scenarioOf);

Given('an NZBGet that asks for the name {string} and password {string}', (world: object, username: string, password: string) => start(world, { username, password }));

Given('an NZBGet that asks for no login', (world: object) => start(world));

Given('the NZBGet client signs in as {string} with {string}', (world: object, username: string, password: string) => {
  scenarioOf(world).credentials = { username, password };
});

Given('the NZBGet client waits {int} ms for an answer', (world: object, timeoutMs: number) => {
  scenarioOf(world).timeoutMs = timeoutMs;
});

Given('the NZBGet is switched off', async (world: object) => {
  await programOf(world).close();
});

Given('the NZBGet has the job {string} waiting in its queue', (world: object, name: string) => {
  programOf(world).seedQueue({ NZBName: name });
});

Given('the NZBGet has the job {string} held in its queue', (world: object, name: string) => {
  programOf(world).seedQueue({ NZBName: name, Status: 'PAUSED', PausedSizeLo: 8 });
});

Given('the NZBGet has the job {string} in its queue with:', (world: object, name: string, table: DataTable) => {
  programOf(world).seedQueue({ NZBName: name, ...tableOf(table) });
});

Given('the NZBGet has the job {string} in its history as {string}', (world: object, name: string, status: string) => {
  programOf(world).seedHistory({ NZBName: name, Status: status });
});

Given('the NZBGet has the job {string} in its history with:', (world: object, name: string, table: DataTable) => {
  programOf(world).seedHistory({ NZBName: name, ...tableOf(table) });
});

Given('the NZBGet lists the job {string} in its queue and in its history as {string}', (world: object, name: string, status: string) => {
  const queued = programOf(world).seedQueue({ NZBName: name });
  programOf(world).seedHistory({ NZBName: name, NZBID: queued['NZBID'], Status: status });
});

Given('the NZBGet still has the directory of the job {string}', (world: object, name: string) => {
  programOf(world).directories.add(jobOf(world, name)['NZBID'] as number);
});

Given('the NZBGet cannot delete the directory of the job {string}', (world: object, name: string) => {
  const id = jobOf(world, name)['NZBID'] as number;
  programOf(world).directories.add(id);
  programOf(world).stuck.add(id);
});

Given('the NZBGet no longer has the NZB of the job {string}', (world: object, name: string) => {
  jobOf(world, name)['Document'] = undefined;
});

Given('the NZBGet keeps no history', (world: object) => {
  programOf(world).keepsHistory = false;
});

Given('the NZBGet cannot write to its disk', (world: object) => {
  programOf(world).canStore = false;
});

Given('the NZBGet is too old to park a job', (world: object) => {
  programOf(world).parks = false;
});

Given('the NZBGet answers {string} without doing it', (world: object, command: string) => {
  programOf(world).inert.add(command);
});

Given('the NZBGet needs {int} looks to let go of a removed job', (world: object, looks: number) => {
  programOf(world).lingers = looks;
});

Given('the NZBGet job fails again at once when it is taken back', (world: object) => {
  programOf(world).failsAtOnce = true;
});

Given('the NZBGet has the settings:', (world: object, table: DataTable) => {
  programOf(world).settings.splice(0, Infinity, ...table.raw().map(([Name, Value]) => ({ Name, Value })));
});

Given('the NZBGet answers {string} with status {int}', (world: object, method: string, status: number) => {
  fault(world, method, { kind: 'answer', status, body: '{"version":"1.1","result":true}' });
});

Given('the NZBGet answers {string} with the body:', (world: object, method: string, body: DocString) => {
  fault(world, method, { kind: 'answer', body: body.toString() });
});

Given('the NZBGet answers {string} with the result {string}', (world: object, method: string, result: string) => {
  fault(world, method, { kind: 'answer', body: `{"version":"1.1","result":${result}}` });
});

Given('the NZBGet hangs up on {string}', (world: object, method: string) => {
  fault(world, method, { kind: 'hang-up' });
});

Given('the NZBGet hangs up on {string} the second time it is asked', (world: object, method: string) => {
  fault(world, method, { kind: 'hang-up', skip: 1 });
});

Given('the NZBGet never answers {string}', (world: object, method: string) => {
  fault(world, method, { kind: 'silence' });
});

Then('the NZBGet was handed the file name {string}', (world: object, fileName: string) => {
  const sent = programOf(world).calls.find((call) => call.method === 'append');
  expect(sent?.params[0]).toBe(fileName);
});

Then('the NZBGet was handed {int} bytes', (world: object, size: number) => {
  const sent = programOf(world).calls.find((call) => call.method === 'append');
  expect(Buffer.from(String(sent?.params[1]), 'base64')).toHaveLength(size);
});

Then('the NZBGet was handed nothing', (world: object) => {
  expect(programOf(world).calls.filter((call) => call.method === 'append')).toEqual([]);
});

Then('the NZBGet holds the job {string} as:', (world: object, name: string, table: DataTable) => {
  const job = jobOf(world, name);
  const held = table.raw().map(([field = '']) => [field, field === 'Parameters' ? (job[field] as Json[]).map((entry) => `${String(entry['Name'])}=${String(entry['Value'])}`).join(' ') : String(job[field])]);
  expect(held).toEqual(table.raw());
});

Then('the NZBGet was asked to {string}', (world: object, commands: string) => {
  expect(edits(world)).toEqual(splitList(commands));
});

Then('the NZBGet was not asked to change anything', (world: object) => {
  expect(edits(world)).toEqual([]);
});

Then('the NZBGet has no job {string}', (world: object, name: string) => {
  const program = programOf(world);
  expect([...program.queue, ...program.history].filter((entry) => entry['NZBName'] === name)).toEqual([]);
});

Then('the NZBGet still has the files of the job {string}', (world: object, name: string) => {
  expect(programOf(world).directories.has(jobOf(world, name)['NZBID'] as number)).toBe(true);
});

Then('the NZBGet has deleted the files it had for job {int}', (world: object, id: number) => {
  expect(programOf(world).directories.has(id)).toBe(false);
});

Then('every request to the NZBGet carried the login and asked it to close the connection', (world: object) => {
  const calls = programOf(world).calls;
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) expect(call.headers).toMatchObject({ authorization: expect.stringMatching(/^Basic /) as unknown, connection: 'close' });
});

Then('no request to the NZBGet carried a login', (world: object) => {
  expect(programOf(world).calls.map((call) => call.headers.authorization)).toEqual([undefined]);
});
