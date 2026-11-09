import { expect } from 'vitest';
import { DataTable, Given, Then, When } from 'quickpickle';
import { BehaviorSubject, Observable, type Subscriber } from 'rxjs';
import { EventStore } from 'applesauce-core';
import { matchFilters, normalizeRelayUrl, type Filter, type NostrEvent } from 'applesauce-core/helpers';
import type { PublishResponse } from 'applesauce-relay';
import { PrivateKeySigner } from 'applesauce-signers';
import {
  createAccountMailboxes,
  createRelayDirectory,
  mailboxesFromEvent,
  type AccountMailboxes,
  type MailboxPool,
  type MailboxState,
  type RelayDirectory,
} from '@kernlize/core';
import { attempt, last, scratch, splitList, type CoreWorld, type ReqMessage } from './world.js';
import { outcome } from './publish-outcome.js';
import { createMonitorPool, holdServers, type MonitorPool } from './relay-directory.js';

interface LiveLookup {
  readonly relays: readonly string[];
  readonly filters: readonly Filter[];
  readonly observer: Subscriber<ReqMessage>;
}

/** Fake servers for account lists: each answers with what it holds, unless it is slow, and records what is published. */
interface MailboxNetwork extends MailboxPool {
  readonly held: Map<string, NostrEvent[]>;
  readonly slow: Set<string>;
  readonly refusing: Map<string, string>;
  readonly live: Set<LiveLookup>;
  readonly lookups: Filter[][];
  readonly published: { relays: string[]; event: NostrEvent }[];
  refuseAll?: string;
  down: boolean;
}

function createMailboxNetwork(): MailboxNetwork {
  const network: MailboxNetwork = {
    held: new Map(),
    slow: new Set(),
    refusing: new Map(),
    live: new Set(),
    lookups: [],
    published: [],
    down: false,
    req(relays, filters) {
      const urls = (relays as string[]).map(normalizeRelayUrl);
      const list = (Array.isArray(filters) ? filters : [filters]) as Filter[];
      network.lookups.push(list);
      return new Observable<ReqMessage>((observer) => {
        for (const url of urls) {
          if (network.slow.has(url)) continue;
          for (const event of network.held.get(url) ?? []) if (matchFilters(list, event)) observer.next({ type: 'EVENT', from: url, id: 'sub', event });
          observer.next({ type: 'EOSE', from: url, id: 'sub' });
        }
        const entry: LiveLookup = { relays: urls, filters: list, observer };
        network.live.add(entry);
        return () => network.live.delete(entry);
      });
    },
    async publish(relays, event) {
      if (network.down) throw new Error('network down');
      const urls = relays as string[];
      network.published.push({ relays: urls, event: event as NostrEvent });
      return urls.map((from): PublishResponse => {
        const reason = network.refuseAll ?? network.refusing.get(from);
        return reason ? { ok: false, from, message: reason } : { ok: true, from };
      });
    },
  };
  return network;
}

interface MailboxWorld {
  network: MailboxNetwork;
  store: EventStore;
  account: PrivateKeySigner;
  pubkey: string;
  pubkey$: BehaviorSubject<string | undefined>;
  lookup: string[];
  directory?: RelayDirectory;
  monitorPool?: MonitorPool;
  mailboxes?: AccountMailboxes;
  states: MailboxState[];
}

const account = new PrivateKeySigner();
const accountPubkey = await account.getPublicKey();

function world$(world: CoreWorld): MailboxWorld {
  return (scratch(world).mailboxWorld ??= {
    network: createMailboxNetwork(),
    store: new EventStore(),
    account,
    pubkey: accountPubkey,
    pubkey$: new BehaviorSubject<string | undefined>(accountPubkey),
    lookup: [],
    states: [],
  }) as MailboxWorld;
}

function mailboxes(world: CoreWorld): AccountMailboxes {
  const value = world$(world).mailboxes;
  if (!value) throw new Error('watch the mailboxes first');
  return value;
}

function current(world: CoreWorld): MailboxState {
  return mailboxes(world).state();
}

function found(world: CoreWorld): Extract<MailboxState, { status: 'found' }> {
  const state = current(world);
  if (state.status !== 'found') throw new Error(`expected a list, the state is ${state.status}`);
  return state;
}

function missing(world: CoreWorld): Extract<MailboxState, { status: 'missing' }> {
  const state = current(world);
  if (state.status !== 'missing') throw new Error(`expected no list, the state is ${state.status}`);
  return state;
}

