import { combineLatest } from 'rxjs';
import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { ASK_KINDS, type Ask, type AskKind } from '@kernlize/kernel/asks';
import { createAskQueue, createAskQueues, createAskRenderers, type AskQueue, type AskQueues } from '@kernlize/ui-model';

interface QueuesWorld {
  queue?: AskQueue<AskKind>;
  queues?: AskQueues;
  answers: Map<string, unknown>;
  controller?: AbortController;
  seen: string[];
}

const state = (world: Partial<QueuesWorld>): QueuesWorld => {
  world.answers ??= new Map();
  world.seen ??= [];
  return world as QueuesWorld;
};

const askOf = (kind: AskKind, windowId: string, signal?: AbortSignal): Ask => ({ kind, windowId, facts: {} as never, defaultText: { title: kind } as never, ...(signal ? { signal } : {}) });

function ask(world: QueuesWorld, kind: AskKind, windowId: string, signal?: AbortSignal): void {
  void (world.queue as AskQueue<AskKind>).enqueue(askOf(kind, windowId, signal)).then((answer) => world.answers.set(windowId, answer));
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

Given('an ask queue for {string}', (world: QueuesWorld) => {
  state(world).queue = createAskQueue();
});

Given('an ask queue for {string} that a UI watches', (world: QueuesWorld) => {
  const queue = createAskQueue<AskKind>();
  state(world).queue = queue;
  queue.current$.subscribe((current) => world.seen.push(current?.windowId ?? 'none'));
});

When('{string} is asked for window {string} and for window {string}', (world: QueuesWorld, kind: AskKind, first: string, second: string) => {
  ask(state(world), kind, first);
  ask(world, kind, second);
});

When('{string} is asked for window {string} and {string} for window {string}', (world: QueuesWorld, firstKind: AskKind, first: string, secondKind: AskKind, second: string) => {
  ask(state(world), firstKind, first);
  ask(world, secondKind, second);
});

When('{string} is asked for window {string} with a signal', (world: QueuesWorld, kind: AskKind, windowId: string) => {
  state(world).controller = new AbortController();
  ask(world, kind, windowId, world.controller?.signal);
});

When('{string} is asked for window {string} with a signal already aborted', (world: QueuesWorld, kind: AskKind, windowId: string) => {
  const controller = new AbortController();
  controller.abort();
  ask(state(world), kind, windowId, controller.signal);
});

When('the kernel withdraws it', (world: QueuesWorld) => {
  world.controller?.abort();
});

When('the person answers yes', async (world: QueuesWorld) => {
  state(world).queue?.answer(true);
  await settle();
});

When('the person answers no', async (world: QueuesWorld) => {
  state(world).queue?.answer(false);
  await settle();
});

When('window {string} is revoked', async (world: QueuesWorld, windowId: string) => {
  world.queue?.dismissWindow(windowId);
  await settle();
});

Then('the queue shows the ask for window {string}, with {int} waiting behind it', (world: QueuesWorld, windowId: string, behind: number) => {
  expect(world.queue?.current()?.windowId).toBe(windowId);
  expect(world.queue?.waiting().length).toBe(behind + 1);
});

Then('the queue shows the {string} ask for window {string}, with {int} waiting behind it', (world: QueuesWorld, kind: string, windowId: string, behind: number) => {
  expect(world.queue?.current()).toMatchObject({ kind, windowId });
  expect(world.queue?.waiting().length).toBe(behind + 1);
});

Then('the queue shows nothing', async (world: QueuesWorld) => {
  await settle();
  expect(world.queue?.current()).toBeUndefined();
  expect(world.queue?.waiting()).toEqual([]);
});

Then('the queue holds no ask for window {string}', (world: QueuesWorld, windowId: string) => {
  expect(world.queue?.forWindow(windowId)).toEqual([]);
});

Then('the ask for window {string} was answered yes', async (world: QueuesWorld, windowId: string) => {
  await settle();
  expect(world.answers.get(windowId)).toBe(true);
});

Then('the ask for window {string} was answered no', async (world: QueuesWorld, windowId: string) => {
  await settle();
  expect(world.answers.get(windowId)).toBe(false);
});

Then('the ask for window {string} was answered with nothing', async (world: QueuesWorld, windowId: string) => {
  await settle();
  expect(world.answers.has(windowId)).toBe(true);
  expect(world.answers.get(windowId)).toBeUndefined();
});

Then('the UI saw the windows in front change {string}', (world: QueuesWorld, seen: string) => {
  expect(world.seen).toEqual(seen.split(','));
});

Given('the ask queues for every kind', (world: QueuesWorld) => {
  state(world).queues = createAskQueues();
});

Then('the renderers made from them draw every kind', (world: QueuesWorld) => {
  expect(Object.keys(createAskRenderers(world.queues as AskQueues)).sort()).toEqual([...ASK_KINDS].sort());
});

Then('the renderers made from only the {string} queue draw only {string}', (world: QueuesWorld, kind: AskKind, drawn: string) => {
  const queues = world.queues as AskQueues;
  expect(Object.keys(createAskRenderers({ [kind]: queues[kind] }))).toEqual([drawn]);
});

When('the {string} renderer is asked for window {string}', (world: QueuesWorld, kind: AskKind, windowId: string) => {
  const renderer = createAskRenderers(world.queues as AskQueues)[kind] as (ask: Ask) => unknown;
  void renderer(askOf(kind, windowId));
});

Then('the {string} queue shows the ask for window {string}', (world: QueuesWorld, kind: AskKind, windowId: string) => {
  expect((world.queues as AskQueues)[kind].current()?.windowId).toBe(windowId);
});

/** A renderer with no framework: the queue's streams become one line of text and two buttons. */
function plainRenderer(queue: AskQueue<AskKind>): { text(): string; press(button: 'Allow' | 'Deny'): void } {
  let text = 'nothing to answer';
  combineLatest([queue.current$, queue.waiting$]).subscribe(([current, waiting]) => {
    text = current ? `${current.kind} for ${current.windowId}${waiting.length > 1 ? ` (${waiting.length - 1} more)` : ''}` : 'nothing to answer';
  });
  return { text: () => text, press: (button) => queue.answer((button === 'Allow') as never) };
}

Given('an ask queue for {string} drawn by a plain text renderer', (world: QueuesWorld) => {
  const queue = createAskQueue<AskKind>();
  state(world).queue = queue;
  Object.assign(world, { plain: plainRenderer(queue) });
});

Then('the plain renderer shows {string}', async (world: QueuesWorld, text: string) => {
  await settle();
  expect((Reflect.get(world, 'plain') as ReturnType<typeof plainRenderer>).text()).toBe(text);
});

When("the plain renderer's {string} is pressed", async (world: QueuesWorld, button: 'Allow' | 'Deny') => {
  (Reflect.get(world, 'plain') as ReturnType<typeof plainRenderer>).press(button);
  await settle();
});
