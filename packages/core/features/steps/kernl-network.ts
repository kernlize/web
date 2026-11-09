import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { ReadonlyAccount } from 'applesauce-accounts/accounts';
import { PrivateKeySigner } from 'applesauce-signers';
import type { RelayTier } from '@kernlize/core';
import { k } from './kernl.js';
import { attempt, scratch, splitList, type CoreWorld } from './world.js';

Given('the fake pool serves a profile named {string} for a fresh key', async (world: CoreWorld, name: string) => {
  const signer = new PrivateKeySigner();
  scratch(world).freshKey = await signer.getPublicKey();
  scratch(world).pool.events = [await signer.signEvent({ kind: 0, tags: [], content: JSON.stringify({ name }), created_at: 1_700_000_000 })];
});

When('the shell logs in read-only as that fresh key', async (world: CoreWorld) => {
  await k(world).kernl.login(ReadonlyAccount.fromPubkey(scratch(world).freshKey as string));
});

Then('the shell session label eventually is {string}', async (world: CoreWorld, label: string) => {
  await expect.poll(() => k(world).kernl.session?.label, { timeout: 3000 }).toBe(label);
});

Then('the shell profile card for that fresh key is named {string}', (world: CoreWorld, name: string) => {
  expect(k(world).kernl.profiles.card(scratch(world).freshKey as string)).toMatchObject({ name, found: true });
});

Given('the fake pool serves a relay list writing to {string} for a fresh key', async (world: CoreWorld, url: string) => {
  const signer = new PrivateKeySigner();
  scratch(world).freshKey = await signer.getPublicKey();
  scratch(world).pool.events = [await signer.signEvent({ kind: 10002, tags: [['r', url, 'write']], content: '', created_at: 1_700_000_000 })];
});

Then('the {string} tier eventually is {string}', async (world: CoreWorld, tier: RelayTier, urls: string) => {
  await expect.poll(() => k(world).kernl.relays.get()[tier], { timeout: 3000 }).toEqual(splitList(urls));
});

Then('the shell mailboxes are found with outbox {string}', (world: CoreWorld, urls: string) => {
  expect(k(world).kernl.mailboxes.state()).toMatchObject({ status: 'found', mailboxes: { outboxes: splitList(urls) } });
});

Then('the shell directory suggests {int} inbox servers before it starts', (world: CoreWorld, count: number) => {
  expect(k(world).kernl.directory.suggest({ purpose: 'inbox' })).toHaveLength(count);
});

When("the shell saves the account's inbox and outbox as {string}", async (world: CoreWorld, urls: string) => {
  await attempt(world, async () => {
    scratch(world).mailboxSave = await k(world).kernl.mailboxes.save({ inboxes: splitList(urls), outboxes: splitList(urls) });
  });
});

Then("the shell's last save was accepted by {string}", (world: CoreWorld, urls: string) => {
  expect(scratch(world).mailboxSave).toMatchObject({ ok: true, refused: [] });
  expect((scratch(world).mailboxSave as { accepted: string[] }).accepted).toEqual(expect.arrayContaining(splitList(urls)));
});
