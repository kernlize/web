import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import { Then, When } from 'quickpickle';
import type { FakeTransmission } from '../../../bridges/features/steps/fake-transmission.ts';
import { ROUTED_POLL_MS, startTorrents } from './download-routing.js';
import { idOf, lastAnswer, openStore, programs, request, routing, serverOf, type RoutingState, type Wire } from './routing-world.js';
import type { CoreWorld } from './world.js';

const hashOf = (name: string): string => createHash('sha1').update(`routed:${name}`).digest('hex');

const transmission = (state: RoutingState, label: string): FakeTransmission => serverOf<FakeTransmission & { signIn: never }>(state, label);

async function addTorrent(world: CoreWorld, applet: string, window: string, name: string, options: Wire): Promise<void> {
  const state = routing(world);
  state.windows.set(window, applet);
  const answer = await request(state, 'torrent', window, { type: 'torrent.add', request: { source: { sourceType: 'magnet', magnet: `magnet:?xt=urn:btih:${hashOf(name)}&dn=${name}` }, options } });
  const { ack } = answer as { ack: { ok: boolean; jobId: string } };
  expect(ack.ok).toBe(true);
  state.handles.set(`${window}/${name}`, ack.jobId);
}

function jobOf(state: RoutingState, window: string, name: string): string {
  const jobId = state.handles.get(`${window}/${name}`);
  if (!jobId) throw new Error(`the routed window ${window} has no torrent called ${name}`);
  return jobId;
}

When('the applet {string} in the routed window {string} adds the torrent {string}', (world: CoreWorld, applet: string, window: string, name: string) => addTorrent(world, applet, window, name, {}));

When('the applet {string} in the routed window {string} keeps the torrent {string}', (world: CoreWorld, applet: string, window: string, name: string) =>
  addTorrent(world, applet, window, name, { retention: 'persistent' }));

When('the routed window {string} pauses the torrent {string}', async (world: CoreWorld, window: string, name: string) => {
  const state = routing(world);
  await request(state, 'torrent', window, { type: 'torrent.pause', jobId: jobOf(state, window, name) });
});

When('the routed window {string} asks for the status of the torrent {string}', async (world: CoreWorld, window: string, name: string) => {
  const state = routing(world);
  await request(state, 'torrent', window, { type: 'torrent.status', jobId: jobOf(state, window, name) });
});

When('the routed window {string} removes the torrent {string} and its files', async (world: CoreWorld, window: string, name: string) => {
  const state = routing(world);
  await request(state, 'torrent', window, { type: 'torrent.remove', jobId: jobOf(state, window, name), options: { deleteData: true } });
});

When('a few routed torrent refreshes pass', async () => {
  await new Promise((resolve) => setTimeout(resolve, ROUTED_POLL_MS * 8));
});

When('the shell is reloaded while the secrets provider withholds the sign-in of {string}', async (world: CoreWorld, label: string) => {
  const state = routing(world);
  state.torrent?.dispose();
  state.windows.clear();
  state.withheld.add(idOf(state, label));
  await openStore(state);
  startTorrents(state);
});

When('the person signs in to {string} again', async (world: CoreWorld, label: string) => {
  const state = routing(world);
  state.withheld.clear();
  const server = transmission(state, label);
  await programs(state).update(idOf(state, label), { signIn: { url: server.url, ...server.credentials } });
});

Then('the routed torrent question names the program {string}', (world: CoreWorld, label: string) => {
  const asked = routing(world).questions.at(-1);
  expect(asked?.lines.find((line) => line.label === 'Program')?.value).toBe(label);
});

Then('{string} holds the torrent {string} and {string} does not', (world: CoreWorld, holder: string, name: string, other: string) => {
  const state = routing(world);
  expect(transmission(state, holder).torrents.has(hashOf(name))).toBe(true);
  expect(transmission(state, other).torrents.has(hashOf(name))).toBe(false);
});

Then('{string} holds its own copy of the torrent {string}, as {string} does', (world: CoreWorld, label: string, name: string, other: string) => {
  const state = routing(world);
  expect(transmission(state, label).torrents.has(hashOf(name))).toBe(true);
  expect(transmission(state, other).torrents.has(hashOf(name))).toBe(true);
});

Then('{string} was asked to pause a torrent and {string} was not', (world: CoreWorld, asked: string, other: string) => {
  const state = routing(world);
  expect(transmission(state, asked).calls.map((call) => call.method)).toContain('torrent-stop');
  expect(transmission(state, other).calls.map((call) => call.method)).not.toContain('torrent-stop');
});

Then('the routed window is told the torrent is {string}', (world: CoreWorld, error: string) => {
  expect(lastAnswer(routing(world)).error).toBe(error);
});

Then(/^the routed window is told the torrent was removed and its files (kept|deleted)$/, (world: CoreWorld, files: string) => {
  expect(lastAnswer(routing(world)).result).toMatchObject({ ok: true, deletedData: files === 'deleted' });
});

Then('{string} was never asked to remove a torrent', (world: CoreWorld, label: string) => {
  expect(transmission(routing(world), label).removed).toEqual([]);
});

Then('{string} was told to delete the files of {string} and {string} was not', (world: CoreWorld, label: string, name: string, other: string) => {
  const state = routing(world);
  expect(transmission(state, label).removed).toEqual([{ infoHash: hashOf(name), deleteData: true }]);
  expect(transmission(state, other).removed).toEqual([]);
  expect(transmission(state, other).torrents.has(hashOf(name))).toBe(true);
});

Then('{string} and {string} were each listed once a refresh, though {string} holds two jobs', (world: CoreWorld, first: string, second: string) => {
  const state = routing(world);
  const lists = (label: string): number => transmission(state, label).calls.filter((call) => call.method === 'torrent-get' && !('ids' in (call.arguments as object))).length;
  expect(lists(first)).toBeGreaterThan(2);
  expect(Math.abs(lists(first) - lists(second))).toBeLessThanOrEqual(1);
});
