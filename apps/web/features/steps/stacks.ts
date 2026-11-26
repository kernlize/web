import { expect } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import { firstValueFrom } from 'rxjs';
import listing from '@kernlize/applet-samples/samples.json';
import { createThrowawayIdentity } from '@kernlize/core';
import type { AppletPointer, AppletStack, AppletSummary, Booted, KernlHost, MountPlan, StorageLike } from '../../src/shell/contract.ts';
import { boot } from '../../src/shell/boot.ts';
import { PREVIEW_STORAGE_PREFIX, scopedStorage } from '../../src/shell/host.ts';
import { installStack, missedWords, openStack as openStackMembers, resolveStack, type StackOpening } from '../../src/shell/stack-opening.ts';
import { applyStackGrants, stackGrantGroups, changeStackGrant, openReviewedMember, type StackChoices, stackMembers, startingStackChoices, type StackGrantMember } from '../../src/shell/stack-grants.ts';
import { createFakeFrame } from '../../../../packages/core/features/steps/world.ts';

// The preview as the page boots it (D-070): the real kernel and modules over relays in the page,
// with the samples and their stacks as the build signed them. Nothing here is a stand-in.
interface PreviewWorld {
  stacksPreview?: { booted: Booted; samples: ReadonlyMap<string, AppletSummary>; stacks: readonly AppletStack[] };
}

function previewOf(world: PreviewWorld): NonNullable<PreviewWorld['stacksPreview']> {
  if (!world.stacksPreview) throw new Error('boot the preview first');
  return world.stacksPreview;
}

function preview(world: PreviewWorld): { kernl: Booted['kernl'] } {
  return { kernl: previewOf(world).booted.kernl };
}

let current: PreviewWorld | undefined;

/** A sample applet, resolved and verified by the real kernel when the preview booted. */
function sample(name: string): AppletSummary {
  const summary = current && previewOf(current).samples.get(name);
  if (!summary) throw new Error(`no sample ${name}`);
  return summary;
}

function memoryStorage(): StorageLike {
  const written = new Map<string, string>();
  return { getItem: (key) => written.get(key) ?? null, setItem: (key, value) => void written.set(key, value), removeItem: (key) => void written.delete(key) };
}

Given('the preview, with the stacks its samples ship', async (world: PreviewWorld) => {
  const host: KernlHost = {
    storage: scopedStorage(memoryStorage(), PREVIEW_STORAGE_PREFIX),
    notify: () => undefined,
    openLink: () => undefined,
    getVisibility: () => ({ visible: true, focused: true }),
    onRevoked: () => undefined,
  };
  const booted = await boot(host, new URLSearchParams('preview=1'));
  await booted.kernl.login(createThrowawayIdentity('Preview identity'));
  const samples = new Map<string, AppletSummary>();
  for (const { name } of listing.samples) samples.set(name, await booted.kernl.resolve(booted.kernl.decodePointer(`35129:${listing.publisher}:${name}`)));
  world.stacksPreview = { booted, samples, stacks: await booted.kernl.stacks.load() };
  current = world;
});

After((world: PreviewWorld) => {
  world.stacksPreview?.booted.kernl.destroy();
  if (current === world) current = undefined;
});

interface StackScratch {
  /** The stacks a scenario asked the orchestrator for. */
  listed?: readonly AppletStack[];
  /** A stack a scenario rewrote, in place of the sample of the same name. */
  override?: AppletStack;
  /** A stack built by hand for the permission table, when no preview sample fits. */
  built?: readonly AppletSummary[];
  /** What opening a stack produced, and what the shell says about it. */
  opening?: StackOpening;
  /** The plans the shell made while opening, in order. */
  plans: MountPlan[];
  /** A stack of applets built only to count admissions, and what its members did. */
  fresh?: readonly AppletSummary[];
  failFirst?: boolean;
  /** A member reviewed on its own, as the desktop does: the window it was reopened over, and what the review did. */
  review?: { running?: MountPlan; reused: boolean; heldDuring: boolean; replacement?: MountPlan; error?: Error };
  mounted: string[];
  waiting: number;
  mostWaiting: number;
  existing?: MountPlan;
  words?: string | undefined;
  /** The relay hints each resolution asked for. */
  relays: string[][];
  /** The stack's applets, as the grants screen sees them. */
  members?: readonly StackGrantMember[];
  choices?: StackChoices;
  /** What was written for each applet, in the order it was written. */
  written: { kind: 'allow' | 'revoke'; domain: string; title: string; unsafe?: boolean }[];
}

