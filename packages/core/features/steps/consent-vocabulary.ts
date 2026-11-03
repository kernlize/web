import { expect } from 'vitest';
import { Then, When } from 'quickpickle';
import type { NostrEvent } from '@napplet/core';
import { describeChange, type ConsentSummary } from '@kernl/core';
import { scratch, signEvent, splitList, type CoreWorld } from './world.js';

const PROTOCOL_VOCABULARY = /\b(nostr|nip-?\d+|napplets?|relays?|pubkeys?|npub\w*|nsec\w*|naddr\w*|nevent\w*|wss?:\/\/|kind)\b/i;
const IDENTITY = { dTag: 'chat', hash: 'ab'.repeat(32) };

function hex(seed: string): string {
  return seed.repeat(64).slice(0, 64);
}

/** A realistic current and next version of each kind, as applets publish them. */
const FIXTURES: Readonly<Record<number, { tags: string[][]; content?: string; before?: string[][] }>> = {
  0: { tags: [], content: '{"name":"bob","nip05":"bob@example.com"}' },
  3: { tags: [['p', hex('b1'), 'wss://relay.damus.io'], ['p', hex('b2')]], before: [['p', hex('a1')]] },
  5: { tags: [['e', hex('e1')], ['a', `30023:${hex('a1')}:post`], ['k', '1']] },
  62: { tags: [['relay', 'wss://relay.damus.io'], ['relay', 'wss://nos.lol/']] },
  10002: { tags: [['r', 'wss://relay.damus.io', 'read'], ['r', 'wss://nos.lol']], before: [['r', 'wss://relay.primal.net']] },
  17375: { tags: [['mint', 'https://mint.example'], ['pubkey', hex('c1')]], content: 'sealed', before: [['mint', 'https://old-mint.example']] },
  30311: {
    tags: [['d', 'stream'], ['title', 'Live show'], ['relays', 'wss://relay.damus.io', 'wss://nos.lol'], ['p', hex('d1'), 'wss://nos.lol', 'host'], ['streaming', 'https://cdn.example/live.m3u8'], ['a', `30311:${hex('d2')}:other`], ['k', '1'], ['kind', '7']],
    content: 'new',
    before: [['d', 'stream'], ['r', 'wss://relay.snort.social'], ['e', hex('e9')]],
  },
};

async function summarise(kind: number): Promise<ConsentSummary> {
  const fixture = FIXTURES[kind];
  if (!fixture) throw new Error(`no fixture for kind ${kind}`);
  const event = await signEvent({ kind, tags: fixture.tags, content: fixture.content ?? '' });
  const before: NostrEvent | undefined = fixture.before ? await signEvent({ kind, tags: fixture.before, content: 'old' }) : undefined;
  return describeChange(event, before, IDENTITY);
}

function texts(summary: ConsentSummary): string[] {
  return [summary.title, ...summary.lines.flatMap((line) => [line.label, line.before ?? '', line.after ?? ''])];
}

When('the shell describes signing a kind 5 event deleting {string} of kinds {string}', async (world: CoreWorld, seeds: string, kinds: string) => {
  const tags = [...splitList(seeds).map((seed) => ['e', hex(seed)]), ...splitList(kinds).map((kind) => ['k', kind])];
  scratch(world).summary = describeChange(await signEvent({ kind: 5, tags }), undefined, scratch(world).applet as typeof IDENTITY);
});

Then('no consent summary for kinds {string} names a protocol, a key format, a server address or a kind', async (world: CoreWorld, kinds: string) => {
  const summaries: ConsentSummary[] = [];
  for (const kind of splitList(kinds).map(Number)) summaries.push(await summarise(kind));
  for (const summary of summaries) {
    for (const value of texts(summary)) expect(value, `kind ${summary.event.kind}: ${summary.title}`).not.toMatch(PROTOCOL_VOCABULARY);
  }
  scratch(world).vocabulary = summaries;
});

Then('every one of those summaries carries the raw event for the record view', (world: CoreWorld) => {
  const summaries = scratch(world).vocabulary as ConsentSummary[];
  expect(summaries.map((summary) => summary.event.kind)).toEqual([0, 3, 5, 62, 10002, 17375, 30311]);
  for (const summary of summaries) expect(summary.event.sig).toMatch(/^[0-9a-f]{128}$/);
});
