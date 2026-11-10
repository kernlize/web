import { expect, vi } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { ReadonlyAccount } from 'applesauce-accounts/accounts';
import { PrivateKeySigner } from 'applesauce-signers';
import type { RelayTier } from '@kernlize/core';
import { k, settle } from './kernl.js';
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

When('the applet uploads an {int}-byte {string} file over its port', async (world: CoreWorld, size: number, mimeType: string) => {
  k(world).channel?.port1.postMessage({ type: 'upload.upload', id: 'upload-1', request: { data: new Uint8Array(size).buffer, mimeType } });
  await vi.waitFor(() => expect(k(world).record.prompts.length).toBeGreaterThan(0), { timeout: 3000 });
});

Then('the shell asks the person {string} marked {string}, sending it to {string}', (world: CoreWorld, title: string, severity: string, hosts: string) => {
  const summary = k(world).record.prompts.at(-1)?.summary;
  expect(summary).toMatchObject({ title, severity });
  expect(summary?.lines.find((line) => line.label === 'Sent to')?.after).toBe(hosts);
});

When('the person answers no to the upload', async (world: CoreWorld) => {
  k(world).record.prompts.at(-1)?.resolve(false);
  await settle();
});

Then('the applet is told its upload was {string} with {string}', async (world: CoreWorld, status: string, error: string) => {
  await vi.waitFor(() => expect(k(world).received.some((message) => message.type === 'upload.upload.result')).toBe(true), { timeout: 3000 });
  const reply = k(world).received.find((message) => message.type === 'upload.upload.result') as { result?: { status: string; error: string } };
  expect(reply.result).toMatchObject({ status, error });
});

When("the shell saves the account's file servers as {string}", async (world: CoreWorld, servers: string) => {
  await k(world).kernl.files.save(splitList(servers));
});

Then("the shell's file servers are {string}", (world: CoreWorld, servers: string) => {
  expect(k(world).kernl.files.state()).toMatchObject({ status: 'found', servers: splitList(servers) });
});

When('the applet asks to follow {string} over its port', async (world: CoreWorld, pubkey: string) => {
  k(world).channel?.port1.postMessage({ type: 'common.follow', id: 'follow-1', pubkeys: [pubkey] });
  await vi.waitFor(() => expect(k(world).record.prompts.length).toBeGreaterThan(0), { timeout: 5000 });
});

Then('the shell asks the person {string} before signing', (world: CoreWorld, title: string) => {
  expect(k(world).record.prompts.at(-1)?.summary).toMatchObject({ title, severity: 'destructive' });
});

When('the person answers no to the follow', async (world: CoreWorld) => {
  k(world).record.prompts.at(-1)?.resolve(false);
  await settle();
});

Then('the applet is told its follow failed with {string}', async (world: CoreWorld, error: string) => {
  await vi.waitFor(() => expect(k(world).received.some((message) => message.type === 'common.follow.result')).toBe(true), { timeout: 3000 });
  const reply = k(world).received.find((message) => message.type === 'common.follow.result') as { ok?: boolean; error?: string; result?: { ok: boolean; error?: string } };
  expect(reply.result ?? reply).toMatchObject({ ok: false, error });
});