const scratchByWorld = new WeakMap<PreviewWorld, StackScratch>();

function scratchOf(world: PreviewWorld): StackScratch {
  const existing = scratchByWorld.get(world);
  if (existing) return existing;
  const created: StackScratch = { relays: [], written: [], plans: [], mounted: [], waiting: 0, mostWaiting: 0 };
  scratchByWorld.set(world, created);
  return created;
}

function sampleStack(identifier: string): AppletStack {
  const stack = (current ? previewOf(current).stacks : []).find((candidate) => candidate.identifier === identifier);
  if (!stack) throw new Error(`no preview stack ${identifier}`);
  return stack;
}

function stackOf(world: PreviewWorld, identifier: string): AppletStack {
  const overridden = scratchOf(world).override;
  return overridden && overridden.identifier === identifier ? overridden : sampleStack(identifier);
}

function withMembers(world: PreviewWorld, identifier: string, members: AppletStack['members']): void {
  scratchOf(world).override = { ...sampleStack(identifier), members };
}

function ghostOf(stack: AppletStack, name: string): AppletStack['members'][number] {
  return { ref: `35129:${stack.publisher}:${name}`, catalogId: `nip5d:35129:${stack.publisher}:${name}`, pubkey: stack.publisher, identifier: name, eventKind: 35129, relays: [], start: false };
}

/** Record what the shell writes, so a scenario can read it back without inspecting the grant records. */
function watchGrants(world: PreviewWorld): void {
  const kernl = preview(world).kernl;
  const allow = kernl.grants.allowDomain.bind(kernl.grants);
  const revoke = kernl.grants.revokeDomain.bind(kernl.grants);
  kernl.grants.allowDomain = (identity, domain, options) => {
    scratchOf(world).written.push({ kind: 'allow', domain, title: titleOf(world, identity.dTag), ...(options?.unsafe === undefined ? {} : { unsafe: options.unsafe }) });
    allow(identity, domain, options);
  };
  kernl.grants.revokeDomain = (identity, domain, options) => {
    scratchOf(world).written.push({ kind: 'revoke', domain, title: titleOf(world, identity.dTag), ...(options?.unsafe === undefined ? {} : { unsafe: options.unsafe }) });
    revoke(identity, domain, options);
  };
}

/** A preview applet's title from its `d` tag, as the shell would show it. */
function titleOf(world: PreviewWorld, dTag: string): string {
  const match = (scratchOf(world).members ?? []).find((member) => member.summary.identity.dTag === dTag);
  return match?.summary.title ?? dTag;
}

/** Resolve the stack's applets and build the grants screen, without planning or opening anything. */
async function ask(world: PreviewWorld, stack: AppletStack): Promise<void> {
  const kernl = preview(world).kernl;
  watchGrants(world);
  const built = scratchOf(world).built;
  const found = built ?? (await resolveStack(kernl, stack)).found;
  const members = stackMembers(kernl, found);
  scratchOf(world).members = members;
  scratchOf(world).choices = startingStackChoices(members);
}

function membersOf(world: PreviewWorld): readonly StackGrantMember[] {
  const members = scratchOf(world).members;
  if (!members) throw new Error('no stack on screen');
  return members;
}

function choiceSet(world: PreviewWorld): StackChoices {
  const choices = scratchOf(world).choices;
  if (!choices) throw new Error('no stack on screen');
  return choices;
}

When('the preview lists its stacks', async (world: PreviewWorld) => {
  scratchOf(world).listed = await preview(world).kernl.stacks.load();
});

When('the preview streams its stacks', async (world: PreviewWorld) => {
  scratchOf(world).listed = await firstValueFrom(preview(world).kernl.stacks.stream());
});

