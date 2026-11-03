import { expect } from 'vitest';
import { After, Given, Then, When, type DataTable } from 'quickpickle';
import type { StorageLike } from '../../src/shell/contract.ts';
import { cascade, clampRect, dwindle, type Rect } from '../../src/shell/layout.ts';
import { forgetRecent, readRecent, rememberRecent, type RecentApplet } from '../../src/shell/recent.ts';
import { trapFocus } from '../../src/shell/focus-trap.ts';

/** Presents a fake as the DOM type the code under test expects; the fakes implement only what is touched. */
const asDom = <T>(fake: unknown): T => fake as T;

/** Stands in for the DOM the focus trap touches: focus, visibility, containment and keydown listeners. */
class FakeElement {
  hidden = false;
  readonly children: FakeElement[] = [];
  private readonly listeners = new Set<(event: KeyboardEvent) => void>();

  constructor(
    readonly name: string,
    private readonly page: FakePage,
  ) {}

  get offsetParent(): object | null {
    return this.hidden ? null : {};
  }

  focus(): void {
    this.page.activeElement = this;
  }

  querySelectorAll(): FakeElement[] {
    return this.children;
  }

  contains(other: unknown): boolean {
    return other === this || this.children.includes(other as FakeElement);
  }

  addEventListener(_type: string, listener: (event: KeyboardEvent) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: (event: KeyboardEvent) => void): void {
    this.listeners.delete(listener);
  }

