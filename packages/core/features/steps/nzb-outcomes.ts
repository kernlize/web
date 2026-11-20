import { expect } from 'vitest';
import { Then, type DataTable } from 'quickpickle';
import { readNzbDocument } from '../../src/downloads/nzb-service.js';
import { nzbDocument } from './nzb-documents.js';
import { answered, everythingSent, jobId, jobOf, lastJobs, nzb, pause, setup, until, type Wire } from './nzb-world.js';
import { scratch, type CoreWorld } from './world.js';

type Method = 'categories' | 'add' | 'list' | 'get' | 'control';

const HANDLES_KEY = 'kernl:nzb-handles:v1';

function failedAs(answer: Wire, code: string): void {
  expect(answer.result).toBeUndefined();
  expect(answer.error?.code).toBe(code);
  expect(answer.error?.message).toMatch(/\S/);
}

Then('{string} is offered {int} NZB downloaders', async (world: CoreWorld, windowId: string, count: number) => {
  expect((await answered(nzb(world), windowId)).result?.downloaders).toHaveLength(count);
});

const described = async (world: CoreWorld, windowId: string, label: string): Promise<Record<string, unknown>> => {
  const listed = (await answered(nzb(world), windowId)).result?.downloaders as Array<Record<string, unknown>>;
  return listed.find((downloader) => downloader.label === label) as Record<string, unknown>;
};

Then('the NZB downloader {string} is described to {string} as:', async (world: CoreWorld, label: string, windowId: string, table: DataTable) => {
  const downloader = await described(world, windowId, label);
  for (const [field, value] of Object.entries(table.rowsHash())) expect(downloader[field], field).toEqual(JSON.parse(value));
});

Then('the NZB downloader {string} offers {string} the categories {string}', async (world: CoreWorld, label: string, windowId: string, names: string) => {
  const categories = (await described(world, windowId, label)).categories as Array<{ label: string }>;
  expect(categories.map((category) => category.label)).toEqual(names.split(', '));
});

Then("every NZB category description says the downloader's own settings decide where files go", async (world: CoreWorld) => {
  const categories = (await described(world, 'reader', 'Home')).categories as Array<{ description: string }>;
  for (const category of categories) expect(category.description).toBe('The settings Home keeps for this category decide where files go and what is done with them afterwards');
});

Then("no NZB handle {string} was given is a downloader's key, a category's own name or a job number", (world: CoreWorld, windowId: string) => {
  const state = nzb(world);
  const handles = [...state.names].filter(([name]) => name.startsWith(`${windowId}/`)).map(([, handle]) => handle);
  expect(handles.length).toBeGreaterThan(2);
  for (const handle of handles) expect(handle).toMatch(/^[0-9a-f-]{36}$/);
  expect(everythingSent(state, windowId)).not.toContain('program-home');
});

Then('{string} knows the NZB downloader {string} by the same name as before the reload', (world: CoreWorld, windowId: string, label: string) => {
  const state = nzb(world);
  expect(state.names.get(`${windowId}/downloader/${label}`)).toBe(state.before.get(`${windowId}/downloader/${label}`));
});

Then('{string} and {string} know the NZB downloader {string} by different names', (world: CoreWorld, first: string, second: string, label: string) => {
  const state = nzb(world);
  expect(state.names.get(`${first}/downloader/${label}`)).toMatch(/\S/);
  expect(state.names.get(`${first}/downloader/${label}`)).not.toBe(state.names.get(`${second}/downloader/${label}`));
});

Then('the person was asked the NZB question {string} as a(n) {string} for {string}', (world: CoreWorld, title: string, kind: string, windowId: string) => {
  const asked = nzb(world).questions.at(-1);
  expect(asked?.windowId).toBe(windowId);
  expect(asked?.question.title).toBe(title);
  expect(asked?.question.kind).toBe(kind);
});

Then('the NZB question says {string} is {string}', (world: CoreWorld, label: string, value: string) => {
  expect(nzb(world).questions.at(-1)?.question.lines.find((line) => line.label === label)?.value).toBe(value);
});

Then('the person was asked about NZB {int} times', (world: CoreWorld, times: number) => {
  expect(nzb(world).questions).toHaveLength(times);
});