Then('the preview stacks are {string}', (world: PreviewWorld, names: string) => {
  expect(scratchOf(world).listed?.map((stack) => stack.identifier)).toEqual(names.split(','));
});

Given('the preview stack {string} names an applet the preview does not have', (world: PreviewWorld, identifier: string) => {
  const stack = sampleStack(identifier);
  withMembers(world, identifier, [...stack.members.slice(0, 1), ghostOf(stack, 'ghost')]);
});

Given('the preview stack {string} names only applets the preview does not have', (world: PreviewWorld, identifier: string) => {
  const stack = sampleStack(identifier);
  withMembers(world, identifier, [ghostOf(stack, 'ghost-one'), ghostOf(stack, 'ghost-two')]);
});

Given('the preview stack {string} carries a relay hint', (world: PreviewWorld, identifier: string) => {
  const kernl = preview(world).kernl;
  const original = kernl.resolve.bind(kernl);
  kernl.resolve = async (pointer: AppletPointer) => {
    scratchOf(world).relays.push([...pointer.relays]);
    return original(pointer);
  };
  expect(stackOf(world, identifier).members.some((member) => member.relays.length > 0)).toBe(true);
});

Given('the preview applet {string} keeps {string} beside messages', (world: PreviewWorld, name: string, domain: string) => {
  const summary = sample(name);
  preview(world).kernl.grants.allowDomain(summary.identity, domain, { remember: true, unsafe: true });
});

Given('the preview applet {string} cannot be opened', (world: PreviewWorld, name: string) => {
  preview(world).kernl.grants.block(sample(name).identity);
});

Given('the preview applet {string} already holds {string}', async (world: PreviewWorld, name: string, domains: string) => {
  const kernl = preview(world).kernl;
  const summary = sample(name);
  for (const domain of domains.split(',').map((entry) => entry.trim())) kernl.grants.allowDomain(summary.identity, domain, { remember: true });
});

/** Put a hand-built stack on screen, with the domains a scenario says the person switched. */
function build(world: PreviewWorld, summaries: readonly AppletSummary[], on: readonly string[]): void {
  watchGrants(world);
  const members = stackMembers(preview(world).kernl, summaries);
  scratchOf(world).built = summaries;
  scratchOf(world).members = members;
  scratchOf(world).choices = members.map(() => ({ on: new Set(on), kept: new Set() }));
}

Given('a preview stack of an applet that reads messages and needs links', (world: PreviewWorld) => {
  build(world, [{ ...sample('notes'), requires: ['dm', 'link'], optional: [] }], ['dm']);
});

Given('a preview stack of applets that ask for nothing', (world: PreviewWorld) => {
  build(world, [{ ...sample('notes'), requires: [], optional: [] }], []);
});

When('the shell looks up the preview stack {string}', async (world: PreviewWorld, identifier: string) => {
  const stack = stackOf(world, identifier);
  const lookup = await resolveStack(preview(world).kernl, stack);
  scratchOf(world).members = stackMembers(preview(world).kernl, lookup.found);
  scratchOf(world).opening = { opened: 0, missed: lookup.missed };
});

When('the shell opens the preview stack {string}', async (world: PreviewWorld, identifier: string) => {
  await openStack(world, stackOf(world, identifier), 'all');
});

When('the shell opens the applets the preview stack {string} starts with', async (world: PreviewWorld, identifier: string) => {
  await openStack(world, stackOf(world, identifier), 'start');
});

/** Install every applet of a stack, then plan only the ones a scenario asked to open. */
async function openStack(world: PreviewWorld, stack: AppletStack, which: 'all' | 'start'): Promise<void> {
  const kernl = preview(world).kernl;
  const lookup = await resolveStack(kernl, stack);
  installStack(kernl, lookup.found);
  const marked = stack.members.filter((member) => member.start).map((member) => member.catalogId);
  const ticked = which === 'all' || marked.length === 0 ? lookup.found : lookup.found.filter((entry) => marked.includes(entry.manifest.catalogId));
  const scratch = scratchOf(world);
  const planned = await openStackMembers(ticked, async (summary) => {
    scratch.plans.push(await kernl.plan(summary));
  });
  const opening = { opened: planned.opened, missed: planned.missed + lookup.missed };
  scratchOf(world).opening = opening;
  scratchOf(world).words = missedWords(opening, stack);
}

