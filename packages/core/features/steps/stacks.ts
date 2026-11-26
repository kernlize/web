import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { Observable } from 'rxjs';
import type { NostrEvent, NostrFilter } from '@napplet/core';
import { finalizeEvent } from 'applesauce-core/helpers';
import { PrivateKeySigner } from 'applesauce-signers';
import { boot } from './kernl.js';
import { cacheModule, createMemoryCacheAdapter, stacksModule, createRelayTiers, loadStacks, newestStacks, streamStacks, toAppletStack, type AppletStack } from '@kernlize/core';
import { scratch, splitList, type CoreWorld } from './world.js';

/** The publisher every scripted stack names, unless a step says otherwise. */
const signer = new PrivateKeySigner();
const PUB = 'a1'.repeat(32);
const OTHER = 'b2'.repeat(32);

interface StackScratch {
  events: NostrEvent[];
  stack?: AppletStack | undefined;
  stacks: readonly AppletStack[];
  emissions: (readonly AppletStack[])[];
  stored: NostrEvent[];
  cached: NostrEvent[];
}

function s(world: CoreWorld): StackScratch {
  const store = scratch(world);
  store.stacks ??= { events: [], stacks: [], emissions: [], stored: [], cached: [] } satisfies StackScratch;
  return store.stacks as StackScratch;
}

let serial = 0;

function eventId(): string {
  serial += 1;
  return serial.toString(16).padStart(64, '0');
}

/** One member of a stack, from the shorthand a scenario writes. */
function memberTag(spec: string): string[] {
  const [name = '', hint] = spec.split('@');
  const withHint = (tag: string[]): string[] => (hint === undefined ? tag : [...tag, hint]);
  if (name === 'novalue') return ['a'];
  if (name === 'zapstore') return withHint(['a', `32267:${OTHER}:app`]);
  if (name === 'nokey') return withHint(['a', `35129::nameless`]);
  if (name === 'rootsuffix') return withHint(['a', `15129:${OTHER}:extra`]);
  if (name === 'root:') return withHint(['a', `15129:${PUB}:`]);
  return withHint(['a', `35129:${PUB}:${name}`]);
}

interface StackSpec {
  readonly d: string | undefined;
  readonly title?: string;
  readonly name?: string;
  readonly description?: string;
  readonly kind?: number;
  readonly members: string;
  /** Members the publisher marked as entry points, by the same shorthand as `members`. */
  readonly starts?: string;
  readonly publishedAt?: number;
}

function stackEvent(spec: StackSpec): NostrEvent {
  const tags: string[][] = [];
  if (spec.d !== undefined) tags.push(['d', spec.d]);
  if (spec.title !== undefined) tags.push(['title', spec.title]);
  if (spec.name !== undefined) tags.push(['name', spec.name]);
  if (spec.description !== undefined) tags.push(['description', spec.description]);
  const members = splitList(spec.members);
  for (const member of members) tags.push(memberTag(member));
  for (const start of splitList(spec.starts ?? '')) {
    // A marker may name a coordinate no member holds, or carry no value at all; both are ignored by the parser.
    if (start === 'novalue') tags.push(['start']);
    else if (start === 'stranger') tags.push(['start', `35129:${OTHER}:stranger`]);
    else tags.push(['start', (memberTag(start)[1] as string) ?? '']);
  }
  return finalizeEvent({ kind: spec.kind ?? 30267, created_at: spec.publishedAt ?? 1_700_000_000, tags, content: '' }, signer.key);
}

function lastStack(world: CoreWorld): AppletStack {
  const stack = s(world).stack;
  if (!stack) throw new Error('read a stack first');
  return stack;
}

function memberNamed(world: CoreWorld, words: string): AppletStack['members'][number] {
  const found = lastStack(world).members.find((member) => (words === 'root:' ? member.identifier === '' : member.identifier === words));
  if (!found) throw new Error(`no member named ${words}`);
  return found;
}

