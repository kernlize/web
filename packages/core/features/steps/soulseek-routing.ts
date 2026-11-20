import { expect } from 'vitest';
import { Then, When } from 'quickpickle';
import type { SoulseekFile } from '@napplet/core';
import type { FakeSlskd } from '../../../bridges/features/steps/fake-slskd.ts';
import { lastAnswer, request, routing, serverOf, type RoutingState, type Wire } from './routing-world.js';
import type { CoreWorld } from './world.js';

/** Past the daemon's poll interval, so every look at a search or download asks the daemon. */
const LATER_MS = 5_000;

const slskd = (state: RoutingState, label: string): FakeSlskd => serverOf<FakeSlskd & { signIn: never }>(state, label);

const searched = (fake: FakeSlskd): number => fake.requests.filter((entry) => entry.method === 'POST' && entry.path.endsWith('/searches')).length;
const fetched = (fake: FakeSlskd): number => fake.requests.filter((entry) => entry.method === 'POST' && entry.path.includes('/transfers/downloads/')).length;

function named(state: RoutingState, key: string): string {
  const value = state.handles.get(key);
  if (!value) throw new Error(`nothing called ${key}`);
  return value;
}

async function seek(state: RoutingState, window: string, message: Wire): Promise<Wire> {
  state.clock += LATER_MS;
  return request(state, 'soulseek', window, message);
}

When('the routed window {string} searches the sharing programs for {string}', async (world: CoreWorld, window: string, text: string) => {
  const state = routing(world);
  state.windows.set(window, 'crate');
  const { value } = (await seek(state, window, { type: 'soulseek.search', request: { text } })) as { value: { queryId: string } };
  state.handles.set(`${window}/query/${text}`, value.queryId);
});

When('{string} finishes the search for {string} with two files from {string}', (world: CoreWorld, label: string, text: string, username: string) => {
  const fake = slskd(routing(world), label);
  const [id] = [...fake.searches].find(([, search]) => search['searchText'] === text) as [string, unknown];
  const file = (name: string) => ({ code: 1, filename: `@@music\\${name}.flac`, size: 1000, extension: 'flac', isLocked: false });
  fake.finishSearch(id, [{ username, fileCount: 2, lockedFileCount: 0, hasFreeUploadSlot: true, queueLength: 0, token: 7, uploadSpeed: 1, files: [file(`${text}-1`), file(`${text}-2`)] }]);
});

When('the routed window {string} reads the results of {string}', async (world: CoreWorld, window: string, text: string) => {
  const state = routing(world);
  const answer = await seek(state, window, { type: 'soulseek.results', queryId: named(state, `${window}/query/${text}`) });
  const files = ((answer.value as { files?: SoulseekFile[] } | undefined)?.files ?? []);
  files.forEach((file, index) => state.handles.set(`${window}/file/${index + 1}`, file.fileId));
});

When('the routed window {string} downloads file {int} it found', async (world: CoreWorld, window: string, index: number) => {
  const state = routing(world);
  const answer = await seek(state, window, { type: 'soulseek.download', fileId: named(state, `${window}/file/${index}`) });
  const transfer = (answer.value as { transferId?: string } | undefined)?.transferId;
  if (transfer) state.handles.set(`${window}/transfer/${index}`, transfer);
});

When('the routed window {string} asks for the status of its download', async (world: CoreWorld, window: string) => {
  const state = routing(world);
  await seek(state, window, { type: 'soulseek.status', transferId: named(state, `${window}/transfer/1`) });
});

When(/^the routed window "([^"]*)" (pauses|resumes) download (\d+)$/, async (world: CoreWorld, window: string, action: string, index: string) => {
  const state = routing(world);
  await seek(state, window, { type: `soulseek.${action === 'pauses' ? 'pause' : 'resume'}`, transferId: named(state, `${window}/transfer/${index}`) });
});

When('the routed window {string} closes', async (world: CoreWorld, window: string) => {
  const state = routing(world);
  state.downloads?.services.soulseek?.onWindowDestroyed?.(window);
  await new Promise((resolve) => setTimeout(resolve, 20));
});

Then('{string} ran a search and {string} did not', (world: CoreWorld, label: string, other: string) => {
  const state = routing(world);
  expect(searched(slskd(state, label))).toBe(1);
  expect(searched(slskd(state, other))).toBe(0);
});

Then('{string} was asked for a file and {string} was not', (world: CoreWorld, label: string, other: string) => {
  const state = routing(world);
  expect(fetched(slskd(state, label))).toBe(1);
  expect(fetched(slskd(state, other))).toBe(0);
});

Then('the routed window {string} is told the sharing program is {string}', async (world: CoreWorld, window: string, expected: string) => {
  const answer = await request(routing(world), 'soulseek', window, { type: 'soulseek.info' });
  expect((answer.value as { state: string }).state).toBe(expected);
});

Then("the routed window's answer fails with {string} because {string}", (world: CoreWorld, code: string, message: string) => {
  const answer = lastAnswer(routing(world)) as { error?: unknown; value?: { error?: unknown; query?: { error?: unknown } } };
  expect(answer.error ?? answer.value?.error ?? answer.value?.query?.error).toEqual({ code, message });
});

Then('{string} was asked nothing after it was removed', (world: CoreWorld, label: string) => {
  const state = routing(world);
  expect(slskd(state, label).requests).toHaveLength(state.removedAt.get(label) as number);
});