When('the shell installs the preview stack {string} without opening anything', async (world: PreviewWorld, identifier: string) => {
  const kernl = preview(world).kernl;
  const lookup = await resolveStack(kernl, stackOf(world, identifier));
  installStack(kernl, lookup.found);
  scratchOf(world).opening = { opened: 0, missed: lookup.missed };
});

When('the shell opens a preview applet for another applet', async (world: PreviewWorld) => {
  const kernl = preview(world).kernl;
  const found = await kernl.resolve(kernl.decodePointer(`35129:${listing.publisher}:notes`));
  watchGrants(world);
  scratchOf(world).plans.push(await kernl.plan(found));
  scratchOf(world).opening = { opened: 1, missed: 0 };
});

Then('the shell wrote no new grants', (world: PreviewWorld) => {
  expect(scratchOf(world).written).toEqual([]);
});

Then('the shell installed {int} applets', (world: PreviewWorld, count: number) => {
  expect(preview(world).kernl.intents.installed()).toHaveLength(count);
});

Then('the shell installed {string}', (world: PreviewWorld, titles: string) => {
  const installed = preview(world).kernl.intents.installed().map((applet) => applet.title.toLowerCase()).sort();
  expect(installed).toEqual(titles.split(',').map((title) => title.trim()).sort());
});

When('the shell asks for the preview stack {string}', async (world: PreviewWorld, identifier: string) => {
  await ask(world, stackOf(world, identifier));
});

/** Flip one permission for the whole stack, then write what that comes to. A row kept beside messages is the person's exception, so it moves in `kept`. */
function flip(world: PreviewWorld, domain: string, on: boolean): void {
  const choices = choiceSet(world);
  const unsafe = stackGrantGroups(membersOf(world), choices).some((group) => group.id === 'unsafe' && group.rows.some((row) => row.domain === domain));
  const flipped = changeStackGrant(membersOf(world), choices, unsafe ? 'unsafe' : 'optional', domain, on);
  scratchOf(world).choices = flipped;
  applyStackGrants(preview(world).kernl, membersOf(world), flipped, true);
}

When('the shell confirms the stack', (world: PreviewWorld) => {
  applyStackGrants(preview(world).kernl, membersOf(world), choiceSet(world), true);
});

When('the shell switches the permission {string} on', (world: PreviewWorld, domain: string) => {
  flip(world, domain, true);
});

When('the shell switches the permission {string} off', (world: PreviewWorld, domain: string) => {
  flip(world, domain, false);
});

Then('the shell found {int} applets in order', (world: PreviewWorld, count: number) => {
  const members = membersOf(world);
  expect(members).toHaveLength(count);
  expect(members.map((member) => member.summary.title)).toEqual(['Notes', 'Profiles']);
});

Then('the shell has not planned anything', (world: PreviewWorld) => {
  expect(scratchOf(world).plans).toEqual([]);
});

Then('the shell planned {int} applet', (world: PreviewWorld, count: number) => {
  expect(scratchOf(world).plans).toHaveLength(count);
});

Then('the shell planned {int} applets in order', (world: PreviewWorld, count: number) => {
  const plans = scratchOf(world).plans;
  expect(plans).toHaveLength(count);
  expect(plans.map((plan) => plan.summary.title)).toEqual(['Notes', 'Profiles']);
});

Then('the shell says nothing went missing', (world: PreviewWorld) => {
  expect(scratchOf(world).words).toBeUndefined();
});

Then('the shell says {string}', (world: PreviewWorld, words: string) => {
  expect(scratchOf(world).words).toBe(words);
});

Then("the shell asked for the stack member's relay hint", (world: PreviewWorld) => {
  expect(scratchOf(world).relays).toEqual([['wss://relay.example']]);
});

