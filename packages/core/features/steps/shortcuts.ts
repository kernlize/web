import { expect, vi } from 'vitest';
import { After, Given, Then, When, type DataTable } from 'quickpickle';
import { createForwardedKeys, createKeymapHold, type KeymapHold, type ShortcutKey } from '@kernlize/core';
import { blobFetcher, boot, hello, k, mountFrame, settle } from './kernl.js';
import { scratch, type CoreWorld, type ManifestVector } from './world.js';

interface ShortcutsScratch {
  /** Stands in for the page's `document`: where the shell hears keys pressed outside applets. */
  readonly target: EventTarget;
  /** Keys the core handed the host. */
  readonly handed: ShortcutKey[];
  /** The last key pressed on the shell. */
  pressed?: Event;
}

function shortcuts(world: CoreWorld): ShortcutsScratch {
  const value = scratch(world).shortcuts as ShortcutsScratch | undefined;
  if (!value) throw new Error('create a shell that hears keys first');
  return value;
}

/** `'Ctrl+S'` as the page would report the key press. */
function keyOf(chord: string): ShortcutKey {
  const parts = chord.split('+');
  const key = parts.pop() as string;
  const held = new Set(parts);
  return {
    key: key.length === 1 ? key.toLowerCase() : key,
    code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key === '/' ? 'Slash' : key,
    ctrlKey: held.has('Ctrl'),
    altKey: held.has('Alt'),
    shiftKey: held.has('Shift'),
    metaKey: held.has('Meta'),
  };
}

function received(world: CoreWorld, type: string): Array<Record<string, unknown>> {
  return k(world).received.filter((entry) => entry.type === type);
}

/** Where on the shell's page a key lands: what the element it is aimed at looks like, and what happened to the press before the core heard it. */
const PLACES: Readonly<Record<string, { readonly element?: Record<string, unknown>; readonly press?: Record<string, unknown>; readonly handled?: boolean }>> = {
  'in a text field': { element: { tagName: 'input' } },
  'on a button': { element: { tagName: 'BUTTON' } },
  'in editable text': { element: { tagName: 'DIV', isContentEditable: true } },
  'while a character is composed': { press: { isComposing: true } },
  'after the shell handled it': { handled: true },
  "on the window's title bar": { element: { tagName: 'DIV', isContentEditable: false } },
  'on something with no element name': { element: { tagName: 7 } },
};

async function press(world: CoreWorld, chord: string, place: keyof typeof PLACES | undefined): Promise<void> {
  const state = shortcuts(world);
  const { element = { tagName: undefined, isContentEditable: undefined }, press: extra = {}, handled = false } = place ? (PLACES[place] as (typeof PLACES)[string]) : {};
  // The press's `target` is whatever it is dispatched on, so the stand-in document wears the element's looks.
  Object.assign(state.target, { tagName: undefined, isContentEditable: undefined }, element);
  const event = Object.assign(new Event('keydown', { cancelable: true }), keyOf(chord), { repeat: false }, extra);
  if (handled) event.preventDefault();
  state.pressed = event;
  state.target.dispatchEvent(event);
  await settle();
}

