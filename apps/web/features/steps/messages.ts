import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { AppletSummary, MountPlan } from '../../src/shell/contract.ts';
import { MESSAGES_ADDRESS, MESSAGES_APPLET, openMessages } from '../../src/shell/messages-applet.ts';

interface MessagesScratch {
  chosen?: string;
  installed: Array<{ catalogId: string; address: string }>;
  unreachable: Set<string>;
  running: Map<string, string>;
  resolved: string[];
  opened: MountPlan[];
  focused: string[];
  error?: Error;
}

interface MessagesWorld {
  shellMessages?: MessagesScratch;
}

/** A test double that implements only what the code under test reads. */
function standIn<T>(partial: object): T {
  return partial as T;
}

function scratchOf(world: MessagesWorld): MessagesScratch {
  world.shellMessages ??= { installed: [], unreachable: new Set(), running: new Map(), resolved: [], opened: [], focused: [] };
  return world.shellMessages;
}

Then('the shipped messages applet is {string}, needs {string} and takes {string}', (_world: MessagesWorld, address: string, requires: string, convention: string) => {
  expect(MESSAGES_ADDRESS).toBe(address);
  expect(MESSAGES_APPLET.requires).toEqual(requires.split(','));
  expect(MESSAGES_APPLET.archetypes?.map((entry) => entry.convention)).toEqual([convention]);
});

Then('the shipped messages applet starts with {string}', (_world: MessagesWorld, grants: string) => {
  expect(MESSAGES_APPLET.grants).toEqual(grants.split(','));
});

Then("the shipped messages applet's bytes hash to its pin", async () => {
  const html = await MESSAGES_APPLET.load();
  expect(createHash('sha256').update(html).digest('hex')).toBe(MESSAGES_APPLET.sha256);
});

Given('a shell with no applet chosen for messages', (world: MessagesWorld) => void scratchOf(world));

Given('a shell where the user chose the installed applet {string} for messages', (world: MessagesWorld, address: string) => {
  const scratch = scratchOf(world);
  scratch.chosen = 'catalogue-id-of-chat';
  scratch.installed.push({ catalogId: 'catalogue-id-of-chat', address }, { catalogId: 'another', address: 'naddr1other' });
});

Given('a shell where the user chose an applet for messages that is no longer installed', (world: MessagesWorld) => {
  const scratch = scratchOf(world);
  scratch.chosen = 'catalogue-id-of-chat';
  scratch.installed.push({ catalogId: 'another', address: 'naddr1other' });
});

Given('the applet at {string} cannot be reached', (world: MessagesWorld, address: string) => void scratchOf(world).unreachable.add(address));

Given('a window {string} already shows {string}', (world: MessagesWorld, windowId: string, address: string) => void scratchOf(world).running.set(address, windowId));

When('the Messages button is pressed', async (world: MessagesWorld) => {
  const scratch = scratchOf(world);
  const kernl = {
    decodePointer: (address: string) => ({ kind: 'event' as const, id: address, relays: [] }),
    intents: { installed: () => scratch.installed, defaults: { get: (archetype: string) => (archetype === 'dm' ? scratch.chosen : undefined) } },
    async resolve(pointer: { id: string }) {
      scratch.resolved.push(pointer.id);
      if (scratch.unreachable.has(pointer.id)) throw new Error('unavailable:blob');
      return { address: pointer.id } as AppletSummary;
    },
    plan: async (summary: AppletSummary) => ({ summary }) as MountPlan,
  };
  await openMessages({
    kernl: standIn<Parameters<typeof openMessages>[0]['kernl']>(kernl),
    running: (address) => scratch.running.get(address),
    focus: (windowId) => void scratch.focused.push(windowId),
    open: (plan) => void scratch.opened.push(plan),
  }).catch((error: Error) => {
    scratch.error = error;
  });
});

Then('the shell resolved {string} and opened its plan', (world: MessagesWorld, addresses: string) => {
  const scratch = scratchOf(world);
  expect(scratch.resolved).toEqual(addresses.split(','));
  expect(scratch.opened.map((plan) => plan.summary.address)).toEqual([addresses.split(',').at(-1)]);
  expect(scratch.error).toBeUndefined();
});

Then('opening messages failed with {string}', (world: MessagesWorld, reason: string) => {
  expect(scratchOf(world).error?.message).toBe(reason);
  expect(scratchOf(world).opened).toEqual([]);
});

Then('the shell focused {string} and opened nothing', (world: MessagesWorld, windowId: string) => {
  const scratch = scratchOf(world);
  expect(scratch.focused).toEqual([windowId]);
  expect(scratch.resolved).toEqual([]);
  expect(scratch.opened).toEqual([]);
});
