import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { EventStore } from 'applesauce-core';
import { npubEncode } from 'applesauce-core/helpers';
import { PrivateKeySigner } from 'applesauce-signers';
import type { CommonServiceOptions } from '@kehto/services';
import type { NostrEvent } from '@napplet/core';
import { commonActionsFor, createCommonActions, createRelayTiers, toProfileCard } from '@kernlize/core';
import { AccountManager } from 'applesauce-accounts';
import { PrivateKeyAccount } from 'applesauce-accounts/accounts';
import { throwError } from 'rxjs';
import { scratch, splitList, type CoreWorld } from './world.js';

interface CommonScratch {
  actions: CommonServiceOptions;
  store: EventStore;
  people: Map<string, PrivateKeySigner>;
  gate: { allow: boolean; bare?: string | undefined; seen: { windowId: string; kind?: number }[] };
  accepting: boolean;
  published: NostrEvent[];
  result?: { ok: boolean; error?: string };
  note?: NostrEvent;
}

const ctx = { windowId: 'w1' };
const c = (world: CoreWorld): CommonScratch => scratch(world).common as CommonScratch;

async function keyOf(state: CommonScratch, name: string): Promise<string> {
  let signer = state.people.get(name);
  if (!signer) {
    signer = new PrivateKeySigner();
    state.people.set(name, signer);
  }
  return signer.getPublicKey();
}

async function build(world: CoreWorld, session: 'signer' | 'read-only' | 'signed-out', follows: string[]): Promise<void> {
  const previous = scratch(world).common as CommonScratch | undefined;
  const state: CommonScratch = { actions: {} as CommonServiceOptions, store: new EventStore(), people: previous?.people ?? new Map(), gate: { allow: true, seen: [] }, accepting: true, published: [] };
  scratch(world).common = state;
  const self = await keyOf(state, 'me');
  const signer = state.people.get('me') as PrivateKeySigner;
  const tags = [...(await Promise.all(follows.map((name) => keyOf(state, name)))).map((key) => ['p', key]), ['client', 'kernl']];
  state.store.add(await signer.signEvent({ kind: 3, created_at: 1_700_000_000, tags, content: '{"relays":{}}' }));
  state.actions = createCommonActions({
    store: state.store,
    profiles: { settled: async (pubkey) => toProfileCard(pubkey, state.store.getReplaceable(0, pubkey)) },
    pubkey: () => (session === 'signed-out' ? undefined : self),
    signer: () => (session === 'signer' ? signer : undefined),
    consent: async (windowId, template) => {
      state.gate.seen.push({ windowId, ...(template.kind === undefined ? {} : { kind: template.kind }) });
      if (state.gate.bare !== undefined) throw state.gate.bare;
      if (!state.gate.allow) throw new Error('denied:consent');
    },
    publish: async (event) => {
      if (!state.accepting) throw new Error('unavailable:not-accepted:0/1');
      state.published.push(event);
      return 1;
    },
    loadFollows: async () => undefined,
  });
}

Given('social actions for a signed-in account following {string}', (world: CoreWorld, names: string) => build(world, 'signer', splitList(names)));
Given('social actions for a read-only session', (world: CoreWorld) => build(world, 'read-only', []));
Given('social actions with nobody signed in', (world: CoreWorld) => build(world, 'signed-out', []));

Given('{string} published a profile named {string} and displayed as {string}', async (world: CoreWorld, who: string, name: string, display: string) => {
  const state = c(world);
  await keyOf(state, who);
  const signer = state.people.get(who) as PrivateKeySigner;
  const profile = display ? { name, display_name: display } : { name };
  state.store.add(await signer.signEvent({ kind: 0, created_at: 1_700_000_000, tags: [], content: JSON.stringify(profile) }));
});

Then('the profile of {string} read by key is named {string} and displayed as {string}', async (world: CoreWorld, who: string, name: string, display: string) => {
  const pubkey = await keyOf(c(world), who);
  expect(await c(world).actions.getProfile?.(pubkey, ctx)).toEqual({ ok: true, pubkey, profile: { name, displayName: display } });
});