Given('a stack {string} titled {string} holding {string}', (world: CoreWorld, d: string, title: string, members: string) => {
  s(world).events = [stackEvent({ d, title, members })];
});

Given('a stack {string} titled {string} holding {string} starting {string}', (world: CoreWorld, d: string, title: string, members: string, starts: string) => {
  s(world).events = [stackEvent({ d, title, members, starts })];
});

Given('a stack {string} titled {string} holding {string} published at {int}', (world: CoreWorld, d: string, title: string, members: string, publishedAt: number) => {
  s(world).events = [...s(world).events, stackEvent({ d, title, members, publishedAt })];
});

Given('a stack {string} named {string} holding {string}', (world: CoreWorld, d: string, name: string, members: string) => {
  s(world).events = [stackEvent({ d, name, members })];
});

Given('a stack {string} titled {string} described {string} holding {string}', (world: CoreWorld, d: string, title: string, description: string, members: string) => {
  s(world).events = [stackEvent({ d, title, description, members })];
});

Given('an untitled stack {string} holding {string}', (world: CoreWorld, d: string, members: string) => {
  s(world).events = [stackEvent({ d, members })];
});

Given('a stack {string} with no identifier holding {string}', (world: CoreWorld, label: string, members: string) => {
  s(world).events = [stackEvent({ d: undefined, title: label, members })];
});

Given('a stack of kind {int} titled {string} holding {string}', (world: CoreWorld, kind: number, title: string, members: string) => {
  s(world).events = [stackEvent({ d: title.toLowerCase(), title, kind, members })];
});

Given('an empty stack {string} published at {int}', (world: CoreWorld, d: string, publishedAt: number) => {
  s(world).events = [...s(world).events, stackEvent({ d, title: 'Gone', members: '', publishedAt })];
});

Given('the stack title was changed after signing', (world: CoreWorld) => {
  const event = s(world).events[0]!;
  s(world).events[0] = { id: event.id, pubkey: event.pubkey, kind: event.kind, created_at: event.created_at, sig: event.sig, content: event.content, tags: [['title', 'Forged'], ...event.tags] };
});

When('the shell reads that stack', (world: CoreWorld) => {
  s(world).stack = toAppletStack(s(world).events[0] as NostrEvent);
});

When('the shell keeps the newest of the stacks', (world: CoreWorld) => {
  const stacks = s(world).events.map((event) => toAppletStack(event)).filter((stack): stack is AppletStack => stack !== undefined);
  s(world).stacks = newestStacks(stacks);
  s(world).stack = s(world).stacks[0];
});

Then('the shell has no stack', (world: CoreWorld) => {
  expect(s(world).stack).toBeUndefined();
});

Then('the stack {string} is titled {string} holding {int}', (world: CoreWorld, d: string, title: string, count: number) => {
  expect(lastStack(world).identifier).toBe(d);
  expect(lastStack(world).title).toBe(title);
  expect(lastStack(world).members).toHaveLength(count);
});

Then('the stack {string} is described {string}', (world: CoreWorld, d: string, description: string) => {
  expect(lastStack(world).identifier).toBe(d);
  expect(lastStack(world).description).toBe(description);
});

Then('the stack {string} names {string}', (world: CoreWorld, d: string, names: string) => {
  expect(lastStack(world).identifier).toBe(d);
  expect(lastStack(world).members.map((member) => (member.identifier === '' ? 'root:' : member.identifier))).toEqual(splitList(names));
});

Then("the applet {string} is a named applet with kehto's catalogue id", (world: CoreWorld, words: string) => {
  const member = memberNamed(world, words);
  expect(member.eventKind).toBe(35129);
  expect(member.catalogId).toBe(`nip5d:35129:${PUB}:${words}`);
});

Then("the applet {string} is a root applet with kehto's catalogue id", (world: CoreWorld, words: string) => {
  const member = memberNamed(world, words);
  expect(member.identifier).toBe('');
  expect(member.eventKind).toBe(15129);
  expect(member.catalogId).toBe(`nip5d:15129:${PUB}`);
});

