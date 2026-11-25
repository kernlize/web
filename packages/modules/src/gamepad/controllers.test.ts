import { describe, expect, it, vi } from 'vitest';
import type { ServiceRuntimeContext } from '@kehto/runtime';
import { createControllerService } from './controllers.js';

interface FakeButton {
  value: number;
  pressed: boolean;
  touched: boolean;
}

interface FakePad {
  index: number;
  id: string;
  mapping: string;
  connected: true;
  timestamp: number;
  axes: number[];
  buttons: FakeButton[];
}

const pad = (buttons: readonly boolean[]): FakePad => ({
  index: 0,
  id: 'Fake Pad (STANDARD GAMEPAD)',
  mapping: 'standard',
  connected: true,
  timestamp: 1,
  axes: [0, 0, 0, 0],
  buttons: buttons.map((pressed) => ({ value: pressed ? 1 : 0, pressed, touched: pressed })),
});

/** A page with a controller reader, a visibility answer and the frame pump kehto schedules on. */
function fakePage(pads: () => Array<FakePad | null>) {
  const listeners = new Map<string, Set<() => void>>();
  const frames: Array<() => void> = [];
  const listen = (type: string) => () => {
    for (const listener of listeners.get(type) ?? []) listener();
  };
  const target = {
    visibilityState: 'visible' as 'visible' | 'hidden',
    hasFocus: () => true,
    activeElement: null,
    addEventListener: (type: string, listener: () => void) => void listeners.set(type, (listeners.get(type) ?? new Set()).add(listener)),
    removeEventListener: (type: string, listener: () => void) => void listeners.get(type)?.delete(listener),
  };
  const page = {
    document: target,
    navigator: { getGamepads: pads },
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
    cancelAnimationFrame: (frame: number) => void frames.splice(frame, 1),
    addEventListener: (type: string, listener: () => void) => void listeners.set(type, (listeners.get(type) ?? new Set()).add(listener)),
    removeEventListener: (type: string, listener: () => void) => void listeners.get(type)?.delete(listener),
    emit(type: string) {
      listen(type)();
    },
    /** Run what the service scheduled, as the page's frames would. */
    flush() {
      for (let run = 0; run < 20 && frames.length > 0; run += 1) frames.shift()?.();
    },
    target,
  };
  return page;
}

function runtime(sent: Array<{ windowId: string; message: Record<string, unknown> }>): ServiceRuntimeContext {
  return {
    authorizeOperation: (
      _windowId: string,
      _operation: string,
      _requirements: readonly unknown[],
      execute: (signal: never) => unknown,
    ) => Promise.resolve({ status: 'executed', value: execute({ aborted: false } as never) }),
    resolveDTag: () => 'chat',
    listWindows: () => [],
    sendToEligibleNapplet: (windowId: string, message: Record<string, unknown>) => {
      sent.push({ windowId, message });
      return true;
    },
  } as unknown as ServiceRuntimeContext;
}

describe('createControllerService', () => {
  it('is not offered where the host said no, or where the page cannot read a controller', () => {
    expect(createControllerService({ offer: false, focusedWindow: () => null })).toBeUndefined();
    expect(createControllerService({ focusedWindow: () => null })).toBeUndefined();
    const noReader = { document: { addEventListener: () => undefined, removeEventListener: () => undefined }, navigator: {}, addEventListener: () => undefined, removeEventListener: () => undefined };
    expect(createControllerService({ window: noReader as unknown as Window, focusedWindow: () => null })).toBeUndefined();
  });

  it('reads the page it runs in unless the host named another', () => {
    vi.stubGlobal('window', fakePage(() => [pad([])]) as unknown as Window);
    const service = createControllerService({ focusedWindow: () => null });
    vi.unstubAllGlobals();
    expect(service?.descriptor.name).toBe('gamepad');
  });

  it('gives the focused window live values and every other subscriber the neutral snapshot', async () => {
    const presses = { a: true };
    const page = fakePage(() => [pad([presses.a, false, false, false])]);
    let focused = 'w1';
    const service = createControllerService({ window: page as unknown as Window, focusedWindow: () => focused });
    expect(service?.descriptor.name).toBe('gamepad');

    const sent: Array<{ windowId: string; message: Record<string, unknown> }> = [];
    service?.onRegistered?.(runtime(sent));
    service?.handleMessage('w1', { type: 'gamepad.subscribe' }, (message) => void sent.push({ windowId: 'w1', message: message as unknown as Record<string, unknown> }));
    await Promise.resolve();
    page.flush();

    const live = sent.at(-1)?.message;
    expect(live).toMatchObject({ type: 'gamepad.state', available: true, focused: true });
    const pads = live?.pads as Array<{ buttons: FakeButton[] }>;
    expect(pads[0]?.buttons[0]?.pressed).toBe(true);

    focused = 'w2';
    page.emit('focus');
    page.flush();
    const neutral = sent.at(-1)?.message;
    expect(neutral).toMatchObject({ type: 'gamepad.state', focused: false });
    const quiet = neutral?.pads as Array<{ timestamp: number; buttons: FakeButton[] }>;
    expect(quiet[0]?.timestamp).toBe(0);
    expect(quiet[0]?.buttons[0]?.pressed).toBe(false);

    service?.handleMessage('w1', { type: 'gamepad.unsubscribe' }, () => undefined);
    const before = sent.length;
    presses.a = false;
    page.flush();
    expect(sent.length).toBe(before);
  });

  it('says blocked when the runtime refuses the subscription, and stops when the window ends', async () => {
    const page = fakePage(() => [pad([false])]);
    const service = createControllerService({ window: page as unknown as Window, focusedWindow: () => 'w1' });
    const sent: Array<{ windowId: string; message: Record<string, unknown> }> = [];
    service?.onRegistered?.({
      authorizeOperation: () => Promise.resolve({ status: 'denied' }),
      sendToEligibleNapplet: (windowId: string, message: Record<string, unknown>) => {
        sent.push({ windowId, message });
        return true;
      },
    } as unknown as ServiceRuntimeContext);
    service?.handleMessage('w1', { type: 'gamepad.subscribe' }, (message) => void sent.push({ windowId: 'w1', message: message as unknown as Record<string, unknown> }));
    await vi.waitFor(() => expect(sent.at(-1)?.message).toMatchObject({ type: 'gamepad.state', available: false, reason: 'blocked' }));

    service?.onWindowDestroyed?.('w1');
    service?.onUnregistered?.();
    expect(sent.filter((entry) => entry.message['available'] === true)).toHaveLength(0);
  });
});