Then('the profile of {string} read by shared address is named {string} and displayed as {string}', async (world: CoreWorld, who: string, name: string, display: string) => {
  const pubkey = await keyOf(c(world), who);
  expect(await c(world).actions.getProfile?.(npubEncode(pubkey), ctx)).toMatchObject({ ok: true, pubkey, profile: { name, displayName: display } });
});

Then('the profile of {string} reads as none', async (world: CoreWorld, who: string) => {
  const pubkey = await keyOf(c(world), who);
  expect(await c(world).actions.getProfile?.(pubkey, ctx)).toEqual({ ok: true, pubkey, profile: null });
});

Then('the profile of {string} is refused with {string}', async (world: CoreWorld, target: string, error: string) => {
  expect(await c(world).actions.getProfile?.(target, ctx)).toEqual({ ok: false, pubkey: '', error });
});

Then('the account follows {string}', async (world: CoreWorld, names: string) => {
  const keys = await Promise.all(splitList(names).map((name) => keyOf(c(world), name)));
  expect(await c(world).actions.follows?.(ctx)).toEqual({ ok: true, pubkeys: keys });
});

Then("reading the account's follows fails with {string}", async (world: CoreWorld, error: string) => {
  expect(await c(world).actions.follows?.(ctx)).toEqual({ ok: false, pubkeys: [], error });
});

async function target(world: CoreWorld, who: string): Promise<string> {
  return who === 'not a key' ? who : keyOf(c(world), who);
}

When('the applet follows {string}', async (world: CoreWorld, who: string) => {
  c(world).result = await c(world).actions.follow?.([await target(world, who)], ctx);
});

When('the applet unfollows {string}', async (world: CoreWorld, who: string) => {
  c(world).result = await c(world).actions.unfollow?.([await target(world, who)], ctx);
});

Given('the signing gate refuses', (world: CoreWorld) => {
  c(world).gate.allow = false;
});

Given('the signing gate allows', (world: CoreWorld) => {
  c(world).gate.allow = true;
  c(world).gate.bare = undefined;
});

Given('the signing gate refuses with a bare reason {string}', (world: CoreWorld, reason: string) => {
  c(world).gate.bare = reason;
});

Then('the profile of {string} read by key is named {string} with no display name', async (world: CoreWorld, who: string, name: string) => {
  const pubkey = await keyOf(c(world), who);
  expect(await c(world).actions.getProfile?.(pubkey, ctx)).toEqual({ ok: true, pubkey, profile: { name } });
});

Given('no relay accepts', (world: CoreWorld) => {
  c(world).accepting = false;
});

Then('the action succeeded and the account follows {string}', async (world: CoreWorld, names: string) => {
  expect(c(world).result).toMatchObject({ ok: true });
  const keys = await Promise.all(splitList(names).map((name) => keyOf(c(world), name)));
  expect(await c(world).actions.follows?.(ctx)).toEqual({ ok: true, pubkeys: keys });
});

Then('the new follow list kept the {string} tag and the content', (world: CoreWorld, tag: string) => {
  const list = c(world).published.at(-1) as NostrEvent;
  expect(list.tags.some((entry) => entry[0] === tag)).toBe(true);
  expect(list.content).toBe('{"relays":{}}');
});

Then('the signing gate saw a kind {int} change from window {string}', (world: CoreWorld, kind: number, windowId: string) => {
  expect(c(world).gate.seen.at(-1)).toEqual({ windowId, kind });
});

Then('the action failed with {string}', (world: CoreWorld, error: string) => {
  expect(c(world).result).toEqual({ ok: false, error });
});

Given('{string} posted a note the store holds', async (world: CoreWorld, who: string) => {
  const state = c(world);
  await keyOf(state, who);
  state.note = await (state.people.get(who) as PrivateKeySigner).signEvent({ kind: 1, created_at: 1_700_000_000, tags: [], content: 'hi' });
  state.store.add(state.note);
});

When("the applet reacts {string} to carol's note", async (world: CoreWorld, reaction: string) => {
  c(world).result = await c(world).actions.react?.((c(world).note as NostrEvent).id, reaction, undefined, ctx);
});

