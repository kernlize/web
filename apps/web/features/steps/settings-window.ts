import { expect } from 'vitest';
import { Given, Then, When, type DataTable } from 'quickpickle';
import type { ManagedWindow } from '@kernlize/core/wm';
import type { StorageLike } from '../../src/shell/contract.ts';
import {
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_KEY,
  isSettingsSection,
  readSettingsSection,
  rememberSettingsSection,
  settingsPanelId,
  settingsSectionForKey,
  settingsTabId,
  type SettingsSectionId,
  type TabOrientation,
} from '../../src/shell/settings/sections.ts';
import { namesProtocol } from '../../src/shell/vocabulary.ts';
import { panelToClose } from '../../src/shell/windows.ts';

interface SettingsWindowScratch {
  stored: Map<string, string>;
  storage: StorageLike;
  panels: ManagedWindow[];
}

interface SettingsWindowWorld {
  settingsWindow?: SettingsWindowScratch;
}

function scratchOf(world: SettingsWindowWorld): SettingsWindowScratch {
  if (!world.settingsWindow) {
    const stored = new Map<string, string>();
    world.settingsWindow = {
      stored,
      storage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => void stored.set(key, value), removeItem: (key) => void stored.delete(key) },
      panels: [],
    };
  }
  return world.settingsWindow;
}

Then('the Settings sections read {string}', (_world: SettingsWindowWorld, labels: string) => {
  expect(SETTINGS_SECTIONS.map((section) => section.label).join(', ')).toBe(labels);
});

Then('no Settings section is named after a protocol', () => {
  for (const section of SETTINGS_SECTIONS) expect(namesProtocol(`${section.id} ${section.label}`)).toBe(false);
});

Then('the Settings tab for {string} is {string} and controls {string}', (_world: SettingsWindowWorld, section: string, tab: string, panel: string) => {
  expect(settingsTabId(section as SettingsSectionId)).toBe(tab);
  expect(settingsPanelId(section as SettingsSectionId)).toBe(panel);
});

Then('pressing {string} on the Settings tab {string} in a {word} list goes to {string}', (_world: SettingsWindowWorld, key: string, from: string, orientation: string, to: string) => {
  expect(settingsSectionForKey(from as SettingsSectionId, key, orientation as TabOrientation)).toBe(to);
});

Then('pressing {string} on the Settings tab {string} in a {word} list goes nowhere', (_world: SettingsWindowWorld, key: string, from: string, orientation: string) => {
  expect(settingsSectionForKey(from as SettingsSectionId, key, orientation as TabOrientation)).toBeUndefined();
});

Given('the shell has stored the Settings section {string}', (world: SettingsWindowWorld, stored: string) => {
  if (stored !== '') scratchOf(world).storage.setItem(SETTINGS_SECTION_KEY, stored);
});

When('the person chooses the Settings section {string}', (world: SettingsWindowWorld, section: string) => {
  expect(rememberSettingsSection(scratchOf(world).storage, section as SettingsSectionId)).toBe(section);
});

Then('Settings opens on the section {string}', (world: SettingsWindowWorld, section: string) => {
  expect(readSettingsSection(scratchOf(world).storage)).toBe(section);
});

Then('the shell has remembered the Settings section {string} under {string}', (world: SettingsWindowWorld, section: string, key: string) => {
  expect(scratchOf(world).stored.get(key)).toBe(section);
});

Then('{string} is a Settings section', (_world: SettingsWindowWorld, value: string) => {
  expect(isSettingsSection(value)).toBe(true);
});

Then('{string} is not a Settings section', (_world: SettingsWindowWorld, value: string) => {
  expect(isSettingsSection(value)).toBe(false);
});

Given('the shell-drawn windows:', (world: SettingsWindowWorld, table: DataTable) => {
  scratchOf(world).panels = table.hashes().map((row) => ({
    id: String(row.id),
    rect: { x: 0, y: 0, w: 0, h: 0 },
    z: Number(row.z),
    focused: row.focused === 'yes',
    minimised: row.minimised === 'yes',
    stopped: false,
  }));
});

Then('Escape closes the shell-drawn window {string}', (world: SettingsWindowWorld, id: string) => {
  expect(panelToClose(scratchOf(world).panels)?.id).toBe(id);
});

Then('Escape closes no shell-drawn window', (world: SettingsWindowWorld) => {
  expect(panelToClose(scratchOf(world).panels)).toBeUndefined();
});
