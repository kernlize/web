import { expect } from 'vitest';
import { Then, When } from 'quickpickle';
import { startFakeNzbget, type FakeNzbget } from '../../../bridges/features/steps/fake-nzbget.ts';
import { nzbDocument } from './nzb-documents.js';
import { idOf, lastAnswer, programs, request, routing, serverOf, type RoutingState, type Wire } from './routing-world.js';
import type { CoreWorld } from './world.js';

type Listed = { result: { downloaders: Array<{ downloaderId: string; label: string }> } };

const nzbget = (state: RoutingState, label: string): FakeNzbget => serverOf<FakeNzbget & { signIn: never }>(state, label);

async function downloaders(state: RoutingState, window: string): Promise<Listed['result']['downloaders']> {
  return ((await request(state, 'nzb', window, { type: 'nzb.downloaders' })) as Listed).result.downloaders;
}

function handle(state: RoutingState, window: string, label: string): string {
  const jobId = state.handles.get(`${window}/${label}`);
  if (!jobId) throw new Error(`the routed window ${window} sent no archive to ${label}`);
  return jobId;
}

const statusOf = (state: RoutingState, window: string, label: string): Promise<Wire> => request(state, 'nzb', window, { type: 'nzb.status', jobId: handle(state, window, label) });

When('the applet {string} in the routed window {string} sends the archive {string} to {string}', async (world: CoreWorld, applet: string, window: string, document: string, label: string) => {
  const state = routing(world);
  state.windows.set(window, applet);
  const downloader = (await downloaders(state, window)).find((entry) => entry.label === label);
  const source = { kind: 'bytes', dataBase64: Buffer.from(nzbDocument(document)).toString('base64') };
  const answer = await request(state, 'nzb', window, { type: 'nzb.add', request: { downloaderId: downloader?.downloaderId, operationKey: `send-${label}`, source } });
  const { job } = (answer as { result: { job: { jobId: string } } }).result;
  state.handles.set(`${window}/${label}`, job.jobId);
});

When('the person points {string} at a third NZBGet program that already has a job numbered {int}', async (world: CoreWorld, label: string, number: number) => {
  const state = routing(world);
  const third = await startFakeNzbget();
  state.servers.set('third', Object.assign(third, { signIn: {} }));
  expect(third.seedQueue({ NZBName: 'someone else' })['NZBID']).toBe(number);
  await programs(state).update(idOf(state, label), { signIn: { url: third.url, ...third.login } });
});

Then('both NZBGet programs numbered their job {int}', (world: CoreWorld, number: number) => {
  const state = routing(world);
  expect([...state.servers.keys()].map((label) => nzbget(state, label).queue.map((entry) => entry['NZBID']))).toEqual([[number], [number]]);
});

Then('the routed window {string} is told about each archive job by the program it was sent to', async (world: CoreWorld, window: string) => {
  const state = routing(world);
  const names: unknown[] = [];
  for (const label of state.servers.keys()) {
    const { result } = (await statusOf(state, window, label)) as { result: { job?: { name: string }; name?: string } };
    const name = result.job?.name ?? result.name;
    expect(name).toBe(nzbget(state, label).queue[0]?.['NZBName']);
    names.push(name);
  }
  expect(new Set(names).size).toBe(2);
});

Then('the routed window {string} asking about the {string} archive job is told {string}', async (world: CoreWorld, window: string, label: string, code: string) => {
  const state = routing(world);
  await statusOf(state, window, label);
  expect((lastAnswer(state) as { error?: { code: string } }).error?.code).toBe(code);
  expect(JSON.stringify(lastAnswer(state))).not.toContain('someone else');
});

Then('the routed window {string} is offered the archive downloaders {string}', async (world: CoreWorld, window: string, labels: string) => {
  expect((await downloaders(routing(world), window)).map((entry) => entry.label).join(',')).toBe(labels);
});