Then('{string} is told the NZB job {string} is {string}, replayable until {int}', async (world: CoreWorld, windowId: string, key: string, phase: string, replayUntil: number) => {
  const state = nzb(world);
  const answer = await answered(state, windowId);
  expect(answer.error).toBeUndefined();
  expect(jobOf(answer).jobId).toBe(jobId(state, windowId, key));
  expect(jobOf(answer).state).toBe(phase);
  expect(jobOf(answer).downloaderId).toBe(state.names.get(`${windowId}/downloader/Home`));
  expect(answer.result?.replayUntil).toBe(replayUntil);
});

Then('the answer about the NZB job says:', async (world: CoreWorld, table: DataTable) => {
  const job = jobOf(await answered(nzb(world), 'reader'));
  for (const [field, value] of Object.entries(table.rowsHash())) expect(job[field], field).toEqual(JSON.parse(value));
});

Then('the answer about the NZB job names no category', async (world: CoreWorld) => {
  expect(jobOf(await answered(nzb(world), 'reader'))).not.toHaveProperty('categoryId');
});

Then('the NZB job was observed within 5 seconds of now', async (world: CoreWorld) => {
  const job = jobOf(await answered(nzb(world), 'reader'));
  expect(Math.abs((job.observedAt as number) - Date.now() / 1000)).toBeLessThan(5);
  expect(Number.isInteger(job.observedAt)).toBe(true);
});

Then("the NZB job's category is the one {string} chose", async (world: CoreWorld, windowId: string) => {
  const state = nzb(world);
  expect(jobOf(await answered(state, windowId)).categoryId).toBe(state.names.get(`${windowId}/category/films`));
});

Then('the NZB downloader {string} was handed {string} as {string} in {string} at {string} priority, paused, with the password {string}', (world: CoreWorld, label: string, ...[document, name, category, priority, password]: string[]) => {
  expect(setup(nzb(world), label).client.added).toEqual([{ bytes: nzbDocument(document as string), name, category, priority, paused: true, password }]);
});

Then('the NZB downloader {string} was handed {string} as {string} with no category', (world: CoreWorld, label: string, document: string, name: string) => {
  expect(setup(nzb(world), label).client.added).toEqual([{ bytes: nzbDocument(document), name }]);
});

Then('the NZB downloader {string} was handed nothing', (world: CoreWorld, label: string) => {
  expect(setup(nzb(world), label).client.added).toEqual([]);
});

Then('no NZB downloader was handed anything', (world: CoreWorld) => {
  for (const downloader of nzb(world).downloaders) expect(downloader.client.added).toEqual([]);
});

Then('the NZB downloader {string} was asked to {word} {int} times', (world: CoreWorld, label: string, method: string, times: number) => {
  expect(setup(nzb(world), label).client.count(method as Method)).toBe(times);
});

Then('the NZB downloader {string} erased the files of {int} jobs', (world: CoreWorld, label: string, count: number) => {
  expect(setup(nzb(world), label).client.erased).toHaveLength(count);
});

Then('the NZB downloader {string} holds {int} jobs', (world: CoreWorld, label: string, count: number) => {
  expect(setup(nzb(world), label).client.jobs.size).toBe(count);
});

Then('nothing {string} was sent contains {string}', (world: CoreWorld, windowId: string, secret: string) => {
  expect(everythingSent(nzb(world), windowId)).not.toContain(secret);
});

Then('nothing {string} was sent or the person was asked contains {string} or {string}', (world: CoreWorld, windowId: string, first: string, second: string) => {
  const state = nzb(world);
  const said = everythingSent(state, windowId) + JSON.stringify(state.questions);
  expect(said).not.toContain(first);
  expect(said).not.toContain(second);
});

Then('{string} is told the NZB request failed as {string} with no replay time', async (world: CoreWorld, windowId: string, code: string) => {
  const answer = await answered(nzb(world), windowId);
  failedAs(answer, code);
  expect(answer.error).not.toHaveProperty('replayUntil');
});

Then('{string} is told the NZB request failed as {string}, replayable until {int}', async (world: CoreWorld, windowId: string, code: string, replayUntil: number) => {
  const answer = await answered(nzb(world), windowId);
  failedAs(answer, code);
  expect(answer.error?.replayUntil).toBe(replayUntil);
});

