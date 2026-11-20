import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { createTorrentService, type DownloadProgram, type RoutedDomain } from '@kernlize/core';
import { startFakeNzbget } from '../../../bridges/features/steps/fake-nzbget.ts';
import { startFakeSlskd } from '../../../bridges/features/steps/fake-slskd.ts';
import { startFakeTransmission } from '../../../bridges/features/steps/fake-transmission.ts';
import { idOf, openShell, openStore, programs, register, routing, type RoutedServer, type RoutingState } from './routing-world.js';
import type { CoreWorld } from './world.js';

/** Short enough that a scenario sees several refreshes without waiting on them. */
export const ROUTED_POLL_MS = 20;

/** The torrent service over the store's routing, as a shell starts it; every question is answered yes. */
export function startTorrents(state: RoutingState): void {
  state.torrent = createTorrentService({
    appletOf: (windowId) => (state.windows.has(windowId) ? { dTag: state.windows.get(windowId) as string, hash: 'cd'.repeat(32) } : undefined),
    ask: async (_windowId, question) => {
      state.questions.push(question);
      return true;
    },
    storage: state.storage,
    connections: programs(state).routing('torrent'),
    pollMs: ROUTED_POLL_MS,
  });
  register(state.torrent.handler);
}

const STARTERS: Readonly<Record<string, { readonly program: DownloadProgram; readonly start: (label: string) => Promise<RoutedServer> }>> = {
  Transmission: {
    program: 'transmission',
    async start(label) {
      const fake = await startFakeTransmission();
      fake.credentials = { username: 'ann', password: `s3cret-${label}` };
      return Object.assign(fake, { signIn: fake.credentials });
    },
  },
  NZBGet: {
    program: 'nzbget',
    async start() {
      const fake = await startFakeNzbget();
      return Object.assign(fake, { signIn: fake.login ?? {} });
    },
  },
  slskd: {
    program: 'slskd',
    async start() {
      const fake = await startFakeSlskd();
      fake.online = true;
      fake.peers.set('ann', []);
      return Object.assign(fake, { signIn: fake.lock?.apiKey ? { apiKey: fake.lock.apiKey } : {} });
    },
  },
};

Given('the person set up two {word} programs, {string} then {string}', async (world: CoreWorld, kind: string, first: string, second: string) => {
  const state = routing(world);
  const starter = STARTERS[kind];
  if (!starter) throw new Error(`no program called ${kind}`);
  if (starter.program === 'transmission') {
    await openStore(state);
    startTorrents(state);
  } else {
    await openShell(state).programs.ready;
  }
  for (const label of [first, second]) {
    const server = await starter.start(label);
    state.servers.set(label, server);
    const connection = await programs(state).add(starter.program, { url: server.url, ...server.signIn }, label);
    state.ids.set(label, connection.id);
  }
});

When('the person makes {string} the default {word} connection', (world: CoreWorld, label: string, domain: RoutedDomain) => {
  const state = routing(world);
  programs(state).chooseDefault(domain, idOf(state, label));
});

When('the person removes the routed connection {string}', async (world: CoreWorld, label: string) => {
  const state = routing(world);
  const server = state.servers.get(label) as RoutedServer & { requests?: unknown[] };
  state.removedAt.set(label, server.requests?.length ?? 0);
  await programs(state).remove(idOf(state, label));
});

Then('the routed settings name {string} as locked', (world: CoreWorld, label: string) => {
  const state = routing(world);
  expect(programs(state).state().locked).toEqual([idOf(state, label)]);
});
