import { expect } from 'vitest';
import { Given, Then, When, type DataTable } from 'quickpickle';
import { contractName, domainLabel, formatBytes, GROUP_LABELS, grantGroups, grantsToApply, startingChoices, withheldByMessages, WITHHELD_NOTE, type GrantChoices, type GrantGroup, type GrantInput, type GrantState } from '@kernlize/ui-model';

interface GrantsScratch {
  applet: { requires: string[]; optional: string[]; baseline: string[]; granted: string[]; unsafe: string[]; available: string[]; receives?: boolean; others?: string[] };
  /** What the person has switched; made on first use from the applet as given so far. */
  choices?: GrantChoices;
  groups: GrantGroup[];
}

interface WordsWorld {
  grants?: GrantsScratch;
}

function words(world: WordsWorld): GrantsScratch {
  world.grants ??= { applet: { requires: [], optional: [], baseline: [], granted: [], unsafe: [], available: [] }, groups: [] };
  return world.grants;
}

const list = (value: string): string[] => value.split(',').map((item) => item.trim()).filter(Boolean);

const input = (world: WordsWorld): GrantInput => words(world).applet;
const standing = (world: WordsWorld): GrantState => ({ granted: words(world).applet.granted, unsafe: words(world).applet.unsafe });
const choicesOf = (world: WordsWorld, force = true): GrantChoices => (words(world).choices ??= startingChoices(input(world), standing(world), force));

Then('the shell calls the domain {string} {string}', (_world: WordsWorld, domain: string, label: string) => {
  expect(domainLabel(domain)).toBe(label);
});

Then('the shell writes the contract of {string} as {string}', (_world: WordsWorld, domain: string, contract: string) => {
  expect(contractName(domain)).toBe(contract);
});

Given('an applet that requires {string} and may use {string}', (world: WordsWorld, requires: string, optional: string) => {
  Object.assign(words(world).applet, { requires: list(requires), optional: list(optional) });
  // A new applet starts from its own switches.
  delete words(world).choices;
});

Given('the shell baseline is {string}', (world: WordsWorld, baseline: string) => {
  words(world).applet.baseline = list(baseline);
});

Given('the shell can offer {string}', (world: WordsWorld, available: string) => {
  words(world).applet.available = list(available);
});

Given('the applet was earlier granted {string}', (world: WordsWorld, granted: string) => {
  words(world).applet.granted = list(granted);
});

Given('the applet was earlier kept {string} beside messages', (world: WordsWorld, kept: string) => {
  words(world).applet.unsafe = list(kept);
});

Given('the applet takes requests from other applets', (world: WordsWorld) => {
  words(world).applet.receives = true;
});

Given('the screen also offers {string}', (world: WordsWorld, others: string) => {
  words(world).applet.others = list(others);
});

When('the shell groups the grants for a first review', (world: WordsWorld) => {
  words(world).groups = grantGroups(input(world), choicesOf(world));
});

When('the shell groups the grants for a running applet', (world: WordsWorld) => {
  words(world).groups = grantGroups(input(world), choicesOf(world, false));
});

Given('the person switches on {string}', (world: WordsWorld, domain: string) => {
  choicesOf(world).on.add(domain);
});

Given('the person switches off {string}', (world: WordsWorld, domain: string) => {
  choicesOf(world).on.delete(domain);
});

Given('the person keeps {string} beside messages', (world: WordsWorld, domain: string) => {
  choicesOf(world).kept.add(domain);
});

Given('the person keeps nothing beside messages', (world: WordsWorld) => {
  choicesOf(world).kept.clear();
});

Then('the grant groups are:', (world: WordsWorld, table: DataTable) => {
  const shown = words(world).groups.flatMap((group) => group.rows.map((row) => ({ group: group.id, domain: row.domain, label: row.label, on: row.on ? 'yes' : 'no', locked: row.locked ? 'yes' : 'no', note: row.note })));
  expect(shown).toEqual(table.hashes());
});

Then('the grant group captions are {string}', (_world: WordsWorld, captions: string) => {
  expect(Object.entries(GROUP_LABELS).map(([id, label]) => `${id}: ${label}`).join(', ')).toBe(captions);
});

Then('the grants to apply are {string}', (world: WordsWorld, expected: string) => {
  const ops = grantsToApply(input(world), choicesOf(world), standing(world)).map((op) => `${op.kind} ${op.domain}${op.unsafe === undefined ? '' : op.unsafe ? ' beside messages' : ' outside messages'}`);
  expect(ops.join(', ')).toBe(expected);
});

Then('the shell shows {float} bytes as {string}', (_world: WordsWorld, bytes: number, text: string) => {
  expect(formatBytes(bytes)).toBe(text);
});

Then('with {string} switched on, these are withheld and say {string}:', (_world: WordsWorld, on: string, note: string, table: DataTable) => {
  for (const domain of table.raw().flat()) expect(withheldByMessages(domain, on.split(',')), domain).toBe(true);
  expect(WITHHELD_NOTE).toBe(note);
});

Then('with {string} switched on, these stay:', (_world: WordsWorld, on: string, table: DataTable) => {
  for (const domain of table.raw().flat()) expect(withheldByMessages(domain, on.split(',')), domain).toBe(false);
});

Then('with {string} switched on, nothing is withheld from {string}', (_world: WordsWorld, on: string, domains: string) => {
  for (const domain of domains.split(',')) expect(withheldByMessages(domain, on.split(',')), domain).toBe(false);
});
