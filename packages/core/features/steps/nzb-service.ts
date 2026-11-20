import { expect } from 'vitest';
import { After, Given, When, type DataTable } from 'quickpickle';
import { MemoryNzbClient } from './memory-nzb-client.js';
import { nzbDocument } from './nzb-documents.js';
import './nzb-outcomes.js';
import { addRequest, answered, answerTo, backendId, base64, downloaderId, jobId, lastJobs, nzb, pause, post, request, service, setup, until, type NzbState, type Wire } from './nzb-world.js';
import { scratch, type CoreWorld } from './world.js';

type Method = 'categories' | 'add' | 'list' | 'get' | 'control';

const HANDLES_KEY = 'kernl:nzb-handles:v1';
const REPLAY_KEY = 'kernl:nzb-replay:v1';
/** What the memory downloader puts in its failures; none of it may ever reach an applet or a question. */
const SECRETS = ['10.0.0.9', 'hunter2', 'jsonrpc'];

After(async (world: CoreWorld) => {
  const state = scratch(world).nzb as NzbState | undefined;
  if (!state) return;
  state.service?.dispose();
  for (const downloader of state.downloaders) downloader.client.release();
  const said = JSON.stringify([[...state.sent.values()], state.questions]);
  for (const secret of SECRETS) expect(said).not.toContain(secret);
});

async function add(world: CoreWorld, windowId: string, target: { document: string; label: string; key: string }, table?: DataTable): Promise<Wire> {
  const state = nzb(world);
  return request(state, windowId, await addRequest(state, windowId, target, table?.rowsHash()), { key: target.key });
}

