import { expect, vi } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { ConfigServiceOptions, ConfigSettingsContext } from '@kehto/services';
import { createAppletConfig, type SettingsPrompt } from '@kernlize/core';
import { blobFetcher, boot, k } from './kernl.js';
import { scratch, type CoreWorld } from './world.js';

interface ConfigScratch {
  config: ConfigServiceOptions;
  shown: SettingsPrompt[];
}

const cfg = (world: CoreWorld): ConfigScratch => scratch(world).config as ConfigScratch;
const CONTEXT = { schema: { type: 'object' }, values: {}, commit: (values) => values } as ConfigSettingsContext;

Given('applet settings for window {string} running {string}', (world: CoreWorld, windowId: string, title: string) => {
  const shown: SettingsPrompt[] = [];
  const config = createAppletConfig({
    storage: scratch(world).storage,
    appletOf: (id) => (id === windowId ? { key: `nip5d:35129:pk:${title}`, title } : undefined),
    present: (prompt) => void shown.push(prompt),
  });
  scratch(world).config = { config, shown } satisfies ConfigScratch;
});

Then('the settings of window {string} are {string}', (world: CoreWorld, windowId: string, json: string) => {
  expect(cfg(world).config.getValues(windowId)).toEqual(JSON.parse(json));
});

When('the shell saves {string} for window {string}', (world: CoreWorld, json: string, windowId: string) => {
  cfg(world).config.saveValues?.(windowId, JSON.parse(json));
});

When('window {string} asks for its settings at section {string}', (world: CoreWorld, windowId: string, section: string) => {
  cfg(world).config.openSettings?.(windowId, section, CONTEXT);
});

When('window {string} asks for its settings', (world: CoreWorld, windowId: string) => {
  cfg(world).config.openSettings?.(windowId, undefined, CONTEXT);
});

Then('the shell showed the settings form for {string} at section {string}', (world: CoreWorld, title: string, section: string) => {
  expect(cfg(world).shown.at(-1)).toEqual({ title, section, context: CONTEXT });
});

Then('the shell showed the settings form for {string}', (world: CoreWorld, title: string) => {
  expect(cfg(world).shown.at(-1)).toEqual({ title, context: CONTEXT });
});

Then('the shell showed {int} settings forms', (world: CoreWorld, count: number) => {
  expect(cfg(world).shown).toHaveLength(count);
});

Given('a kernl shell over that host and pool whose host shows settings', (world: CoreWorld) => {
  const shown: SettingsPrompt[] = [];
  scratch(world).settingsShown = shown;
  boot(world, {}, { ...blobFetcher(world), presentSettings: (prompt) => void shown.push(prompt) });
});

const shownForms = (world: CoreWorld): SettingsPrompt[] => scratch(world).settingsShown as SettingsPrompt[];

When('the applet registers a settings schema with a {string} number and opens its settings over its port', async (world: CoreWorld, field: string) => {
  const port = k(world).channel?.port1;
  port?.postMessage({ type: 'config.registerSchema', id: 'schema-1', schema: { type: 'object', properties: { [field]: { type: 'number', minimum: 1, maximum: 9 } } } });
  await vi.waitFor(() => expect(k(world).received.some((message) => message.type === 'config.registerSchema.result')).toBe(true), { timeout: 3000 });
  port?.postMessage({ type: 'config.openSettings', id: 'open-1' });
  await vi.waitFor(() => expect(shownForms(world)).toHaveLength(1), { timeout: 3000 });
});

Then('the host was shown the settings form for the resolved applet with {string} in its schema', (world: CoreWorld, field: string) => {
  const [form] = shownForms(world);
  expect(form?.title).toBe(k(world).summary?.title);
  expect(Object.keys(form?.context.schema.properties ?? {})).toEqual([field]);
});

When('the person sets {string} to {int} in the form', (world: CoreWorld, field: string, value: number) => {
  shownForms(world)[0]?.context.commit({ [field]: value });
});

Then('the applet reads its settings as {string} over its port', async (world: CoreWorld, json: string) => {
  k(world).channel?.port1.postMessage({ type: 'config.get', id: 'get-1' });
  await vi.waitFor(() => expect(k(world).received.some((message) => message.type === 'config.values' || message.type === 'config.get.result')).toBe(true), { timeout: 3000 });
  const reply = [...k(world).received].reverse().find((message) => message.type === 'config.values' || message.type === 'config.get.result') as { values?: unknown };
  expect(reply.values).toEqual(JSON.parse(json));
});

Then('the shell does not offer the {string} domain', (world: CoreWorld, domain: string) => {
  expect(k(world).kernl.grants.availableDomains()).not.toContain(domain);
});