function tagsOf(table: DataTable): string[][] {
  return table.hashes().map((row) => [row.tag as string, row.url as string, ...(row.marker ? [row.marker] : [])]);
}

async function signList(createdAt: number, tags: string[][], content = ''): Promise<NostrEvent> {
  return account.signEvent({ kind: 10002, created_at: createdAt, tags, content });
}

function watch(world: CoreWorld, options: { readOnly?: boolean; patienceMs?: number } = {}): void {
  const state = world$(world);
  state.mailboxes = createAccountMailboxes({
    store: state.store,
    pool: state.network,
    pubkey$: state.pubkey$,
    lookupRelays: () => state.lookup,
    signer: () => (options.readOnly ? undefined : state.account),
    ...(state.directory ? { directory: state.directory } : {}),
    ...(options.patienceMs === undefined ? {} : { patienceMs: options.patienceMs }),
  });
  state.mailboxes.state$.subscribe((next) => state.states.push(next));
}

function hold(world: CoreWorld, url: string, event: NostrEvent): void {
  const { held } = world$(world).network;
  const key = normalizeRelayUrl(url);
  held.set(key, [...(held.get(key) ?? []), event]);
}

Given('the lookup servers {string}', (world: CoreWorld, list: string) => {
  world$(world).lookup = splitList(list);
});

Given('{string} holds a mailbox list from {int} with', async (world: CoreWorld, url: string, createdAt: number, table: DataTable) => {
  hold(world, url, await signList(createdAt, tagsOf(table)));
});

Given('{string} holds a mailbox list from {int} with content {string} and', async (world: CoreWorld, url: string, createdAt: number, content: string, table: DataTable) => {
  hold(world, url, await signList(createdAt, tagsOf(table), content));
});

Given('{string} is slow to answer', (world: CoreWorld, url: string) => {
  world$(world).network.slow.add(normalizeRelayUrl(url));
});

Given('{string} refuses publishes with {string}', (world: CoreWorld, url: string, reason: string) => {
  world$(world).network.refusing.set(normalizeRelayUrl(url), reason);
});

Given('every server refuses publishes with {string}', (world: CoreWorld, reason: string) => {
  world$(world).network.refuseAll = reason;
});

Given('the network is down for publishes', (world: CoreWorld) => {
  world$(world).network.down = true;
});

Given('a relay directory that knows {string}', async (world: CoreWorld, list: string) => {
  const pool = createMonitorPool();
  const now = Math.floor(Date.now() / 1000);
  const directory = createRelayDirectory({ pool, throttleMs: 0 });
  directory.start();
  await holdServers(pool, splitList(list).map((server, index) => ({ server, monitors: '1', 'rtt-open': String(100 + index) })), now);
  world$(world).directory = directory;
  world$(world).monitorPool = pool;
});

When('the directory hears of {string} from {int} monitors', async (world: CoreWorld, server: string, count: number) => {
  const pool = world$(world).monitorPool;
  if (pool) await holdServers(pool, [{ server, monitors: String(count) }], Math.floor(Date.now() / 1000));
});

When("the signed-in account's mailboxes are watched", (world: CoreWorld) => {
  watch(world);
});

When("the signed-in account's mailboxes are watched with a patience of {int} ms", (world: CoreWorld, patienceMs: number) => {
  watch(world, { patienceMs });
});

When('the mailboxes of a read-only account are watched', (world: CoreWorld) => {
  watch(world, { readOnly: true });
});

When('the mailboxes are watched with nobody signed in', (world: CoreWorld) => {
  world$(world).pubkey$.next(undefined);
  watch(world);
});

When('someone signs in to the mailboxes', (world: CoreWorld) => {
  const state = world$(world);
  state.pubkey$.next(state.pubkey);
});

When('they sign out of the mailboxes', (world: CoreWorld) => {
  world$(world).pubkey$.next(undefined);
});

Then('the lookup is no longer open', (world: CoreWorld) => {
  expect(world$(world).network.live.size).toBe(0);
});

When('{string} finishes', (world: CoreWorld, url: string) => {
  const key = normalizeRelayUrl(url);
  for (const lookup of world$(world).network.live) if (lookup.relays.includes(key)) lookup.observer.next({ type: 'CLOSED', from: key, id: 'sub', reason: 'done' });
});

When('{string} sends a mailbox list from {int} with', async (world: CoreWorld, url: string, createdAt: number, table: DataTable) => {
  const event = await signList(createdAt, tagsOf(table));
  const key = normalizeRelayUrl(url);
  for (const lookup of world$(world).network.live) if (lookup.relays.includes(key)) lookup.observer.next({ type: 'EVENT', from: key, id: 'sub', event });
});

