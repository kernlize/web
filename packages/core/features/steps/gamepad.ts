import { expect, vi } from 'vitest';
import { createWindowManager, type WindowManager } from '@kernlize/core/wm';
import { After, Given, Then, When } from 'quickpickle';
import { blobFetcher, boot, hello, k, settle } from './kernl.js';
import { createFakeFrame, scratch, type CoreWorld } from './world.js';

/** The standard-mapping button indices a scenario can press, as NAP-GAMEPAD numbers them. */
const BUTTONS: Readonly<Record<string, number>> = { A: 0, B: 1, X: 2, Y: 3 };

interface FakePadPage {
  readonly document: {
    visibilityState: string;
    activeElement: null;
    hasFocus(): boolean;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
  };
  readonly navigator: { getGamepads(): unknown[] };
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(frame: number): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  /** Run what the service scheduled, as the page's frames would. */
  flush(): void;
}

interface GamepadScratch {
  readonly page: FakePadPage;
  second?: { manager: WindowManager; windowId: string; channel: MessageChannel; received: Array<Record<string, unknown>> };
}

/**
 * A page with a controller reader and the frame pump kehto schedules on. The pad
 * reports every button the scenario pressed and nothing else, so a snapshot's
 * buttons say exactly what the reader gave.
 */
function fakePage(pressed: Set<string>): FakePadPage {
  const listeners = new Map<string, Set<() => void>>();
  const frames: Array<() => void> = [];
  const add = (type: string, listener: () => void): void => {
    const held = listeners.get(type) ?? new Set();
    listeners.set(type, held);
    held.add(listener);
  };
  const page: FakePadPage = {
    document: {
      visibilityState: 'visible',
      activeElement: null,
      hasFocus: () => true,
      addEventListener: add,
      removeEventListener: (type, listener) => void listeners.get(type)?.delete(listener),
    },
    navigator: {
      getGamepads: () => [
        {
          index: 0,
          id: 'Fake Pad (STANDARD GAMEPAD)',
          mapping: 'standard',
          connected: true,
          timestamp: 1,
          axes: [0, 0, 0, 0],
          buttons: Array.from({ length: 16 }, (_, index) => {
            const pressedNow = [...pressed].some((name) => BUTTONS[name] === index);
            return { value: pressedNow ? 1 : 0, pressed: pressedNow, touched: pressedNow };
          }),
        },
      ],
    },
    requestAnimationFrame: (callback) => frames.push(callback),
    cancelAnimationFrame: () => void frames.shift(),
    addEventListener: add,
    removeEventListener: (type, listener) => void listeners.get(type)?.delete(listener),
    flush: () => {
      for (let run = 0; run < 20 && frames.length > 0; run += 1) frames.shift()?.();
    },
  };
  return page;
}

function pad(world: CoreWorld): GamepadScratch {
  const value = scratch(world).gamepad as GamepadScratch | undefined;
  if (!value) throw new Error('a page with a controller reader comes first');
  return value;
}

/** The last snapshot the applet was pushed. */
function snapshot(world: CoreWorld, received = k(world).received): Record<string, unknown> {
  const state = [...received].reverse().find((entry) => entry.type === 'gamepad.state');
  if (!state) throw new Error('no controller snapshot yet');
  return state;
}

/** Every button the snapshot reports as pressed, over its whole slot list. */
function pressedIn(world: CoreWorld, received = k(world).received): string[] {
  const pads = (snapshot(world, received).pads ?? []) as Array<{ buttons: Array<{ pressed: boolean }> } | null>;
  return pads.flatMap((slot, index) => (slot?.buttons ?? []).flatMap((button, at) => (button.pressed ? [`${index}:${at}`] : [])));
}

Given('a page whose controller reader holds a pad with the {string} button pressed', (world: CoreWorld, name: string) => {
  const pressed = new Set([name]);
  scratch(world).gamepad = { page: fakePage(pressed) } satisfies GamepadScratch;
});

function bootWithControllers(world: CoreWorld, offer: boolean): void {
  vi.stubGlobal('window', pad(world).page);
  try {
    boot(world, { controllers: { window, offer } }, blobFetcher(world));
  } finally {
    vi.unstubAllGlobals();
  }
}