After(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

Given('a kernl shell over that host and pool that hears keys and keeps {string} for itself', (world: CoreWorld, chord: string) => {
  const value: ShortcutsScratch = { target: new EventTarget(), handed: [] };
  scratch(world).shortcuts = value;
  boot(world, { shortcuts: { target: value.target, reserved: [chord] } }, { ...blobFetcher(world), onShortcut: (key) => void value.handed.push(key) });
});

Given('a page whose document hears keys', (world: CoreWorld) => {
  const value: ShortcutsScratch = { target: new EventTarget(), handed: [] };
  scratch(world).shortcuts = value;
  vi.stubGlobal('document', value.target);
});

/**
 * A registration made in a window's first second is held until that second is over, so its answer
 * is waited for, not assumed: this resolves when `count` registrations have been answered.
 */
async function answered(world: CoreWorld, count: number): Promise<void> {
  for (let waited = 0; waited < 3000 && received(world, 'keys.registerAction.result').length < count; waited += 40) await settle();
}

Given('a mounted applet that has said hello and was granted nothing', async (world: CoreWorld) => {
  const { kernl } = k(world);
  const summary = await kernl.resolve(kernl.decodePointer(`${(scratch(world).manifest as ManifestVector).pubkey}:35129:chat`));
  k(world).summary = summary;
  k(world).plan = await kernl.plan(summary);
  mountFrame(world);
  const win = k(world).frame?.contentWindow;
  if (!win) throw new Error('mount first');
  k(world).channel = hello(world, win);
  k(world).channel.port1.postMessage({ type: 'shell.ready', id: 'ready-1' });
  await settle();
});

When('the applet registers the action {string} on {string} over its port', async (world: CoreWorld, id: string, chord: string) => {
  const before = received(world, 'keys.registerAction.result').length;
  k(world).channel?.port1.postMessage({ type: 'keys.registerAction', id: `register-${id}`, action: { id, label: id, defaultKey: chord } });
  await answered(world, before + 1);
});

When('the applet drops the action {string} over its port', async (world: CoreWorld, actionId: string) => {
  k(world).channel?.port1.postMessage({ type: 'keys.unregisterAction', actionId });
  await settle();
});

function forward(world: CoreWorld, chord: string): void {
  const key = keyOf(chord);
  k(world).channel?.port1.postMessage({ type: 'keys.forward', key: key.key, code: key.code, ctrl: key.ctrlKey, alt: key.altKey, shift: key.shiftKey, meta: key.metaKey });
}

When('the applet forwards {string} over its port', async (world: CoreWorld, chord: string) => {
  forward(world, chord);
  await settle();
});

When('the applet forwards {string} {int} times over its port', async (world: CoreWorld, chord: string, times: number) => {
  for (let i = 0; i < times; i += 1) forward(world, chord);
  await settle();
  await settle();
});

When('{string} is pressed on the shell', (world: CoreWorld, chord: string) => press(world, chord, undefined));

for (const place of Object.keys(PLACES)) {
  When(`{string} is pressed on the shell ${place}`, (world: CoreWorld, chord: string) => press(world, chord, place));
}

Then('the applet was last told its bindings are {string}', (world: CoreWorld, expected: string) => {
  const bindings = received(world, 'keys.bindings').at(-1)?.bindings as Array<{ actionId: string; key: string }> | undefined;
  expect(bindings?.map((binding) => `${binding.actionId}=${binding.key}`).join(',')).toBe(expected);
});

Then("the applet's {string} names no binding", (world: CoreWorld, type: string) => {
  const [result] = received(world, type);
  expect(result).toBeDefined();
  expect(result).not.toHaveProperty('binding');
  expect(result).not.toHaveProperty('error');
});

Then('the applet was told to run {string} {int} times', (world: CoreWorld, actionId: string, times: number) => {
  expect(received(world, 'keys.action').filter((entry) => entry.actionId === actionId)).toHaveLength(times);
});

Then('the page was kept from acting on the last key', (world: CoreWorld) => {
  expect(shortcuts(world).pressed?.defaultPrevented).toBe(true);
});

Then('the page was left to act on the last key', (world: CoreWorld) => {
  expect(shortcuts(world).pressed?.defaultPrevented).toBe(false);
});

Then('the host was handed the keys {string}', (world: CoreWorld, chords: string) => {
  expect(shortcuts(world).handed).toEqual(chords === '' ? [] : chords.split(',').map(keyOf));
});

Then('the shell guard reported nothing', (world: CoreWorld) => {
  expect(k(world).guardEvents).toEqual([]);
});

Then('the forwarded-key filter over one window decides', (_world: CoreWorld, table: DataTable) => {
  const filter = createForwardedKeys();
  for (const row of table.hashes()) {
    const dropped = filter.drops('w1', JSON.parse(row.message as string), row.focused === 'yes', Number(row.at));
    expect(dropped, `${row.message} at ${row.at}`).toBe(row.drops === 'yes');
  }
  // A forgotten window's next key is a press, however soon it comes.
  expect(filter.drops('w1', { type: 'keys.forward', key: 'z' }, true, 5000)).toBe(false);
  filter.forget('w1');
  expect(filter.drops('w1', { type: 'keys.forward', key: 'z' }, true, 5001)).toBe(false);
});

/** Forty keys no browser or shell keeps: a game's whole keymap, registered as it starts. */
const KEYMAP = [...'abcdefghijklmnopqrstuvwxyz0123456789', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

When('the applet registers {int} actions at once over its port', async (world: CoreWorld, count: number) => {
  for (const [index, key] of KEYMAP.slice(0, count).entries()) {
    k(world).channel?.port1.postMessage({ type: 'keys.registerAction', id: `keymap-${index}`, action: { id: `game.${index}`, label: `Key ${key}`, defaultKey: key } });
  }
  await settle();
});

Then('the applet has no answer to its registrations yet', (world: CoreWorld) => {
  expect(received(world, 'keys.registerAction.result')).toEqual([]);
});

When("the applet's first second is over", async (world: CoreWorld) => {
  await answered(world, 1);
  await settle();
});

Then('all {int} registrations were answered with a binding', (world: CoreWorld, count: number) => {
  const results = received(world, 'keys.registerAction.result');
  expect(results.filter((result) => typeof result.binding === 'string')).toHaveLength(count);
  expect(received(world, 'keys.bindings').at(-1)?.bindings).toHaveLength(count);
});

When('a second passes', async () => {
  await new Promise((resolve) => setTimeout(resolve, 1100));
});

interface HoldScratch {
  readonly hold: KeymapHold;
  readonly handedOn: string[];
}

function newHold(world: CoreWorld): HoldScratch {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const handedOn: string[] = [];
  const value: HoldScratch = { hold: createKeymapHold({ startupMs: () => 1000, release: (windowId) => void handedOn.push(windowId) }), handedOn };
  scratch(world).keymapHold = value;
  return value;
}

Then('the keymap hold over a {int} ms startup decides', (world: CoreWorld, _startupMs: number, table: DataTable) => {
  const { hold } = newHold(world);
  for (const row of table.hashes()) {
    const label = `${row.window} ${row.message} at ${row.at}`;
    expect(hold.holds(row.window as string, JSON.parse(row.message as string), Number(row.at)), label).toBe(row.holds === 'yes');
    expect(hold.holding(row.window as string), label).toBe(row.holding === 'yes');
  }
});

Then('the keymap hold hands on {string} after {int} ms and holds nothing for it afterwards', (world: CoreWorld, windowId: string, ms: number) => {
  const { hold, handedOn } = scratch(world).keymapHold as HoldScratch;
  vi.advanceTimersByTime(ms - 1);
  expect(handedOn).toEqual([]);
  vi.advanceTimersByTime(1);
  expect(handedOn).toEqual([windowId]);
  expect(hold.holding(windowId)).toBe(false);
  expect(hold.holds(windowId, { type: 'keys.registerAction' }, 0)).toBe(false);
});

Then('a forgotten window is never handed on', (world: CoreWorld) => {
  const { hold, handedOn } = newHold(world);
  expect(hold.holds('w3', { type: 'keys.registerAction' }, 0)).toBe(true);
  hold.forget('w3');
  hold.forget('never-seen');
  vi.advanceTimersByTime(5000);
  expect(handedOn).toEqual([]);
  expect(hold.holding('w3')).toBe(false);
  vi.useRealTimers();
});
