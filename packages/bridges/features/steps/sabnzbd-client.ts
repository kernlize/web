import { expect } from 'vitest';
import { After, Given, Then, type DataTable, type DocString } from 'quickpickle';
import { createSabnzbdClient } from '../../src/clients/sabnzbd';
import type { NzbClient } from '../../src/clients/types';
import { startFakeSabnzbd, type FakeSabnzbd, type SabnzbdFault, type SabnzbdRequest } from './fake-sabnzbd';
import { defineNzbClientSteps, type NzbClientScenario } from './nzbget-client';
import { splitList } from './world';

type Json = Record<string, unknown>;

interface SabnzbdScenario extends NzbClientScenario {
  program?: FakeSabnzbd;
  apiKey?: string;
  timeoutMs?: number;
  made?: NzbClient;
  /** The id each job had when it was first seen, to tell a successor from the original. */
  firstIds: Map<string, string>;
}

const scenarios = new WeakMap<object, SabnzbdScenario>();

function scenarioOf(world: object): SabnzbdScenario {
  let scenario = scenarios.get(world);
  if (!scenario) {
    scenario = { firstIds: new Map() };
    scenarios.set(world, scenario);
  }
  return scenario;
}

function programOf(world: object): FakeSabnzbd {
  const program = scenarioOf(world).program;
  if (!program) throw new Error('no SABnzbd');
  return program;
}

function jobOf(world: object, name: string): Json {
  const program = programOf(world);
  const job = [...program.queue.filter((slot) => slot['filename'] === name), ...program.history.filter((slot) => slot['name'] === name)][0];
  if (!job) throw new Error(`SABnzbd has no job ${name}`);
  return job;
}

function idOf(world: object, name: string): string {
  const id = String(jobOf(world, name)['nzo_id']);
  const firstIds = scenarioOf(world).firstIds;
  if (!firstIds.has(name)) firstIds.set(name, id);
  return id;
}

function sent(world: object, request: string): SabnzbdRequest[] {
  return programOf(world).requests.filter((entry) => entry.request === request);
}

function changes(world: object): string[] {
  return programOf(world)
    .requests.map((entry) => entry.request)
    .filter((request) => !['queue', 'history', 'get_cats', 'version'].includes(request));
}

function tableOf(table: DataTable): Json {
  return Object.fromEntries(table.raw().map(([key = '', value = '']) => [key, /^-?\d+$/.test(value) ? Number(value) : value === 'true' ? true : value === 'false' ? false : value]));
}

function fault(world: object, request: string, rest: Omit<SabnzbdFault, 'request'>): void {
  programOf(world).faults.push({ request, ...rest });
}

async function start(world: object, apiKey?: string): Promise<void> {
  const scenario = scenarioOf(world);
  const program = await startFakeSabnzbd();
  program.apiKey = apiKey;
  scenario.program = program;
  if (apiKey !== undefined) scenario.apiKey = apiKey;
  scenario.idOf = (name) => idOf(world, name);
  scenario.client = () => {
    scenario.made ??= createSabnzbdClient({
      endpoint: { url: `${program.url}/`, ...(scenario.apiKey === undefined ? {} : { apiKey: scenario.apiKey }) },
      ...(scenario.timeoutMs === undefined ? {} : { timeoutMs: scenario.timeoutMs }),
    });
    return scenario.made;
  };
}

After(async (world: object) => {
  await scenarios.get(world)?.program?.close();
});

defineNzbClientSteps('SABnzbd', scenarioOf);

Given('a SABnzbd that asks for the key {string}', (world: object, apiKey: string) => start(world, apiKey));

Given('a SABnzbd that asks for no key', (world: object) => start(world));

Given('the SABnzbd client uses the key {string}', (world: object, apiKey: string) => {
  scenarioOf(world).apiKey = apiKey;
});

Given('the SABnzbd client has no key', (world: object) => {
  delete scenarioOf(world).apiKey;
});

Given('the SABnzbd is old enough to answer a wrong key with status 200 as {word}', (world: object, form: string) => {
  programOf(world).keyRefusal = form === 'JSON' ? 'json' : 'plain';
});

Given('the SABnzbd client waits {int} ms for an answer', (world: object, timeoutMs: number) => {
  scenarioOf(world).timeoutMs = timeoutMs;
});

Given('the SABnzbd is switched off', async (world: object) => {
  await programOf(world).close();
});

Given('the SABnzbd is paused as a whole', (world: object) => {
  programOf(world).paused = true;
});

Given('the SABnzbd is transferring', (world: object) => {
  programOf(world).transferring = true;
});

Given('the SABnzbd has the job {string} waiting in its queue', (world: object, name: string) => {
  programOf(world).seedQueue({ filename: name });
});

Given('the SABnzbd has the job {string} held in its queue', (world: object, name: string) => {
  programOf(world).seedQueue({ filename: name, status: 'Paused' });
});

Given('the SABnzbd has the job {string} in its queue with:', (world: object, name: string, table: DataTable) => {
  programOf(world).seedQueue({ filename: name, ...tableOf(table) });
});

Given('the SABnzbd has the job {string} in its history as {string}', (world: object, name: string, status: string) => {
  programOf(world).seedHistory({ name, status });
});

