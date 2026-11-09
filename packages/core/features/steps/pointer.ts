import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { naddrEncode, neventEncode, noteEncode } from 'applesauce-core/helpers';
import { decodePointer, type AppletPointer } from '@kernlize/core';
import { attempt, last, scratch, splitList, type CoreWorld } from './world.js';

function pointer(world: CoreWorld): AppletPointer {
  const value = scratch(world).pointer as AppletPointer | undefined;
  if (!value) throw new Error('decode a pointer first');
  return value;
}

async function decode(world: CoreWorld, input: string): Promise<void> {
  await attempt(world, () => {
    scratch(world).pointer = decodePointer(input);
  });
}

When('the shell decodes pointer {string}', async (world: CoreWorld, input: string) => {
  await decode(world, input);
});

Given('an naddr for kind {int} by {string} with identifier {string} and relays {string}', (world: CoreWorld, kind: number, pubkey: string, identifier: string, relays: string) => {
  scratch(world).encoded = naddrEncode({ kind, pubkey, identifier, relays: splitList(relays) });
});

Given('an nevent for id {string} by {string} with relays {string}', (world: CoreWorld, id: string, author: string, relays: string) => {
  scratch(world).encoded = neventEncode({ id, author, relays: splitList(relays) });
});

Given('an nevent for id {string} without an author', (world: CoreWorld, id: string) => {
  scratch(world).encoded = neventEncode({ id });
});

Given('a note for id {string}', (world: CoreWorld, id: string) => {
  scratch(world).encoded = noteEncode(id);
});

When('the shell decodes that encoded pointer', async (world: CoreWorld) => {
  await decode(world, `nostr:${String(scratch(world).encoded)}`);
});

Then('the pointer is an event with id {string}', (world: CoreWorld, id: string) => {
  expect(pointer(world)).toMatchObject({ kind: 'event', id });
});

Then('the pointer is an address for kind {int} by {string} with identifier {string}', (world: CoreWorld, eventKind: number, pubkey: string, identifier: string) => {
  expect(pointer(world)).toMatchObject({ kind: 'address', eventKind, pubkey, identifier });
});

Then('the pointer has no relay hints', (world: CoreWorld) => {
  expect(pointer(world).relays).toEqual([]);
});

Then('the pointer has relay hints {string}', (world: CoreWorld, relays: string) => {
  expect(pointer(world).relays).toEqual(splitList(relays));
});

Then('the pointer author is {string}', (world: CoreWorld, author: string) => {
  const value = pointer(world);
  expect(value.kind === 'event' && value.author).toBe(author);
});

Then('the pointer has no author', (world: CoreWorld) => {
  const value = pointer(world);
  expect(value.kind === 'event' && 'author' in value).toBe(false);
});

Then('the shell refused with {string}', (world: CoreWorld, reason: string) => {
  expect(last(scratch(world).errors).message).toBe(reason);
});

Then('the shell refused nothing', (world: CoreWorld) => {
  expect(scratch(world).errors).toEqual([]);
});