Then('the last NZB answer to {string} failed as {string}', async (world: CoreWorld, windowId: string, code: string) => {
  failedAs(await answered(nzb(world), windowId), code);
});

Then('{string} got {int} NZB answers in all', async (world: CoreWorld, windowId: string, count: number) => {
  await pause(30);
  expect(nzb(world).counted.get(windowId) ?? []).toHaveLength(count);
});

Then('both NZB answers are the same job', (world: CoreWorld) => {
  const [first, second] = scratch(world).nzbPair as [Wire, Wire];
  expect(jobOf(first).jobId).toMatch(/\S/);
  expect(second.result).toEqual(first.result);
});

Then('the first NZB answer is the job, {string}, and the second failed as {string}', (world: CoreWorld, phase: string, code: string) => {
  const [first, second] = scratch(world).nzbPair as [Wire, Wire];
  expect(jobOf(first).state).toBe(phase);
  failedAs(second, code);
});

Then('{string} sees {int} NZB jobs and {}', async (world: CoreWorld, windowId: string, count: number, more: string) => {
  const answer = await answered(nzb(world), windowId);
  const jobs = lastJobs(answer);
  expect(jobs).toHaveLength(count);
  expect(answer.result?.next).toBe(more === 'more to come' ? jobs.at(-1)?.jobId : null);
});

Then('the NZB job {string} is among them, {string}', async (world: CoreWorld, key: string, phase: string) => {
  const state = nzb(world);
  expect(lastJobs(await answered(state, 'reader')).find((job) => job.jobId === jobId(state, 'reader', key))?.state).toBe(phase);
});

Then('the {int} NZB jobs {string} saw are each different and in ascending byte order', (world: CoreWorld, count: number, _windowId: string) => {
  const { seen } = nzb(world);
  expect(new Set(seen).size).toBe(count);
  expect(seen).toEqual([...seen].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))));
});

Then('{string} is told the {string} of the NZB job {string} worked and it is {string}, replayable until {int}', async (world: CoreWorld, windowId: string, action: string, key: string, phase: string, replayUntil: number) => {
  const state = nzb(world);
  const { result } = await answered(state, windowId);
  expect(result).toMatchObject({ jobId: jobId(state, windowId, key), action, replayUntil, job: { jobId: jobId(state, windowId, key), state: phase } });
});

Then('{string} is told the {string} of the NZB job {string} worked with no job in the answer, replayable until {int}', async (world: CoreWorld, windowId: string, action: string, key: string, replayUntil: number) => {
  const state = nzb(world);
  expect((await answered(state, windowId)).result).toEqual({ jobId: jobId(state, windowId, key), action, replayUntil });
});

Then('{string} is told a new NZB job took over from {string} and is {string}', async (world: CoreWorld, windowId: string, key: string, phase: string) => {
  const state = nzb(world);
  const { result } = await answered(state, windowId);
  expect(result).toMatchObject({ jobId: jobId(state, windowId, key), action: 'retry', job: { state: phase } });
  expect(jobOf({ type: '', result } as Wire).jobId).not.toBe(jobId(state, windowId, key));
});

Then('the shell keeps NZB records of {int} job', (world: CoreWorld, count: number) => {
  expect((JSON.parse(nzb(world).storage.getItem(HANDLES_KEY) as string) as { jobs: unknown[] }).jobs).toHaveLength(count);
});

Then('the NZB document {string} reads as {int} files called {string}', (_world: CoreWorld, document: string, files: number, name: string) => {
  expect(readNzbDocument(nzbDocument(document))).toEqual({ files, name });
});

Then('reading the NZB document {string} fails with {string}', (_world: CoreWorld, document: string, reason: string) => {
  expect(() => readNzbDocument(nzbDocument(document))).toThrow(new RegExp(`^${reason} \\S`));
});

Then('the shell fetched {int} NZB documents', (world: CoreWorld, count: number) => {
  expect(nzb(world).fetches).toBe(count);
});

Then('the NZB fetch was stopped', async (world: CoreWorld) => {
  const state = nzb(world);
  await until(() => state.fetchStopped, 'the fetch to stop');
});