  dispatch(event: KeyboardEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  get listening(): boolean {
    return this.listeners.size > 0;
  }
}

interface FakePage {
  activeElement: FakeElement | null;
}

interface FakeKey {
  key: string;
  shiftKey: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
}

class MapStorage implements StorageLike {
  readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

interface WindowsScratch {
  desktop: Rect;
  tiles: Rect[];
  placed?: Rect;
  storage: MapStorage;
  recent: RecentApplet[];
  page: FakePage;
  opener: FakeElement;
  dialog: FakeElement;
  release?: () => void;
  key?: FakeKey;
  restore?: () => void;
}

interface WindowsWorld {
  shellWindows?: WindowsScratch;
}

function windows(world: WindowsWorld): WindowsScratch {
  if (!world.shellWindows) {
    const page: FakePage = { activeElement: null };
    world.shellWindows = {
      desktop: { x: 0, y: 0, width: 0, height: 0 },
      tiles: [],
      storage: new MapStorage(),
      recent: [],
      page,
      opener: new FakeElement('the opener', page),
      dialog: new FakeElement('the dialog', page),
    };
  }
  return world.shellWindows;
}

After(async (world: WindowsWorld) => {
  world.shellWindows?.restore?.();
});

Given('a shell desktop of {int} by {int} at {int},{int}', (world: WindowsWorld, width: number, height: number, x: number, y: number) => {
  windows(world).desktop = { x, y, width, height };
});

When('the shell tiles {int} windows', (world: WindowsWorld, count: number) => {
  windows(world).tiles = dwindle(windows(world).desktop, count);
});

const rects = (table: DataTable): Rect[] => table.hashes().map((row) => ({ x: Number(row.x), y: Number(row.y), width: Number(row.width), height: Number(row.height) }));

Then('the shell tiles are:', (world: WindowsWorld, table: DataTable) => {
  expect(windows(world).tiles).toEqual(rects(table));
});

Then('the shell makes no tiles', (world: WindowsWorld) => {
  expect(windows(world).tiles).toEqual([]);
});

Given('a shell window at {int},{int} sized {int} by {int}', (world: WindowsWorld, x: number, y: number, width: number, height: number) => {
  windows(world).placed = { x, y, width, height };
});

When('the shell keeps the window on the desktop', (world: WindowsWorld) => {
  windows(world).placed = clampRect(windows(world).placed as Rect, windows(world).desktop);
});

When('the shell keeps the window on the desktop, at least {int} by {int}', (world: WindowsWorld, minWidth: number, minHeight: number) => {
  windows(world).placed = clampRect(windows(world).placed as Rect, windows(world).desktop, minWidth, minHeight);
});

When('the shell cascades window number {int} sized {int} by {int}', (world: WindowsWorld, index: number, width: number, height: number) => {
  windows(world).placed = cascade(index, windows(world).desktop, { width, height });
});

Then('the shell window sits at {int},{int} sized {int} by {int}', (world: WindowsWorld, x: number, y: number, width: number, height: number) => {
  expect(windows(world).placed).toEqual({ x, y, width, height });
});

Given('the shell has stored the recent list {string}', (world: WindowsWorld, raw: string) => {
  windows(world).storage.setItem('kernl:recent:v1', raw);
});

When('the shell remembers {string} titled {string} from {string} at {int}', (world: WindowsWorld, address: string, title: string, publisher: string, at: number) => {
  windows(world).recent = rememberRecent(windows(world).storage, { address, title, publisher }, at);
});

When('the shell remembers {string} titled {string} from {string} just now', (world: WindowsWorld, address: string, title: string, publisher: string) => {
  windows(world).recent = rememberRecent(windows(world).storage, { address, title, publisher });
});

When('the shell remembers {int} applets one after another', (world: WindowsWorld, count: number) => {
  for (let index = 1; index <= count; index += 1) {
    windows(world).recent = rememberRecent(windows(world).storage, { address: `applet-${index}`, title: `Applet ${index}`, publisher: 'someone' }, index);
  }
});

When('the shell forgets {string}', (world: WindowsWorld, address: string) => {
  windows(world).recent = forgetRecent(windows(world).storage, address);
});

const addresses = (rows: readonly RecentApplet[]): string => rows.map((row) => row.address).join(', ');

Then('the shell recent list is {string}', (world: WindowsWorld, expected: string) => {
  expect(addresses(windows(world).recent)).toBe(expected);
  expect(readRecent(windows(world).storage)).toEqual(windows(world).recent);
});

Then('the shell reads the recent list back as {string}', (world: WindowsWorld, expected: string) => {
  expect(addresses(readRecent(windows(world).storage))).toBe(expected);
});

Then('the shell recent applet {string} was opened at {int}', (world: WindowsWorld, address: string, at: number) => {
  expect(windows(world).recent.find((row) => row.address === address)?.openedAt).toBe(at);
});

Then('the shell recent applet {string} was opened just now', (world: WindowsWorld, address: string) => {
  const openedAt = windows(world).recent.find((row) => row.address === address)?.openedAt ?? 0;
  expect(Math.abs(Date.now() - openedAt)).toBeLessThan(5000);
});

function stubDom(scratch: WindowsScratch): void {
  const globals = globalThis as Record<string, unknown>;
  const saved = { document: globals.document, HTMLElement: globals.HTMLElement };
  globals.document = scratch.page;
  globals.HTMLElement = FakeElement;
  scratch.restore = () => Object.assign(globals, saved);
}

function element(scratch: WindowsScratch, name: string): FakeElement {
  if (name === 'the opener') return scratch.opener;
  if (name === 'the dialog') return scratch.dialog;
  const found = scratch.dialog.children.find((child) => child.name === name);
  if (!found) throw new Error(`no shell dialog control ${name}`);
  return found;
}

Given('a shell dialog with the controls {string}', (world: WindowsWorld, names: string) => {
  const scratch = windows(world);
  stubDom(scratch);
  for (const name of names.split(',').map((item) => item.trim()).filter(Boolean)) scratch.dialog.children.push(new FakeElement(name, scratch.page));
});

Given('the shell dialog control {string} is hidden', (world: WindowsWorld, name: string) => {
  element(windows(world), name).hidden = true;
});

Given('focus rests on the shell opener', (world: WindowsWorld) => {
  windows(world).opener.focus();
});

When('the shell traps focus in the dialog', (world: WindowsWorld) => {
  const scratch = windows(world);
  scratch.release = trapFocus()(asDom<HTMLElement>(scratch.dialog)) as () => void;
});

When('the shell traps focus in the dialog starting at {string}', (world: WindowsWorld, name: string) => {
  const scratch = windows(world);
  const start = name === 'nothing' ? null : asDom<HTMLElement>(element(scratch, name));
  scratch.release = trapFocus(() => start)(asDom<HTMLElement>(scratch.dialog)) as () => void;
});

When('the shell user focuses {string}', (world: WindowsWorld, name: string) => {
  element(windows(world), name).focus();
});

When('the shell user presses {string} in the dialog', (world: WindowsWorld, chord: string) => {
  const key: FakeKey = {
    key: chord.replace('Shift+', ''),
    shiftKey: chord.startsWith('Shift+'),
    defaultPrevented: false,
    preventDefault() {
      key.defaultPrevented = true;
    },
  };
  windows(world).key = key;
  windows(world).dialog.dispatch(asDom<KeyboardEvent>(key));
});

When('the shell releases the dialog', (world: WindowsWorld) => {
  windows(world).release?.();
});

Then('shell focus is on {string}', async (world: WindowsWorld, name: string) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(windows(world).page.activeElement?.name ?? 'nothing').toBe(name);
});

Then('the shell dialog kept the key from the browser', (world: WindowsWorld) => {
  expect(windows(world).key?.defaultPrevented).toBe(true);
});

Then('the shell dialog left the key to the browser', (world: WindowsWorld) => {
  expect(windows(world).key?.defaultPrevented).toBe(false);
});

Then('the shell dialog no longer listens for keys', (world: WindowsWorld) => {
  expect(windows(world).dialog.listening).toBe(false);
});