Then('the permission row {string} names {string}', (world: PreviewWorld, domain: string, names: string) => {
  const row = rowsOf(world).find((candidate) => candidate.domain === domain);
  expect(row?.applets.map((applet) => (applet.required ? `${applet.title} (needed)` : applet.title)).join(', ')).toBe(names);
});

Then('the permission row {string} is on and fixed', (world: PreviewWorld, domain: string) => {
  const row = rowsOf(world).find((candidate) => candidate.domain === domain);
  expect({ on: row?.on, locked: row?.locked }).toEqual({ on: true, locked: true });
});

Then('the permission row {string} is off and free', (world: PreviewWorld, domain: string) => {
  const row = rowsOf(world).find((candidate) => candidate.domain === domain);
  expect({ on: row?.on, locked: row?.locked }).toEqual({ on: false, locked: false });
});

Then('the shell grants {string} to {string}', (world: PreviewWorld, domain: string, titles: string) => {
  const written = scratchOf(world).written.filter((entry) => entry.kind === 'allow' && entry.domain === domain && entry.unsafe !== true);
  expect(written.map((entry) => entry.title.toLowerCase()).sort()).toEqual(titles.split(',').map((title) => title.trim()).sort());
});

Then('the shell grants {string} beside messages to {string}', (world: PreviewWorld, domain: string, title: string) => {
  const written = scratchOf(world).written.filter((entry) => entry.kind === 'allow' && entry.domain === domain);
  expect(written).toEqual([{ kind: 'allow', domain, title, unsafe: true }]);
});

Then('the shell takes {string} back from {string}', (world: PreviewWorld, domain: string, titles: string) => {
  const written = scratchOf(world).written.filter((entry) => entry.kind === 'revoke' && entry.domain === domain);
  expect(written.map((entry) => entry.title.toLowerCase()).sort()).toEqual(titles.split(',').map((title) => title.trim()).sort());
});

Then('the stack has no permission rows', (world: PreviewWorld) => {
  expect(rowsOf(world)).toEqual([]);
});

Then('an empty stack asks for nothing', () => {
  expect(stackGrantGroups([], [])).toEqual([]);
});

Then('the stack keeps {string} beside messages', (world: PreviewWorld, domain: string) => {
  expect(choiceSet(world).map((choice) => choice.kept.has(domain))).toEqual([true, false]);
});

function rowsOf(world: PreviewWorld): readonly { domain: string; on: boolean; locked: boolean; applets: readonly { title: string; required: boolean }[] }[] {
  return stackGrantGroups(membersOf(world), choiceSet(world)).flatMap((group) => group.rows);
}

Then('the shell has not written {string}', (world: PreviewWorld, domain: string) => {
  expect(scratchOf(world).written.filter((entry) => entry.domain === domain)).toEqual([]);
});

When('the shell opens an already running preview stack member', async (world: PreviewWorld) => {
  const kernl = preview(world).kernl;
  const { found } = await resolveStack(kernl, sampleStack('basics'));
  const existing = await kernl.plan(found[0]!);
  scratchOf(world).existing = existing;
  const scratch = scratchOf(world);
  scratch.opening = await openStackMembers(found, async (summary) => {
    scratch.plans.push(summary === existing.summary ? existing : await kernl.plan(summary));
  });
});

Then('the opening reused its original plan', (world: PreviewWorld) => {
  expect(scratchOf(world).plans[0]).toBe(scratchOf(world).existing);
});

/** Start an applet's window the way the desktop does, optionally after the stack's own grants were written. */
async function startRunning(world: PreviewWorld, name: string, underStackGrants: boolean): Promise<void> {
  const kernl = preview(world).kernl;
  if (underStackGrants) {
    const members = stackMembers(kernl, [sample(name)]);
    applyStackGrants(kernl, members, startingStackChoices(members), true);
  }
  const running = await kernl.plan(sample(name));
  kernl.mount(running, createFakeFrame());
  scratchOf(world).review = { running, reused: false, heldDuring: false };
}

Given('the preview applet {string} is running under the grants its stack offers', (world: PreviewWorld, name: string) => startRunning(world, name, true));

Given('the preview applet {string} is running without its optional permissions', (world: PreviewWorld, name: string) => startRunning(world, name, false));