Then('the stack {string} starts with {string}', (world: CoreWorld, d: string, names: string) => {
  expect(lastStack(world).identifier).toBe(d);
  const starters = lastStack(world).members.filter((member) => member.start).map((member) => (member.identifier === '' ? 'root:' : member.identifier));
  expect(starters).toEqual(splitList(names));
});

Then('the stack {string} starts with nothing', (world: CoreWorld, d: string) => {
  expect(lastStack(world).identifier).toBe(d);
  expect(lastStack(world).members.some((member) => member.start)).toBe(false);
});

Then('the applet {string} carries the relay hint {string}', (world: CoreWorld, words: string, hint: string) => {
  expect(memberNamed(world, words).relays).toEqual([hint]);
});

Then('the shell lists stacks {string}', (world: CoreWorld, ids: string) => {
  expect(s(world).stacks.map((stack) => stack.identifier)).toEqual(splitList(ids));
});

Then('the stack list is empty', (world: CoreWorld) => {
  expect(s(world).stacks).toEqual([]);
});

Given('the fake pool serves stacks {string}', async (world: CoreWorld, specs: string) => {
  s(world).events = splitList(specs).map((spec) => {
    const [d = '', hint] = spec.split('@');
    return stackEvent({ d, title: d, members: hint ? `notes@${hint},ics@${hint}` : 'notes,ics' });
  });
  scratch(world).pool.events = s(world).events;
});

Given('stacks already seen {string}', (world: CoreWorld, specs: string) => {
  s(world).cached = splitList(specs).map((d) => stackEvent({ d, title: d, members: 'notes' }));
});

Given('the fake pool refuses every request', (world: CoreWorld) => {
  scratch(world).pool.failRequests = true;
});

Given('the fake pool serves stacks {string} after {int} ms', (world: CoreWorld, specs: string, delayMs: number) => {
  const events = splitList(specs).map((d) => stackEvent({ d, title: d, members: 'notes' }));
  s(world).events = events;
  const pool = scratch(world).pool;
  pool.request = (() =>
    new Observable<NostrEvent>((observer) => {
      const timer = setTimeout(() => {
        for (const event of events) observer.next(event);
        observer.complete();
      }, delayMs);
      return () => clearTimeout(timer);
    })) as typeof pool.request;
});

When("the stacks load from the shell's relays", async (world: CoreWorld) => {
  const stacks = await loadStacks(scratch(world).pool, createRelayTiers(scratch(world).storage));
  s(world).stacks = stacks;
});

When("the stacks load from the shell's relays limited to {int}", async (world: CoreWorld, limit: number) => {
  s(world).stacks = await loadStacks(scratch(world).pool, createRelayTiers(scratch(world).storage), { limit });
});

When('the stacks stream with that cache', async (world: CoreWorld) => {
  const cached = s(world).cached;
  const stacks = await new Promise<readonly AppletStack[]>((resolve) => {
    let latest: readonly AppletStack[] = [];
    const subscription = streamStacks(scratch(world).pool, createRelayTiers(scratch(world).storage), { cache: async () => cached, emitMs: 1 }).subscribe({
      next: (list) => (latest = list),
      complete: () => resolve(latest),
    });
    subscription.add(() => resolve(latest));
  });
  s(world).stacks = stacks;
});

When('the stacks stream storing what it reads', async (world: CoreWorld) => {
  const store = { add: (event: NostrEvent) => s(world).stored.push(event) };
  await new Promise<void>((resolve) => {
    streamStacks(scratch(world).pool, createRelayTiers(scratch(world).storage), { emitMs: 1, store }).subscribe({ complete: resolve });
  });
});

When('the stacks stream settling after {int} ms', async (world: CoreWorld, settleMs: number) => {
  const emissions = s(world).emissions;
  await new Promise<void>((resolve) => {
    streamStacks(scratch(world).pool, createRelayTiers(scratch(world).storage), { settleMs, emitMs: 1 }).subscribe({
      next: (list) => emissions.push(list),
      complete: () => resolve(),
    });
  });
  s(world).stacks = emissions.at(-1) ?? [];
});

