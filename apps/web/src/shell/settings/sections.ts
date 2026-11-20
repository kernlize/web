import type { StorageLike } from '../contract';

/** Where the shell keeps the section the person was last in. */
export const SETTINGS_SECTION_KEY = 'kernl:settings:section:v1';

/** The sections of the Settings window, in the order the tabs list them (D-049). */
export const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'servers', label: 'Servers' },
  { id: 'messages', label: 'Messages' },
  { id: 'connections', label: 'Connections' },
  { id: 'downloads', label: 'Downloads' },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

/** Which way the tabs run: down the side of a wide window, across the top of a narrow one. */
export type TabOrientation = 'vertical' | 'horizontal';

const FIRST: SettingsSectionId = SETTINGS_SECTIONS[0].id;

const KEY_STEPS: Readonly<Record<TabOrientation, Readonly<Record<string, number>>>> = {
  vertical: { ArrowDown: 1, ArrowUp: -1 },
  horizontal: { ArrowRight: 1, ArrowLeft: -1 },
};

export const isSettingsSection = (value: unknown): value is SettingsSectionId => SETTINGS_SECTIONS.some((section) => section.id === value);

export const settingsTabId = (section: SettingsSectionId): string => `settings-tab-${section}`;

export const settingsPanelId = (section: SettingsSectionId): string => `settings-panel-${section}`;

/** The section Settings opens on: the one the person was last in, or the first. */
export function readSettingsSection(storage: StorageLike): SettingsSectionId {
  const stored = storage.getItem(SETTINGS_SECTION_KEY);
  return isSettingsSection(stored) ? stored : FIRST;
}

/** Keep the section the person chose, so Settings opens on it next time. */
export function rememberSettingsSection(storage: StorageLike, section: SettingsSectionId): SettingsSectionId {
  storage.setItem(SETTINGS_SECTION_KEY, section);
  return section;
}

/**
 * The tab a key moves to from `current`, or nothing when the key is not the list's. The arrows
 * along the list step and wrap, Home and End jump to its ends; the arrows across it are left to
 * the browser.
 */
export function settingsSectionForKey(current: SettingsSectionId, key: string, orientation: TabOrientation): SettingsSectionId | undefined {
  const count = SETTINGS_SECTIONS.length;
  if (key === 'Home') return FIRST;
  if (key === 'End') return SETTINGS_SECTIONS[count - 1]!.id;
  const step = KEY_STEPS[orientation][key];
  if (step === undefined) return undefined;
  const index = SETTINGS_SECTIONS.findIndex((section) => section.id === current);
  return SETTINGS_SECTIONS[(index + step + count) % count]!.id;
}
