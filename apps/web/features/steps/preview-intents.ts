import { expect, vi } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { MemoryStorage } from '../../../../packages/core/features/steps/world.ts';
import type { KernlHost } from '../../src/shell/contract.ts';
import { PREVIEW_CATALOG, sampleSummary } from '../../src/shell/preview-applet.ts';
import { createPreviewIntents, type PreviewIntents } from '../../src/shell/preview-intents.ts';

interface IntentsScratch {
  delivered: string[];
  storage: MemoryStorage;
  host: KernlHost;
  intents: PreviewIntents;
  notices: Array<{ title: string }>;
  heard: string[];
  answer?: { ok: boolean; text: string };
}

interface IntentsWorld {
  previewIntents?: IntentsScratch;
}

const list = (value: string): string[] => value.split(',').map((item) => item.trim()).filter(Boolean);

function make(storage: MemoryStorage, host: KernlHost, delivered?: string[]): PreviewIntents {
  return createPreviewIntents({
    storage,
    host,
    findWindow: () => (delivered ? 'handler-window' : undefined),
    deliver: (_windowId, text) => (delivered ? delivered.push(text) > 0 : false),
    retry: { intervalMs: 1, attempts: 3 },
  });
}

function setUp(world: IntentsWorld, storage: MemoryStorage, delivered?: string[]): void {
  const notices: Array<{ title: string }> = [];
  const host: KernlHost = {
    storage,
    presentConsent: () => undefined,
    notify: (notice) => void notices.push(notice),
    openLink: () => undefined,
    getVisibility: () => ({ visible: true, focused: true }),
    onRevoked: () => undefined,
  };
  const intents = make(storage, host, delivered);
  const scratch: IntentsScratch = { storage, host, intents, notices, heard: [], delivered: delivered ?? [] };
  intents.intents.defaults.changes$.subscribe((archetype) => scratch.heard.push(archetype));
  world.previewIntents = scratch;
}

function state(world: IntentsWorld): IntentsScratch {
  if (!world.previewIntents) throw new Error('make preview intents first');
  return world.previewIntents;
}

const idOf = (title: string): string => PREVIEW_CATALOG.find((entry) => entry.title === title)?.catalogId ?? title;
const titleOf = (id: string): string => PREVIEW_CATALOG.find((entry) => entry.catalogId === id)?.title ?? id;

Given('preview intents over empty storage', (world: IntentsWorld) => setUp(world, new MemoryStorage()));

Given('preview intents whose handler window takes deliveries', (world: IntentsWorld) => setUp(world, new MemoryStorage(), []));

Then('the preview delivered {string}', async (world: IntentsWorld, text: string) => {
  await vi.waitFor(() => expect(state(world).delivered).toEqual([text]));
});

Given('preview intents over empty storage with a bare host', (world: IntentsWorld) => setUp(world, new MemoryStorage()));

Given('preview intents over storage holding {string} for installed and {string} for defaults', (world: IntentsWorld, installed: string, defaults: string) => {
  const storage = new MemoryStorage();
  storage.setItem('kernl:preview:installed:v1', installed);
  storage.setItem('kernl:preview:intent-defaults:v1', defaults);
  setUp(world, storage);
});

When('the preview installs {string} and {string}', (world: IntentsWorld, first: string, second: string) => {
  for (const name of [first, second]) state(world).intents.installed.install(sampleSummary(`preview:${name}`) as NonNullable<ReturnType<typeof sampleSummary>>);
});

When('the preview uninstalls {string}', (world: IntentsWorld, title: string) => {
  state(world).intents.intents.uninstall(idOf(title));
});

When('the preview intents are reloaded', (world: IntentsWorld) => {
  const scratch = state(world);
  scratch.intents = make(scratch.storage, scratch.host);
  scratch.intents.intents.defaults.changes$.subscribe((archetype) => scratch.heard.push(archetype));
});

Then('the preview has installed {string}', (world: IntentsWorld, titles: string) => {
  expect(state(world).intents.intents.installed().map((applet) => applet.title)).toEqual(list(titles));
});

Then('the preview offers {string} for {string}', (world: IntentsWorld, title: string, archetype: string) => {
  const catalog = state(world).intents.installed.catalog();
  expect(catalog.map((entry) => entry.title)).toEqual([title]);
  expect(catalog[0]?.archetypes[archetype]?.contracts).toEqual([{ convention: `napplet:${archetype}/open`, params: ['pubkey'] }]);
});

Then('the preview offers nothing for {string}', (world: IntentsWorld) => {
  expect(state(world).intents.installed.catalog()).toEqual([]);
});

When('the preview remembers {string} for {string}', async (world: IntentsWorld, name: string, archetype: string) => {
  await state(world).intents.intents.defaults.set(archetype, idOf(name.charAt(0).toUpperCase() + name.slice(1)));
});

When('the preview forgets the default for {string}', async (world: IntentsWorld, archetype: string) => {
  await state(world).intents.intents.defaults.set(archetype, undefined);
});

Then('the preview default for {string} is {string}', (world: IntentsWorld, archetype: string, name: string) => {
  expect(titleOf(state(world).intents.intents.defaults.get(archetype) ?? '').toLowerCase()).toBe(name);
});

Then('the preview defaults are {string}', (world: IntentsWorld, expected: string) => {
  const all = state(world).intents.intents.defaults.all();
  expect(Object.entries(all).map(([archetype, id]) => `${archetype}=${titleOf(id).toLowerCase()}`)).toEqual(list(expected));
});

Then('the preview heard default changes {string}', (world: IntentsWorld, archetypes: string) => {
  expect(state(world).heard).toEqual(list(archetypes));
});

Then('the preview cannot share defaults and has none published', async (world: IntentsWorld) => {
  const { defaults } = state(world).intents.intents;
  defaults.setSync(true);
  await defaults.load();
  expect(defaults.sync).toBe(false);
  expect(defaults.synced('profile')).toBeUndefined();
});

When('{string} asks the preview to open a {word} for {string}', async (world: IntentsWorld, title: string, archetype: string, pubkey: string) => {
  state(world).answer = await state(world).intents.invoke({ sender: idOf(title), archetype, action: 'open', payload: { pubkey } });
});

Then('the preview answered {string} with {string}', (world: IntentsWorld, ok: string, text: string) => {
  expect(state(world).answer).toEqual({ ok: ok === 'yes', text });
});

Then('the preview host was told {string}', async (world: IntentsWorld, title: string) => {
  await vi.waitFor(() => expect(state(world).notices).toContainEqual({ title, body: 'It could not be opened.', tone: 'warning' }));
});
