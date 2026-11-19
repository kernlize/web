import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { NEVER, Observable, from, throwError } from 'rxjs';
import { EventStore } from 'applesauce-core';
import { naddrEncode, noteEncode, nprofileEncode, npubEncode, nsecEncode } from 'applesauce-core/helpers';
import { PrivateKeySigner } from 'applesauce-signers';
import type { DmAdapter } from '@kehto/services';
import type { NostrEvent } from '@napplet/core';
import { createPeople, locateRecipients, parsePerson, type People, type PersonPointer } from '@kernlize/core';
import { scratch, type CoreWorld } from './world.js';

interface PeopleScratch {
  signer: PrivateKeySigner;
  pubkey: string;
  held: NostrEvent[];
  found?: PersonPointer | undefined;
  store: EventStore;
  finder?: People;
  asked: { relays: string[]; filters: unknown }[];
  answer?: string;
  refusal?: string;
  sent: { recipients: readonly string[]; content: string }[];
  adapter?: DmAdapter;
}

function s(world: CoreWorld): PeopleScratch {
  const all = scratch(world) as { people?: PeopleScratch };
  all.people ??= { signer: new PrivateKeySigner(), pubkey: '', held: [], store: new EventStore(), asked: [], sent: [] };
  return all.people;
}

const nprofile = (state: PeopleScratch, relays: string[]): string => nprofileEncode({ pubkey: state.pubkey, relays });

Given('a person {string}', async (world: CoreWorld, _name: string) => {
  s(world).pubkey = await s(world).signer.getPublicKey();
});

Given('a person {string} whose profile, server list and inboxes are on {string}', async (world: CoreWorld, _name: string, _relay: string) => {
  const state = s(world);
  state.pubkey = await state.signer.getPublicKey();
  for (const kind of [0, 10002, 10050]) {
    state.held.push((await state.signer.signEvent({ kind, created_at: 1_700_000_000, tags: kind === 0 ? [] : [[kind === 10002 ? 'r' : 'relay', 'wss://inbox.example/']], content: kind === 0 ? '{"name":"Ada"}' : '' })) as NostrEvent);
  }
});

const FORMS: Record<string, (state: PeopleScratch) => string> = {
  hex: (state) => state.pubkey,
  'upper-case hex with spaces': (state) => `  ${state.pubkey.toUpperCase()}\n`,
  'an npub': (state) => npubEncode(state.pubkey),
  'an npub behind a scheme': (state) => `nostr:${npubEncode(state.pubkey)}`,
  'an upper-case npub': (state) => npubEncode(state.pubkey).toUpperCase(),
  'an nprofile with two servers': (state) => nprofile(state, ['wss://one.example/', 'wss://two.example/']),
  'an nprofile with no servers': (state) => nprofile(state, []),
};

When(/^the shell reads ada's identity written as (hex|upper-case hex with spaces|an npub|an npub behind a scheme|an upper-case npub|an nprofile with two servers|an nprofile with no servers)$/, (world: CoreWorld, form: string) => {
  s(world).found = parsePerson((FORMS[form] as (state: PeopleScratch) => string)(s(world)));
});

When("the shell reads ada's identity written as an nprofile naming {string}", (world: CoreWorld, relay: string) => {
  s(world).found = parsePerson(nprofile(s(world), [relay]));
});

When(/^the shell reads the identity "(.*)"$/, (world: CoreWorld, text: string) => {
  s(world).found = parsePerson(text);
});

Then('the shell found ada with {int} hinted servers', (world: CoreWorld, hints: number) => {
  expect(s(world).found?.pubkey).toBe(s(world).pubkey);
  expect(s(world).found?.relays).toHaveLength(hints);
});

Then('the shell found nobody', (world: CoreWorld) => {
  expect(s(world).found).toBeUndefined();
});

Then("ada's secret key, a note of hers and an applet of hers are each read as nobody", (world: CoreWorld) => {
  const state = s(world);
  expect(parsePerson(nsecEncode(state.signer.key))).toBeUndefined();
  expect(parsePerson(noteEncode('ab'.repeat(32)))).toBeUndefined();
  expect(parsePerson(naddrEncode({ kind: 35129, pubkey: state.pubkey, identifier: 'feed' }))).toBeUndefined();
});