/**
 * Confirm one applet of a stack as the desktop does: write the member's choices inside its
 * review, reuse the running window when the grants still start it the same way, otherwise
 * plan its replacement. `fail` ends the review the way a refused mount does.
 */
async function confirmMember(world: PreviewWorld, name: string, remember: boolean, fail: boolean): Promise<void> {
  const kernl = preview(world).kernl;
  const scratch = scratchOf(world);
  const review = scratch.review ?? { reused: false, heldDuring: false };
  scratch.review = review;
  const members = stackMembers(kernl, [sample(name)]);
  const choices = startingStackChoices(members);
  try {
    await openReviewedMember(kernl, members[0]!, choices[0]!, remember, async (start) => {
      review.heldDuring = kernl.grants.get(members[0]!.summary.identity)?.temporary ?? false;
      if (review.running && start.canReuse(review.running)) {
        review.reused = true;
        return;
      }
      review.replacement = await start.plan();
      if (fail) throw new Error('denied:admission-expired');
    });
  } catch (reason) {
    review.error = reason as Error;
  }
}

When('the shell confirms {string} from its stack', (world: PreviewWorld, name: string) => confirmMember(world, name, true, false));

When('the shell confirms {string} from its stack for now, and its replacement cannot mount', (world: PreviewWorld, name: string) => confirmMember(world, name, false, true));

Then('the stack window is reused and nothing new is planned', (world: PreviewWorld) => {
  const review = scratchOf(world).review;
  expect({ reused: review?.reused, replacement: review?.replacement }).toEqual({ reused: true, replacement: undefined });
});

Then('the stack window is not reused and its replacement is planned', (world: PreviewWorld) => {
  const review = scratchOf(world).review;
  expect(review?.reused).toBe(false);
  expect(review?.replacement?.windowId).not.toBe(review?.running?.windowId);
  expect(review?.error).toBeUndefined();
});

Then('the review fails with {string}', (world: PreviewWorld, reason: string) => {
  expect(scratchOf(world).review?.error?.message).toBe(reason);
});

Then('{string} is no longer granted for now', (world: PreviewWorld, name: string) => {
  expect(preview(world).kernl.grants.get(sample(name).identity)?.temporary ?? false).toBe(false);
});

Then('the grants were held for now while the replacement was reviewed', (world: PreviewWorld) => {
  expect(scratchOf(world).review?.heldDuring).toBe(true);
});

Given('a stack of {int} fresh applets', (world: PreviewWorld, count: number) => {
  scratchOf(world).fresh = Array.from({ length: count }, (_, index) => ({ ...sample('notes'), title: `Applet ${index + 1}` }));
});

Given('the first applet cannot mount', (world: PreviewWorld) => {
  scratchOf(world).failFirst = true;
});

When('the person opens its applets', async (world: PreviewWorld) => {
  const scratch = scratchOf(world);
  const fresh = scratch.fresh ?? [];
  scratch.opening = await openStackMembers(fresh, async (summary) => {
    scratch.waiting += 1;
    scratch.mostWaiting = Math.max(scratch.mostWaiting, scratch.waiting);
    await Promise.resolve();
    scratch.waiting -= 1;
    if (scratch.failFirst && summary === fresh[0]) throw new Error('denied:admission-expired');
    scratch.mounted.push(summary.title);
  });
  const stack = { ...sampleStack('basics'), title: 'Large stack', members: fresh.map(() => sampleStack('basics').members[0]!) };
  scratch.words = missedWords(scratch.opening, stack);
});

Then('all {int} applets open in stack order without leaving another admission waiting', (world: PreviewWorld, count: number) => {
  const scratch = scratchOf(world);
  expect(scratch.mounted).toEqual(Array.from({ length: count }, (_, index) => `Applet ${index + 1}`));
  expect(scratch.mostWaiting).toBe(1);
});

Then('the other {int} applets open in stack order', (world: PreviewWorld, count: number) => {
  expect(scratchOf(world).mounted).toEqual(Array.from({ length: count }, (_, index) => `Applet ${index + 2}`));
});