When('{int} ms pass', async (_world: CoreWorld, ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
});

When('the account saves inboxes {string} and outboxes {string}', async (world: CoreWorld, inboxes: string, outboxes: string) => {
  await attempt(world, async () => {
    scratch(world).outcome = await mailboxes(world).save({ inboxes: splitList(inboxes), outboxes: splitList(outboxes) });
  });
});

Then('the mailbox state is {string}', (world: CoreWorld, status: string) => {
  expect(current(world).status).toBe(status);
});

Then('the inboxes are {string}', (world: CoreWorld, list: string) => {
  expect(found(world).mailboxes.inboxes).toEqual(splitList(list));
});

Then('the outboxes are {string}', (world: CoreWorld, list: string) => {
  expect(found(world).mailboxes.outboxes).toEqual(splitList(list));
});

Then('the suggested inboxes are {string}', (world: CoreWorld, list: string) => {
  expect(missing(world).suggested.inboxes).toEqual(splitList(list));
});

Then('the suggested outboxes are {string}', (world: CoreWorld, list: string) => {
  expect(missing(world).suggested.outboxes).toEqual(splitList(list));
});

Then('the lookup asked for kind 10002 by the signed-in account', (world: CoreWorld) => {
  const state = world$(world);
  expect(state.network.lookups).toEqual([[{ kinds: [10002], authors: [state.pubkey] }]]);
});

Then('the lookup asked nothing', (world: CoreWorld) => {
  expect(world$(world).network.lookups).toEqual([]);
});

Then('the state stream reported {string}', (world: CoreWorld, list: string) => {
  expect(world$(world).states.map((state) => state.status)).toEqual(splitList(list));
});

Then('the save succeeded', (world: CoreWorld) => {
  expect(scratch(world).errors).toEqual([]);
  expect(outcome(world).ok).toBe(true);
});

Then('the save failed', (world: CoreWorld) => {
  expect(scratch(world).errors).toEqual([]);
  expect(outcome(world).ok).toBe(false);
});

Then('the list was published to {string}', (world: CoreWorld, list: string) => {
  expect(last(world$(world).network.published).relays).toEqual(splitList(list));
});

Then('nothing was published', (world: CoreWorld) => {
  expect(world$(world).network.published).toEqual([]);
});

Then('the published list has the tags', (world: CoreWorld, table: DataTable) => {
  expect(last(world$(world).network.published).event.tags).toEqual(tagsOf(table));
});

Then('the published list has content {string} and was created at {int}', (world: CoreWorld, content: string, createdAt: number) => {
  const { event } = last(world$(world).network.published);
  expect(event.content).toBe(content);
  expect(event.created_at).toBe(createdAt);
});

Then('the mailboxes of no list are empty', () => {
  expect(mailboxesFromEvent(undefined)).toEqual({ inboxes: [], outboxes: [] });
});

Given('the servers answer publishes one at a time, {string} never answering, then the stream {word}', (world: CoreWorld, silent: string, ending: string) => {
  const network = world$(world).network;
  const quiet = new Set(splitList(silent).map(normalizeRelayUrl));
  network.event = (relays, event) =>
    new Observable<PublishResponse>((observer) => {
      network.published.push({ relays: relays as string[], event: event as NostrEvent });
      const answering = (relays as string[]).filter((url) => !quiet.has(url));
      let at = 0;
      const timer = setInterval(() => {
        const from = answering[at];
        at += 1;
        if (from === undefined) {
          clearInterval(timer);
          if (ending === 'fails') observer.error(new Error('timeout'));
          else observer.complete();
          return;
        }
        const reason = network.refusing.get(from);
        observer.next(reason ? { ok: false, from, message: reason } : { ok: true, from });
      }, 2);
      return () => clearInterval(timer);
    });
});

When('the account saves inboxes {string} and outboxes {string}, watching progress', async (world: CoreWorld, inboxes: string, outboxes: string) => {
  const progress: string[] = [];
  scratch(world).progress = progress;
  scratch(world).outcome = await mailboxes(world).save({ inboxes: splitList(inboxes), outboxes: splitList(outboxes) }, (sofar) => {
    progress.push(`${sofar.accepted.length}/${sofar.accepted.length + sofar.refused.length}:${current(world).status}`);
  });
});

Then('the progress went {string}', (world: CoreWorld, steps: string) => {
  expect(scratch(world).progress).toEqual(splitList(steps));
});