function finder(world: CoreWorld, behaviour: 'holds' | 'fails' | 'silent', timeoutMs?: number): void {
  const state = s(world);
  const request = (relays: string[], filters: unknown): Observable<NostrEvent> => {
    state.asked.push({ relays, filters });
    if (behaviour === 'fails') return throwError(() => new Error('relay down'));
    return behaviour === 'silent' ? NEVER : from(state.held);
  };
  state.finder = createPeople({ store: state.store, pool: { request } as never, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
}

Given('a people finder', (world: CoreWorld) => finder(world, 'holds'));
Given('a people finder whose servers fail', (world: CoreWorld) => finder(world, 'fails'));
Given('a people finder whose servers never answer, bounded at {int} ms', (world: CoreWorld, ms: number) => finder(world, 'silent', ms));

async function locate(world: CoreWorld, input: string): Promise<void> {
  const state = s(world);
  try {
    state.answer = await (state.finder as People).locate(input);
  } catch (error) {
    state.refusal = (error as Error).message;
  }
}

When('the finder locates ada by an nprofile naming {string}', (world: CoreWorld, relay: string) => locate(world, nprofile(s(world), [relay])));
When('the finder locates ada by her npub', (world: CoreWorld) => locate(world, npubEncode(s(world).pubkey)));
When('the finder locates {string}', (world: CoreWorld, text: string) => locate(world, text));

Then("the finder answered with ada's key", (world: CoreWorld) => {
  expect(s(world).answer).toBe(s(world).pubkey);
  expect((s(world).finder as People).parse(s(world).pubkey)?.pubkey).toBe(s(world).pubkey);
});

Then('the finder refused with {string}', (world: CoreWorld, reason: string) => {
  expect(s(world).refusal).toBe(reason);
});

Then('{string} was asked for kinds 0, 10002 and 10050 by ada', (world: CoreWorld, relay: string) => {
  expect(s(world).asked).toEqual([{ relays: [relay], filters: [{ kinds: [0, 10002, 10050], authors: [s(world).pubkey] }] }]);
});

Then("the event store holds ada's profile, server list and inboxes", (world: CoreWorld) => {
  for (const kind of [0, 10002, 10050]) expect(s(world).store.getReplaceable(kind, s(world).pubkey)).toBeDefined();
});

Then(/^the hinted servers were asked (\d+) times?$/, (world: CoreWorld, times: string) => {
  expect(s(world).asked).toHaveLength(Number(times));
});

Given('a messaging adapter that reads its recipients through the finder', (world: CoreWorld) => {
  const state = s(world);
  const send = async (request: { recipients: readonly string[]; content: string }): Promise<never> => {
    state.sent.push({ recipients: request.recipients, content: request.content });
    return { id: 'sent' } as never;
  };
  state.adapter = locateRecipients({ send } as never, state.finder as People);
});

When('an applet sends {string} to ada by her npub and by an nprofile naming {string}', async (world: CoreWorld, content: string, relay: string) => {
  const state = s(world);
  await (state.adapter as DmAdapter).send({ recipients: [npubEncode(state.pubkey)], content });
  await (state.adapter as DmAdapter).send({ recipients: [nprofile(state, [relay])], content });
});

When('an applet sends {string} to {string}', async (world: CoreWorld, content: string, recipient: string) => {
  try {
    await (s(world).adapter as DmAdapter).send({ recipients: [recipient], content });
  } catch (error) {
    s(world).refusal = (error as Error).message;
  }
});

Then("the adapter underneath was sent {string} for ada's key twice", (world: CoreWorld, content: string) => {
  expect(s(world).sent).toEqual([{ recipients: [s(world).pubkey], content }, { recipients: [s(world).pubkey], content }]);
});

Then('the send was refused with {string}', (world: CoreWorld, reason: string) => {
  expect(s(world).refusal).toBe(reason);
});