When("the applet reacts {string} with emoji {string} to carol's note", async (world: CoreWorld, reaction: string, href: string) => {
  c(world).result = await c(world).actions.react?.((c(world).note as NostrEvent).id, reaction, href, ctx);
});

When('the applet reacts {string} to an event the shell has not seen', async (world: CoreWorld, reaction: string) => {
  c(world).result = await c(world).actions.react?.('ef'.repeat(32), reaction, undefined, ctx);
});

Then('the published reaction has tags {string} and content {string}', (world: CoreWorld, names: string, content: string) => {
  const reaction = c(world).published.at(-1) as NostrEvent;
  expect(reaction).toMatchObject({ kind: 7, content });
  expect(reaction.tags.map((tag) => tag[0])).toEqual(splitList(names));
});

When("the applet reports carol's account for {string} saying {string}", async (world: CoreWorld, reason: string, text: string) => {
  const pubkey = await keyOf(c(world), 'carol');
  c(world).result = await c(world).actions.report?.({ type: 'pubkey', pubkey }, reason as never, text, ctx);
});

When('the applet reports an event by {string} for {string} saying {string}', async (world: CoreWorld, who: string, reason: string, text: string) => {
  const pubkey = await keyOf(c(world), who);
  c(world).result = await c(world).actions.report?.({ type: 'event', id: 'ef'.repeat(32), pubkey }, reason as never, text, ctx);
});

When('the applet reports an event of no known author for {string} saying {string}', async (world: CoreWorld, reason: string, text: string) => {
  c(world).result = await c(world).actions.report?.({ type: 'event', id: 'ef'.repeat(32) }, reason as never, text, ctx);
});

Then('the published report has tags {string} and content {string}', (world: CoreWorld, tags: string, content: string) => {
  const report = c(world).published.at(-1) as NostrEvent;
  expect(report).toMatchObject({ kind: 1984, content });
  expect(report.tags.map((tag) => [tag[0], tag[2]].filter(Boolean).join(':'))).toEqual(splitList(tags));
});

Then('the published report has tags {string}', (world: CoreWorld, tags: string) => {
  const report = c(world).published.at(-1) as NostrEvent;
  expect(report.tags.map((tag) => [tag[0], tag[2]].filter(Boolean).join(':'))).toEqual(splitList(tags));
});

Given("the shell's social actions over a pool that accepts and a follow-list lookup that fails", async (world: CoreWorld) => {
  const state = c(world);
  const accounts = new AccountManager();
  const signer = new PrivateKeySigner();
  const account = PrivateKeyAccount.fromKey(signer.key);
  accounts.addAccount(account);
  accounts.setActive(account);
  const sent: { relays: string[]; event: NostrEvent }[] = [];
  const pool = { publish: async (relays: string[], event: NostrEvent) => (sent.push({ relays, event }), relays.map((from) => ({ ok: true, from }))) };
  const tiers = createRelayTiers(scratch(world).storage);
  scratch(world).shellSent = sent;
  scratch(world).shellTiers = tiers;
  state.actions = commonActionsFor(
    { eventStore: state.store, pool: pool as never, tiers, accounts },
    { profiles: { settled: async (pubkey) => toProfileCard(pubkey, undefined) }, replaceableLoader: (() => throwError(() => new Error('relays down'))) as never, signer: () => signer },
    async () => undefined,
  );
});

When("the applet follows {string} through the shell's social actions", async (world: CoreWorld, who: string) => {
  c(world).result = await c(world).actions.follow?.([await keyOf(c(world), who)], ctx);
});

Then('the shell published a kind 3 list to the people tier', (world: CoreWorld) => {
  expect(c(world).result).toMatchObject({ ok: true });
  const [sent] = scratch(world).shellSent as { relays: string[]; event: NostrEvent }[];
  const config = (scratch(world).shellTiers as ReturnType<typeof createRelayTiers>).get();
  expect(sent?.event.kind).toBe(3);
  expect(sent?.relays).toEqual([...new Set([...config.discovery, ...config.outbox, ...config.super])]);
});