Given('a kernl shell over that host and pool that reads controllers', (world: CoreWorld) => {
  bootWithControllers(world, true);
});

Given('a kernl shell over that host and pool with controllers disabled', (world: CoreWorld) => {
  bootWithControllers(world, false);
});

When('the applet requests controller input over its port', async (world: CoreWorld) => {
  k(world).channel!.port1.postMessage({ type: 'gamepad.subscribe' });
  await settle();
});

When('the applet subscribes to controllers over its port', async (world: CoreWorld) => {
  k(world).channel?.port1.postMessage({ type: 'gamepad.subscribe' });
  pad(world).page.flush();
  for (let waited = 0; waited < 40 && !k(world).received.some((entry) => entry.type === 'gamepad.state'); waited += 1) await settle();
  expect(k(world).received.some((entry) => entry.type === 'gamepad.state')).toBe(true);
});

When('the person turns to another window', async (world: CoreWorld) => {
  k(world).handle?.setVisibility({ visible: true, focused: false });
  await settle();
});

When('a second window subscribes to controllers in the background', async (world: CoreWorld) => {
  const { kernl, summary, handle: first } = k(world);
  const frame = createFakeFrame();
  const handle = kernl.mount(await kernl.plan(summary!), frame);
  const manager = createWindowManager();
  manager.open(handle.windowId);
  manager.open(first!.windowId);
  manager.attach(first!.windowId, first!);
  manager.attach(handle.windowId, handle);
  const channel = hello(world, frame.contentWindow!);
  const received: Array<Record<string, unknown>> = [];
  channel.port1.onmessage = (event) => received.push(event.data);
  pad(world).second = { manager, windowId: handle.windowId, channel, received };
  channel.port1.postMessage({ type: 'shell.ready', id: 'ready-2' });
  channel.port1.postMessage({ type: 'gamepad.subscribe' });
  await settle();
});

After((world: CoreWorld) => {
  const state = scratch(world).gamepad as GamepadScratch | undefined;
  state?.second?.channel.port1.close();
  state?.second?.manager.destroy();
});

Then("the second window's snapshot is neutral", (world: CoreWorld) => {
  const { received } = pad(world).second!;
  expect(snapshot(world, received).focused).toBe(false);
  expect(pressedIn(world, received)).toEqual([]);
});

When('the window manager gives focus to the second window without a browser event or frame', async (world: CoreWorld) => {
  const { manager, windowId } = pad(world).second!;
  manager.focus(windowId);
  await settle();
});

Then('the second window receives a live snapshot with the {string} button pressed', (world: CoreWorld, name: string) => {
  const { received } = pad(world).second!;
  expect(snapshot(world, received).focused).toBe(true);
  expect(pressedIn(world, received)).toEqual([`0:${BUTTONS[name]}`]);
});

Then("the applet's controller snapshot is live", (world: CoreWorld) => {
  expect(snapshot(world)['focused']).toBe(true);
});

Then("the applet's controller snapshot is neutral", (world: CoreWorld) => {
  expect(snapshot(world)['focused']).toBe(false);
});

Then("the applet's controller snapshot has the {string} button pressed", (world: CoreWorld, name: string) => {
  expect(pressedIn(world)).toEqual([`0:${BUTTONS[name] as number}`]);
});

Then("the applet's controller snapshot has no button pressed", (world: CoreWorld) => {
  expect(pressedIn(world)).toEqual([]);
});

Then("the applet's controller snapshot carries timestamp 0", (world: CoreWorld) => {
  const pads = (snapshot(world).pads ?? []) as Array<{ timestamp: number } | null>;
  expect(pads.filter((slot) => slot !== null).map((slot) => slot?.timestamp)).toEqual([0]);
});

Then('the plan environment offers {string}', (world: CoreWorld, domain: string) => {
  const plan = k(world).plan;
  if (!plan) throw new Error('plan first');
  expect([...plan.environment.capabilities.domains]).toContain(domain);
});

Then('the plan environment does not offer {string}', (world: CoreWorld, domain: string) => {
  const plan = k(world).plan;
  if (!plan) throw new Error('plan first');
  expect([...plan.environment.capabilities.domains]).not.toContain(domain);
});
