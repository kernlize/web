import { expect } from 'vitest';
import { Given, Then, When, type DataTable } from 'quickpickle';
import { originRegistry } from '@kehto/shell';
import { appletMessageFailure, createAppletTraffic, type AppletMessage } from '@kernlize/core';
import { k, settle, windowMessage } from './kernl.js';
import { scratch, type CoreWorld } from './world.js';

// What the shell reports about an applet's messages, read off `kernl.traffic$`.

const watched = (world: CoreWorld): AppletMessage[] => scratch(world).traffic as AppletMessage[];

Given('the shell\'s traffic is watched', (world: CoreWorld) => {
  const seen: AppletMessage[] = [];
  scratch(world).traffic = seen;
  k(world).kernl.traffic$.subscribe((message) => void seen.push(message));
});

When('the applet posts {string} to the parent window', async (world: CoreWorld, type: string) => {
  const win = k(world).frame?.contentWindow;
  if (!win) throw new Error('mount first');
  k(world).kernl.handleWindowMessage(windowMessage(win, { type }, []));
  await settle();
});

Then('the watched traffic began with:', (world: CoreWorld, table: DataTable) => {
  const expected = table.hashes();
  expect(watched(world).slice(0, expected.length).map(({ direction, via, type }) => ({ direction, via, type }))).toEqual(expected);
});

Then('every watched message belongs to the mounted window', (world: CoreWorld) => {
  expect(new Set(watched(world).map((message) => message.windowId))).toEqual(new Set([k(world).plan?.windowId]));
  for (const message of watched(world)) expect(message.at).toBeGreaterThan(0);
});

Then('the watched {string} reports the failure {string}', (world: CoreWorld, type: string, failure: string) => {
  expect(watched(world).find((message) => message.type === type)?.error).toBe(failure);
});

Then('the watched {string} reports no failure', (world: CoreWorld, type: string) => {
  const message = watched(world).find((entry) => entry.type === type);
  expect(message).toBeDefined();
  expect(message?.error).toBeUndefined();
});

Then('the watched traffic ended with a {string} from the applet on the {string}', (world: CoreWorld, type: string, via: string) => {
  expect(watched(world).at(-1)).toMatchObject({ type, via, direction: 'from-applet' });
});

Then('kehto\'s sending to applets is no longer watched', (world: CoreWorld) => {
  const before = watched(world).length;
  originRegistry.postToNapplet(k(world).plan?.windowId ?? '', { type: 'shell.init' });
  expect(watched(world)).toHaveLength(before);
});

Then('the envelope {} reports the failure {string}', (_world: CoreWorld, envelope: string, failure: string) => {
  expect(appletMessageFailure(JSON.parse(envelope))).toBe(failure === '' ? undefined : failure);
});

When('kehto sends {string} to the mounted window before it has said hello', (world: CoreWorld, type: string) => {
  expect(originRegistry.postToNapplet(k(world).plan?.windowId ?? '', { type })).toBe(false);
});

Then('nothing was watched', (world: CoreWorld) => {
  expect(watched(world)).toEqual([]);
});

When('the applet sends a message whose type and failure are {int} characters long', async (world: CoreWorld, length: number) => {
  k(world).channel?.port1.postMessage({ type: 'x'.repeat(length), id: 'long-1', error: 'e'.repeat(length) });
  await settle();
});

Then('the last watched message\'s type is {int} characters and its failure {int}', (world: CoreWorld, typeLength: number, errorLength: number) => {
  const last = watched(world).at(-1);
  expect([last?.type.length, last?.error?.length]).toEqual([typeLength, errorLength]);
});

Given('something else wraps kehto\'s sending after the shell', (world: CoreWorld) => {
  const beneath = originRegistry.postToNapplet;
  const outer: typeof originRegistry.postToNapplet = (windowId, message) => beneath.call(originRegistry, windowId, message);
  originRegistry.postToNapplet = outer;
  scratch(world).outerSend = { outer, beneath };
});

Then('kehto\'s sending is still wrapped by that something else', (world: CoreWorld) => {
  const { outer } = scratch(world).outerSend as { outer: unknown };
  expect(originRegistry.postToNapplet).toBe(outer);
});

Then('a new shell started now hears kehto\'s replies once', (world: CoreWorld) => {
  const later = createAppletTraffic(() => true);
  const heard: AppletMessage[] = [];
  later.traffic$.subscribe((message) => void heard.push(message));
  // A window kehto knows, bound to a port of its own, so the reply is delivered.
  const channel = new MessageChannel();
  originRegistry.register({} as Window, 'outer-check');
  originRegistry.bindPort('outer-check', channel.port2);
  expect(originRegistry.postToNapplet('outer-check', { type: 'shell.init' })).toBe(true);
  expect(heard.map((message) => message.type)).toEqual(['shell.init']);
  later.close();
  later.close();
  channel.port1.close();
  originRegistry.unregister('outer-check');
  const { beneath } = scratch(world).outerSend as { beneath: typeof originRegistry.postToNapplet };
  originRegistry.postToNapplet = beneath;
});
