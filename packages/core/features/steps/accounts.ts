import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { AccountManager, IAccount } from 'applesauce-accounts';
import { PrivateKeyAccount, ReadonlyAccount } from 'applesauce-accounts/accounts';
import { PrivateKeySigner } from 'applesauce-signers';
import type { Signer } from '@kehto/runtime';
import { createAuthHooks, createKernlAccounts, isReadOnlyAccount, wrapAccountSigner } from '@kernl/core';
import { allowAllSigning, attempt, passwordAccount, scratch, type CoreWorld } from './world.js';

function accounts(world: CoreWorld): AccountManager {
  const value = scratch(world).accounts as AccountManager | undefined;
  if (!value) throw new Error('create accounts first');
  return value;
}

Given('kernl accounts over empty storage', (world: CoreWorld) => {
  scratch(world).accounts = createKernlAccounts(scratch(world).storage);
});

Given('kernl accounts over that storage', (world: CoreWorld) => {
  scratch(world).accounts = createKernlAccounts(scratch(world).storage);
});

When('kernl accounts are created again over the same storage', (world: CoreWorld) => {
  scratch(world).accounts = createKernlAccounts(scratch(world).storage);
});

Given('storage key {string} holding a serialised private key account', (world: CoreWorld, key: string) => {
  const account = PrivateKeyAccount.generateNew();
  scratch(world).storage.setItem(key, JSON.stringify([account.toJSON()]));
});

When('the shell adds a password account named {string} and makes it active', async (world: CoreWorld, name: string) => {
  const account = await passwordAccount(name);
  accounts(world).addAccount(account);
  accounts(world).setActive(account);
});

When('the shell adds a read-only account and makes it active', (world: CoreWorld) => {
  const account = ReadonlyAccount.fromPubkey('3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d');
  accounts(world).addAccount(account);
  accounts(world).setActive(account);
});

When('the shell adds a private key account', async (world: CoreWorld) => {
  await attempt(world, () => accounts(world).addAccount(PrivateKeyAccount.generateNew()));
});

When('the shell clears the active account', (world: CoreWorld) => {
  accounts(world).clearActive();
});

When('the shell wraps a bare signing account', (world: CoreWorld) => {
  const signer = new PrivateKeySigner();
  const bare: IAccount = {
    id: 'bare',
    type: 'bare',
    pubkey: 'ab'.repeat(32),
    signer,
    getPublicKey: () => signer.getPublicKey(),
    signEvent: (template) => signer.signEvent(template),
    toJSON: () => ({ id: 'bare', type: 'bare', pubkey: 'ab'.repeat(32), signer: undefined }),
  };
  scratch(world).wrapped = wrapAccountSigner(bare);
});

Then('there are {int} accounts and no active account', (world: CoreWorld, count: number) => {
  expect(accounts(world).accounts).toHaveLength(count);
  expect(accounts(world).active).toBeUndefined();
});

Then('there are {int} accounts and the active account is named {string}', (world: CoreWorld, count: number, name: string) => {
  expect(accounts(world).accounts).toHaveLength(count);
  expect((accounts(world).active?.metadata as { name?: string } | undefined)?.name).toBe(name);
});

Then('storage key {string} lists {int} accounts of type {string}', (world: CoreWorld, key: string, count: number, type: string) => {
  const stored = JSON.parse(scratch(world).storage.getItem(key) ?? '[]') as Array<{ type: string }>;
  expect(stored).toHaveLength(count);
  expect(stored.every((entry) => entry.type === type)).toBe(true);
});

Then('storage key {string} names the active account', (world: CoreWorld, key: string) => {
  expect(JSON.parse(scratch(world).storage.getItem(key) ?? 'null')).toBe(accounts(world).active?.id);
});

Then('storage has no key {string}', (world: CoreWorld, key: string) => {
  expect(scratch(world).storage.getItem(key)).toBeNull();
});

Then('the auth hooks report no user and no signer', (world: CoreWorld) => {
  const auth = createAuthHooks(accounts(world), allowAllSigning);
  expect(auth.getUserPubkey()).toBeNull();
  expect(auth.getSigner()).toBeNull();
});

Then('the auth hooks report the active pubkey', (world: CoreWorld) => {
  expect(createAuthHooks(accounts(world), allowAllSigning).getUserPubkey()).toBe(accounts(world).active?.pubkey);
});

Then('the auth hooks report no signer', (world: CoreWorld) => {
  expect(createAuthHooks(accounts(world), allowAllSigning).getSigner()).toBeNull();
});

Then('the account is read-only', (world: CoreWorld) => {
  expect(isReadOnlyAccount(accounts(world).active as IAccount)).toBe(true);
});

Then('the account is not read-only', (world: CoreWorld) => {
  expect(isReadOnlyAccount(accounts(world).active as IAccount)).toBe(false);
});

Then('the wrapped signer signs a kind {int} event for the active pubkey', async (world: CoreWorld, kind: number) => {
  const signer = createAuthHooks(accounts(world), allowAllSigning).getSigner() as Signer;
  expect(await signer.getPublicKey?.()).toBe(accounts(world).active?.pubkey);
  const event = await signer.signEvent?.({ kind, tags: [], content: 'hi', created_at: 1_700_000_000 });
  expect(event?.pubkey).toBe(accounts(world).active?.pubkey);
  expect(event?.sig).toHaveLength(128);
});

Then('the wrapped signer exposes nip04 and nip44', (world: CoreWorld) => {
  const signer = createAuthHooks(accounts(world), allowAllSigning).getSigner() as Signer;
  expect(signer.nip04).toBeDefined();
  expect(signer.nip44).toBeDefined();
});

Then('the wrapped signer has no nip04 and no nip44', (world: CoreWorld) => {
  const signer = scratch(world).wrapped as Signer;
  expect(signer.nip04).toBeUndefined();
  expect(signer.nip44).toBeUndefined();
  expect(typeof signer.signEvent).toBe('function');
});