const jobsRequest = async (state: NzbState, windowId: string, label: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> => ({
  type: 'nzb.jobs',
  request: { downloaderId: await downloaderId(state, windowId, label), ...extra },
});

async function listJobs(world: CoreWorld, windowId: string, label: string, extra?: Record<string, unknown>): Promise<void> {
  const state = nzb(world);
  const answer = await request(state, windowId, await jobsRequest(state, windowId, label, extra));
  state.seen.push(...(lastJobs(answer) ?? []).map((job) => job.jobId));
}

Given('the NZB clock reads {int}', (world: CoreWorld, seconds: number) => {
  nzb(world).clock = seconds * 1000;
});

Given('the person set up the NZB downloader {string}', (world: CoreWorld, label: string) => {
  nzb(world).downloaders.push({ key: `program-${label.toLowerCase()}`, label, client: new MemoryNzbClient() });
});

Given('the person set up the NZB downloader {string}, which cannot cancel or retry and takes no options', (world: CoreWorld, label: string) => {
  const client = new MemoryNzbClient();
  client.actions = ['pause', 'resume', 'forget', 'delete'];
  client.addOptions = [];
  nzb(world).downloaders.push({ key: `program-${label.toLowerCase()}`, label, client });
});

Given('the person set up a second NZB downloader under the key of {string}, called {string}', (world: CoreWorld, first: string, label: string) => {
  const state = nzb(world);
  state.downloaders.push({ key: setup(state, first).key, label, client: new MemoryNzbClient() });
});

Given('the person removed every NZB downloader', (world: CoreWorld) => {
  nzb(world).downloaders.length = 0;
});

Given('the applet {string} may use NZB downloads', (world: CoreWorld, name: string) => {
  nzb(world).applets.set(name, name);
});

Given("another publisher's applet, also called {string}, may use NZB downloads as {string}", (world: CoreWorld, name: string, window: string) => {
  nzb(world).applets.set(window, `other-pk:${name}`);
});

Given('the NZB downloader {string} has the categories {string}', (world: CoreWorld, label: string, names: string) => {
  setup(nzb(world), label).client.categoryNames = names.split(', ');
});

Given('the person removes the category {string} from the NZB downloader {string}', (world: CoreWorld, name: string, label: string) => {
  const { client } = setup(nzb(world), label);
  client.categoryNames = client.categoryNames.filter((category) => category !== name);
});

Given('the shell can fetch NZB documents by address', (world: CoreWorld) => {
  nzb(world).fetcher = true;
});

Given('the address {string} serves the NZB document {string}', (world: CoreWorld, url: string, document: string) => {
  nzb(world).pages.set(url, document);
});

Given('the NZB address {string} never finishes', (world: CoreWorld, url: string) => {
  nzb(world).pages.set(url, 'never');
});

Given('the NZB downloader {string} cannot be reached', (world: CoreWorld, label: string) => {
  setup(nzb(world), label).client.silent = true;
});

Given('the person will say {word} to NZB questions', (world: CoreWorld, word: string) => {
  nzb(world).answer = word === 'yes';
});

Given('the person never answers NZB questions', (world: CoreWorld) => {
  nzb(world).answer = 'never';
});

Given('{string} is closed while the person is asked about NZB', (world: CoreWorld, windowId: string) => {
  const state = nzb(world);
  state.whileAsked.push(() => service(state).handler.onWindowDestroyed?.(windowId));
});

Given('the NZB permission of {string} is taken back while the person is asked', (world: CoreWorld, windowId: string) => {
  const state = nzb(world);
  state.whileAsked.push(() => service(state).handler.onPermissionRevoked?.(windowId));
});

When('the NZB permission of {string} is taken back', (world: CoreWorld, windowId: string) => {
  service(nzb(world)).handler.onPermissionRevoked?.(windowId);
});

Given('the shell fails to ask NZB questions', (world: CoreWorld) => {
  nzb(world).answer = 'broken';
});

When('the runtime turns away the NZB message {string} from {string}', (world: CoreWorld, text: string, windowId: string) => {
  const state = nzb(world);
  const message = JSON.parse(text) as Wire;
  state.awaiting.set(windowId, String(message.id));
  service(state).handler.onPermissionDenied?.(windowId, message, 'denied' as never, (answer) => {
    state.sent.set(windowId, [...(state.sent.get(windowId) ?? []), answer as Wire]);
    state.counted.set(windowId, [...(state.counted.get(windowId) ?? []), answer as Wire]);
  });
});

Given('the NZB clock is the real one', (world: CoreWorld) => {
  nzb(world).clock = undefined;
});

Given('the NZB downloader {string} answers a repeated document with the job it already has', (world: CoreWorld, label: string) => {
  setup(nzb(world), label).client.joinDuplicates = true;
});

Given('the NZB downloader {string} will decline the next add', (world: CoreWorld, label: string) => {
  setup(nzb(world), label).client.failNext('add', 'unavailable:rejected');
});

Given('the NZB downloader {string} stops answering once it has taken a(n) {word}', (world: CoreWorld, label: string, method: string) => {
  setup(nzb(world), label).client.silentAfter = method as Method;
});

Given('the NZB downloader {string} takes the next add but its answer is lost', (world: CoreWorld, label: string) => {
  setup(nzb(world), label).client.loseNextAdd = true;
});

Given('the NZB downloader {string} fails the next {string} with {string}', (world: CoreWorld, label: string, method: string, reason: string) => {
  setup(nzb(world), label).client.failNext(method as Method, reason);
});

Given('the NZB downloader {string} holds the next {string} open', (world: CoreWorld, label: string, method: string) => {
  setup(nzb(world), label).client.hold(method as Method);
});

Given('the NZB downloader {string} lets the held call go', async (world: CoreWorld, label: string) => {
  setup(nzb(world), label).client.release();
  await pause(30);
});

Given('the NZB downloader {string} retries a job in place', (world: CoreWorld, label: string) => {
  setup(nzb(world), label).client.retryInPlace = true;
});

Given('the person added a download of their own to the NZB downloader {string}', (world: CoreWorld, label: string) => {
  setup(nzb(world), label).client.addOwn('The person’s own');
});

When('{string} asks for the NZB downloaders', async (world: CoreWorld, windowId: string) => {
  await request(nzb(world), windowId, { type: 'nzb.downloaders' });
});

When('{string} adds the NZB document {string} to {string} under the key {string}', (world: CoreWorld, windowId: string, document: string, label: string, key: string) => add(world, windowId, { document, label, key }));

When('{string} adds the NZB document {string} to {string} under the key {string} with:', (world: CoreWorld, windowId: string, document: string, label: string, key: string, table: DataTable) =>
  add(world, windowId, { document, label, key }, table),
);

When('{string} starts adding the NZB document {string} to {string} under the key {string}', async (world: CoreWorld, windowId: string, document: string, label: string, key: string) => {
  const state = nzb(world);
  post(state, windowId, await addRequest(state, windowId, { document, label, key }));
  await pause(30);
});

When('{string} adds the NZB document {string} to {string} under the key {string} and gets no answer', async (world: CoreWorld, windowId: string, document: string, label: string, key: string) => {
  const state = nzb(world);
  const id = post(state, windowId, await addRequest(state, windowId, { document, label, key }));
  await pause(50);
  expect(answerTo(state, windowId, id)).toBeUndefined();
});

When('{string} adds the NZB document {string} to {string} in {string} under the key {string}, twice, the first held up while its category is checked', async (world: CoreWorld, windowId: string, document: string, label: string, category: string, key: string) => {
  const state = nzb(world);
  const { client } = setup(state, label);
  const body = await addRequest(state, windowId, { document, label, key }, { category });
  client.hold('categories');
  const ids = [post(state, windowId, body), post(state, windowId, body)];
  await until(() => answerTo(state, windowId, ids[1] as string) !== undefined, 'the second answer');
  client.release();
  await until(() => answerTo(state, windowId, ids[0] as string) !== undefined, 'the first answer');
  scratch(world).nzbPair = ids.map((id) => answerTo(state, windowId, id));
});

When('{string} adds {int} NZB documents to {string}', async (world: CoreWorld, windowId: string, count: number, label: string) => {
  for (let index = 0; index < count; index += 1) await add(world, windowId, { document: 'one file', label, key: `many-${index}` });
});

When('{string} adds the NZB document {string} to a downloader it made up', async (world: CoreWorld, windowId: string, document: string) => {
  await request(nzb(world), windowId, { type: 'nzb.add', request: { downloaderId: 'program-home', operationKey: 'made-up', source: { kind: 'bytes', dataBase64: base64(nzbDocument(document)) } } });
});

When('{string} adds the NZB document {string} to {string} in a category it made up', async (world: CoreWorld, windowId: string, document: string, label: string) => {
  const state = nzb(world);
  const body = await addRequest(state, windowId, { document, label, key: 'made-up' });
  await request(state, windowId, { ...body, request: { ...(body.request as object), categoryId: 'films' } });
});

When('{string} adds an NZB by the address {string} to {string} under the key {string}', async (world: CoreWorld, windowId: string, url: string, label: string, key: string) => {
  const state = nzb(world);
  await request(state, windowId, { type: 'nzb.add', request: { downloaderId: await downloaderId(state, windowId, label), operationKey: key, source: { kind: 'url', url } } }, { key });
});

When('{string} adds an NZB by the address {string} to {string} in {string} under the key {string}', async (world: CoreWorld, windowId: string, url: string, label: string, category: string, key: string) => {
  const state = nzb(world);
  const request_ = { downloaderId: await downloaderId(state, windowId, label), operationKey: key, source: { kind: 'url', url }, categoryId: state.names.get(`${windowId}/category/${category}`) };
  await request(state, windowId, { type: 'nzb.add', request: request_ }, { key });
});

When('{string} starts adding an NZB by the address {string} to {string} under the key {string}', async (world: CoreWorld, windowId: string, url: string, label: string, key: string) => {
  const state = nzb(world);
  post(state, windowId, { type: 'nzb.add', request: { downloaderId: await downloaderId(state, windowId, label), operationKey: key, source: { kind: 'url', url } } });
  await pause(30);
});

When('the NZB downloader {string} {word} the job {string}', (world: CoreWorld, label: string, verb: string, key: string) => {
  const state = nzb(world);
  const job = setup(state, label).client.jobs.get(backendId(state, key));
  Object.assign(job as object, { state: verb === 'finishes' ? 'completed' : 'failed', paused: false });
});

When('the NZB downloader {string} reports the job {string} as:', (world: CoreWorld, label: string, key: string, table: DataTable) => {
  const state = nzb(world);
  const { state: phase, ...rest } = table.rowsHash();
  const extra = Object.fromEntries(Object.entries(rest).map(([field, value]) => [field, Number.isNaN(Number(value)) ? value : Number(value)]));
  Object.assign(setup(state, label).client.jobs.get(backendId(state, key)) as object, { state: phase, extra });
});

When('the person removes the job {string} from the NZB downloader {string}', (world: CoreWorld, key: string, label: string) => {
  const state = nzb(world);
  setup(state, label).client.jobs.delete(backendId(state, key));
});

When('the NZB downloader {string} gives the number of the job {string} to a download of the person\'s', (world: CoreWorld, label: string, key: string) => {
  const state = nzb(world);
  const id = backendId(state, key);
  setup(state, label).client.jobs.set(id, { id, name: 'Somebody else’s', state: 'queued', paused: false, extra: {} });
});

When('the job {string} starts again in the NZB downloader {string} while the person is asked', (world: CoreWorld, key: string, label: string) => {
  const state = nzb(world);
  const job = setup(state, label).client.jobs.get(backendId(state, key));
  state.whileAsked.push(() => Object.assign(job as object, { state: 'downloading' }));
});

When('the NZB clock moves on {int} seconds', (world: CoreWorld, seconds: number) => {
  const state = nzb(world);
  state.clock = (state.clock as number) + seconds * 1000;
});

When('the shell is reloaded with its NZB records kept', (world: CoreWorld) => {
  const state = nzb(world);
  state.before = new Map(state.names);
  state.service = undefined;
});

When('the shell loses its NZB job handles', (world: CoreWorld) => {
  const { storage } = nzb(world);
  storage.setItem(HANDLES_KEY, JSON.stringify({ ...JSON.parse(storage.getItem(HANDLES_KEY) as string), jobs: [] }));
});

When("the shell's NZB records are damaged", (world: CoreWorld) => {
  const { storage } = nzb(world);
  const record = { applet: 'reader', digest: 'd', replayUntil: 9_999_999_999, dispatched: true, jobIds: [] };
  storage.setItem(HANDLES_KEY, JSON.stringify({ downloaders: 'none', categories: [null, { applet: 1 }, 'text'], jobs: [{ applet: 'reader', id: 'x', key: 'program-home', backend: '1' }] }));
  storage.setItem(
    REPLAY_KEY,
    JSON.stringify({
      a: null,
      b: { ...record, jobIds: 'x' },
      c: { ...record, replayUntil: 1.5 },
      d: { ...record, outcome: 5 },
      e: { ...record, outcome: { error: { code: 1 } } },
      f: { ...record, outcome: { error: { code: 'x', message: 2 } } },
      g: { ...record, jobIds: [1] },
      h: { ...record, applet: 1 },
      i: { ...record, digest: 2 },
      j: { ...record, dispatched: 'yes' },
      k: { ...record, outcome: { error: null } },
    }),
  );
});

When('{string} lists its NZB jobs on {string}', (world: CoreWorld, windowId: string, label: string) => listJobs(world, windowId, label));

When('{string} lists its NZB jobs on {string}, {int} at a time', (world: CoreWorld, windowId: string, label: string, limit: number) => {
  nzb(world).seen.length = 0;
  return listJobs(world, windowId, label, { limit });
});

When('{string} lists its NZB jobs on {string}, {int} at a time, after the last it saw', (world: CoreWorld, windowId: string, label: string, limit: number) =>
  listJobs(world, windowId, label, { limit, after: nzb(world).seen.at(-1) }),
);

When('{string} starts listing its NZB jobs on {string}', async (world: CoreWorld, windowId: string, label: string) => {
  const state = nzb(world);
  post(state, windowId, await jobsRequest(state, windowId, label));
  await pause(30);
});

When('{string} lists its NZB jobs on {string} twice under one id before the first is answered', async (world: CoreWorld, windowId: string, label: string) => {
  const state = nzb(world);
  const body = { ...(await jobsRequest(state, windowId, label)), id: 'same' };
  post(state, windowId, body);
  post(state, windowId, body);
  await pause(30);
  setup(state, label).client.release();
  await answered(state, windowId);
  await pause(30);
});

When('{string} lists its NZB jobs on {string} {int} times at once', async (world: CoreWorld, windowId: string, label: string, times: number) => {
  const state = nzb(world);
  const body = await jobsRequest(state, windowId, label);
  for (let index = 0; index < times; index += 1) post(state, windowId, body);
  await answered(state, windowId);
});

When('{string} lists NZB jobs on the downloader as {string} knows it', async (world: CoreWorld, windowId: string, other: string) => {
  const state = nzb(world);
  await request(state, windowId, { type: 'nzb.jobs', request: { downloaderId: await downloaderId(state, other, 'Home') } });
});

When('{string} asks for the status of the NZB job {string}', async (world: CoreWorld, windowId: string, key: string) => {
  const state = nzb(world);
  await request(state, windowId, { type: 'nzb.status', jobId: jobId(state, windowId, key) });
});

When('{string} asks to {string} the NZB job {string} under the key {string}', async (world: CoreWorld, windowId: string, action: string, key: string, operationKey: string) => {
  const state = nzb(world);
  await request(state, windowId, { type: 'nzb.control', request: { jobId: jobId(state, windowId, key), operationKey, action } });
});

When('{string} asks to {string} and to {string} the NZB job {string} at once', async (world: CoreWorld, windowId: string, first: string, second: string, key: string) => {
  const state = nzb(world);
  // The first is held inside the downloader so the second arrives while it is under way.
  const { client } = setup(state, 'Home');
  client.hold('control');
  const ids = [first, second].map((action) => post(state, windowId, { type: 'nzb.control', request: { jobId: jobId(state, windowId, key), operationKey: `${action}-at-once`, action } }));
  await pause(30);
  client.release();
  await until(() => ids.every((id) => answerTo(state, windowId, id)), 'both answers');
  scratch(world).nzbPair = ids.map((id) => answerTo(state, windowId, id));
});

When('{string} asks for the files of the NZB job {string}', async (world: CoreWorld, windowId: string, key: string) => {
  const state = nzb(world);
  await request(state, windowId, { type: 'nzb.files', request: { jobId: jobId(state, windowId, key), limit: 10 } });
});

When('{string} asks to read from the NZB job {string}', async (world: CoreWorld, windowId: string, key: string) => {
  const state = nzb(world);
  await request(state, windowId, { type: 'nzb.read', request: { jobId: jobId(state, windowId, key), fileId: 'file-a', offset: 0, length: 8 } });
});

async function filled(state: NzbState, windowId: string, template: string): Promise<Record<string, unknown>> {
  const home = template.includes('$Home') ? await downloaderId(state, windowId, 'Home') : '';
  const text = template.replace('$Home', home).replace('$long', 'x'.repeat(1025)).replace(/\$(\w+)/g, (_whole, key: string) => jobId(state, windowId, key));
  return JSON.parse(text) as Record<string, unknown>;
}

When('{string} sends the NZB message {string}', async (world: CoreWorld, windowId: string, template: string) => {
  const state = nzb(world);
  await request(state, windowId, await filled(state, windowId, template));
});

When('{string} sends the NZB message {string} and gets no answer', async (world: CoreWorld, windowId: string, template: string) => {
  const state = nzb(world);
  const before = (state.sent.get(windowId) ?? []).length;
  service(state).handler.handleMessage(windowId, JSON.parse(template), (message) => state.sent.get(windowId)?.push(message as Wire));
  await pause(30);
  expect((state.sent.get(windowId) ?? []).length).toBe(before);
});

When('{string} and {string} both send the NZB message {string}', async (world: CoreWorld, first: string, second: string, template: string) => {
  const state = nzb(world);
  await Promise.all([first, second].map(async (windowId) => request(state, windowId, await filled(state, windowId, template))));
});

When('the NZB window of {string} is closed', (world: CoreWorld, windowId: string) => {
  const state = nzb(world);
  state.applets.delete(windowId);
  service(state).handler.onWindowDestroyed?.(windowId);
});

When('the NZB window of {string} now runs another applet', (world: CoreWorld, windowId: string) => {
  nzb(world).applets.set(windowId, 'another-applet');
});

When('the NZB service is torn down', (world: CoreWorld) => {
  service(nzb(world)).dispose();
});