Then('the stacks asked {string} for kind 30267 limited to {int}', (world: CoreWorld, relays: string, limit: number) => {
  const call = scratch(world).pool.calls.find((entry) => entry.method === 'request');
  expect(call?.relays).toEqual(splitList(relays));
  expect(call?.filters).toEqual([{ kinds: [30267], limit } satisfies NostrFilter]);
});

Then("the stacks asked the shell's relays for kind 30267 limited to {int}", (world: CoreWorld, limit: number) => {
  const call = scratch(world).pool.calls.find((entry) => entry.method === 'request');
  expect(call?.filters).toEqual([{ kinds: [30267], limit } satisfies NostrFilter]);
});

Then('the shell listed {string}', (world: CoreWorld, ids: string) => {
  expect(s(world).stacks.map((stack) => stack.identifier).sort()).toEqual(splitList(ids).sort());
});

Then('the stream emitted an empty list first', (world: CoreWorld) => {
  expect(s(world).emissions[0]).toEqual([]);
});

Then('the event cache holds {int} stack event', (world: CoreWorld, count: number) => {
  expect(s(world).stored).toHaveLength(count);
});

/** The composed shell a scenario built, when it built one. */
function shellKernl(world: CoreWorld): import('@kernlize/core').Kernl {
  const built = (scratch(world).kernl as { kernl?: import('@kernlize/core').Kernl } | undefined)?.kernl;
  if (!built) throw new Error('build a kernl shell first');
  return built;
}

Given('the fake pool serves stacks {string} and a note', (world: CoreWorld, specs: string) => {
  const stacks = splitList(specs).map((d) => stackEvent({ d, title: d, members: 'notes' }));
  const note: NostrEvent = { id: eventId(), pubkey: PUB, kind: 1, created_at: 1_700_000_000, tags: [], content: 'hello', sig: '00'.repeat(64) };
  s(world).events = stacks;
  scratch(world).pool.events = [...stacks, note];
});

When('the stacks stream with a cache that cannot be read', async (world: CoreWorld) => {
  const stacks = await new Promise<readonly AppletStack[]>((resolve) => {
    let latest: readonly AppletStack[] = [];
    const subscription = streamStacks(scratch(world).pool, createRelayTiers(scratch(world).storage), {
      cache: async () => {
        throw new Error('cache unavailable');
      },
      emitMs: 1,
    }).subscribe({
      next: (list) => (latest = list),
      complete: () => resolve(latest),
    });
    subscription.add(() => resolve(latest));
  });
  s(world).stacks = stacks;
});

Given('a shell with a cached stack {string} and no published stacks', async (world: CoreWorld, d: string) => {
  const cache = await createMemoryCacheAdapter().open();
  await cache.add([stackEvent({ d, members: 'notes' })]);
  scratch(world).pool.events = [];
  boot(world, { modules: [stacksModule(), cacheModule(async () => cache)] });
});

Then('the shared store holds the stack {string}', (world: CoreWorld, d: string) => {
  expect([...shellKernl(world).eventStore.getByFilters({ kinds: [30267], '#d': [d] })]).toHaveLength(1);
});

When('the shell lists the stacks', async (world: CoreWorld) => {
  s(world).stacks = await shellKernl(world).stacks.load();
});

When('the shell streams the stacks', async (world: CoreWorld) => {
  s(world).stacks = await new Promise<readonly AppletStack[]>((resolve) => {
    let latest: readonly AppletStack[] = [];
    shellKernl(world)
      .stacks.stream({ emitMs: 0 })
      .subscribe({
        next: (list) => (latest = list),
        complete: () => resolve(latest),
      });
  });
});

Then('the shell stack list is {string}', (world: CoreWorld, ids: string) => {
  expect(s(world).stacks.map((stack) => stack.identifier).sort()).toEqual(splitList(ids).sort());
});