Given('the SABnzbd has the job {string} in its history with:', (world: object, name: string, table: DataTable) => {
  programOf(world).seedHistory({ name, ...tableOf(table) });
});

Given('the SABnzbd has the failed job {string} with its partial files', (world: object, name: string) => {
  const slot = programOf(world).seedHistory({
    name,
    status: 'Failed',
    retry: true,
    bytes: 0,
    downloaded: 0,
    storage: `/config/Downloads/incomplete/${name}`,
    fail_message: 'Download failed - Not on your server(s) - https://sabnzbd.org/not-complete',
  });
  programOf(world).folders.add(String(slot['nzo_id']));
});

Given('the SABnzbd has {int} completed jobs in its history', (world: object, count: number) => {
  for (let index = 1; index <= count; index += 1) programOf(world).seedHistory({ name: `Finished ${index}` });
});

Given('the SABnzbd lists the job {string} in its queue and in its history as {string}', (world: object, name: string, status: string) => {
  const queued = programOf(world).seedQueue({ filename: name });
  programOf(world).seedHistory({ name, status, nzo_id: queued['nzo_id'] });
});

Given('the SABnzbd answers {string} without doing it', (world: object, request: string) => {
  programOf(world).inert.add(request);
});

Given('the SABnzbd is old enough to retry without naming the new job', (world: object) => {
  programOf(world).namesSuccessor = false;
});

Given('the SABnzbd answers {string} with status {int}', (world: object, request: string, status: number) => {
  fault(world, request, { kind: 'answer', status, body: '{"status":true}' });
});

Given('the SABnzbd answers {string} with the body:', (world: object, request: string, body: DocString) => {
  fault(world, request, { kind: 'answer', body: body.toString() });
});

Given('the SABnzbd hangs up on {string}', (world: object, request: string) => {
  fault(world, request, { kind: 'hang-up' });
});

Given('the SABnzbd hangs up on {string} the second time it is asked', (world: object, request: string) => {
  fault(world, request, { kind: 'hang-up', skip: 1 });
});

Given('the SABnzbd never answers {string}', (world: object, request: string) => {
  fault(world, request, { kind: 'silence' });
});

Then('the SABnzbd was handed the file {string} under the job name {string}', (world: object, fileName: string, jobName: string) => {
  const [added] = sent(world, 'addfile');
  expect([added?.upload?.fileName, added?.fields['nzbname']]).toEqual([fileName, jobName]);
});

Then('the SABnzbd was handed the fields:', (world: object, table: DataTable) => {
  const [added] = sent(world, 'addfile');
  const { apikey: _key, output: _output, mode: _mode, nzbname: _name, ...fields } = added?.fields ?? {};
  expect(fields).toEqual(Object.fromEntries(table.raw()));
});

Then('the SABnzbd was handed no options', (world: object) => {
  const [added] = sent(world, 'addfile');
  expect(Object.keys(added?.fields ?? {}).sort()).toEqual(['mode', 'nzbname', 'output']);
});

Then('the SABnzbd was handed {int} bytes', (world: object, size: number) => {
  expect(sent(world, 'addfile')[0]?.upload?.text).toHaveLength(size);
});

Then('the SABnzbd was handed nothing', (world: object) => {
  expect(sent(world, 'addfile')).toEqual([]);
});

Then('the SABnzbd holds the job {string} as:', (world: object, name: string, table: DataTable) => {
  const job = jobOf(world, name);
  expect(table.raw().map(([field = '']) => [field, String(job[field])])).toEqual(table.raw());
});

Then('the SABnzbd was asked to {string}', (world: object, requests: string) => {
  expect(changes(world)).toEqual(splitList(requests));
});

Then('the SABnzbd was not asked to change anything', (world: object) => {
  expect(changes(world)).toEqual([]);
});

Then('the SABnzbd was asked to remove the job with {string} set to {string}', (world: object, field: string, value: string) => {
  expect(sent(world, 'history.delete').map((entry) => entry.fields[field])).toEqual([value]);
});

Then('the SABnzbd has no job {string}', (world: object, name: string) => {
  const program = programOf(world);
  expect([...program.queue.filter((slot) => slot['filename'] === name), ...program.history.filter((slot) => slot['name'] === name)]).toEqual([]);
});

Then('the SABnzbd job {string} has a new id', (world: object, name: string) => {
  const first = scenarioOf(world).firstIds.get(name);
  expect(first).toBeDefined();
  expect(String(jobOf(world, name)['nzo_id'])).not.toBe(first);
});

Then('the SABnzbd still has the partial files of {int} job(s)', (world: object, count: number) => {
  expect(programOf(world).folders.size).toBe(count);
});

Then('the SABnzbd is still not paused as a whole', (world: object) => {
  expect(programOf(world).paused).toBe(false);
});

Then('every request to the SABnzbd was a POST with nothing in its address', (world: object) => {
  const requests = programOf(world).requests;
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.map((entry) => [entry.method, entry.query])).toEqual(requests.map(() => ['POST', '']));
});

Then('no request to the SABnzbd carried a key', (world: object) => {
  expect(programOf(world).requests.map((entry) => entry.fields['apikey'])).toEqual(programOf(world).requests.map(() => undefined));
});
