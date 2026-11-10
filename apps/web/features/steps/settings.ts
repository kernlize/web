import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { ConfigSettingsContext } from '@kehto/services';
import { commitSettings, draftOf, settingsSections, type SettingsDraft, type SettingsField, type SettingsOutcome, type SettingsSection } from '../../src/shell/settings-form.ts';

interface SettingsScratch {
  schema: ConfigSettingsContext['schema'];
  values: ConfigSettingsContext['values'];
  edits: SettingsDraft;
  refuses: boolean;
  committed?: unknown;
  outcome?: SettingsOutcome;
}

interface SettingsWorld {
  settingsForm?: SettingsScratch;
}

function scratchOf(world: SettingsWorld): SettingsScratch {
  if (!world.settingsForm) throw new Error('give the applet a settings schema first');
  return world.settingsForm;
}

const sectionsOf = (world: SettingsWorld): readonly SettingsSection[] => settingsSections(scratchOf(world).schema, scratchOf(world).values);

function fieldOf(world: SettingsWorld, key: string): SettingsField {
  const field = sectionsOf(world).flatMap((section) => section.fields).find((candidate) => candidate.key === key);
  if (!field) throw new Error(`no setting ${key}`);
  return field;
}

function save(world: SettingsWorld, edits: SettingsDraft): void {
  const scratch = scratchOf(world);
  const sections = sectionsOf(world);
  const context: ConfigSettingsContext = {
    schema: scratch.schema,
    values: scratch.values,
    commit(values) {
      if (scratch.refuses) throw new Error('required configuration values are missing or invalid');
      scratch.committed = values;
      return values;
    },
  };
  scratch.outcome = commitSettings(context, sections, { ...draftOf(sections, scratch.values), ...edits });
}

Given('an applet settings schema', (world: SettingsWorld, schema: string) => {
  world.settingsForm = { schema: JSON.parse(schema) as ConfigSettingsContext['schema'], values: world.settingsForm?.values ?? {}, edits: {}, refuses: false };
});

Given('the applet\'s current settings are {string}', (world: SettingsWorld, values: string) => {
  scratchOf(world).values = JSON.parse(values) as ConfigSettingsContext['values'];
});

Given('the settings commit refuses', (world: SettingsWorld) => {
  scratchOf(world).refuses = true;
});

Then('the settings form has sections {string}', (world: SettingsWorld, headings: string) => {
  expect(sectionsOf(world).map((section) => section.heading).join(',')).toBe(headings);
});

Then('the settings section {string} has fields {string}', (world: SettingsWorld, heading: string, fields: string) => {
  const section = sectionsOf(world).find((candidate) => candidate.heading === heading);
  expect(section?.fields.map((field) => `${field.key}:${field.kind}`).join(',')).toBe(fields);
});

Then('the setting {string} is labelled {string} and described {string}', (world: SettingsWorld, key: string, label: string, description: string) => {
  expect(fieldOf(world, key)).toMatchObject({ label, description });
});

Then('the setting {string} is labelled {string}', (world: SettingsWorld, key: string, label: string) => {
  const field = fieldOf(world, key);
  expect(field.label).toBe(label);
  expect(field.description).toBeUndefined();
});

Then('the setting {string} is labelled {string} and keeps its saved value', (world: SettingsWorld, key: string, label: string) => {
  expect(fieldOf(world, key)).toMatchObject({ label, kept: true });
});

Then('the setting {string} does not keep a saved value', (world: SettingsWorld, key: string) => {
  expect(fieldOf(world, key).kept).toBe(false);
});

Then('the setting {string} is labelled {string} with choices {string}', (world: SettingsWorld, key: string, label: string, choices: string) => {
  const field = fieldOf(world, key);
  expect(field.label).toBe(label);
  expect(field.choices?.map((choice) => choice.label).join(',')).toBe(choices);
});

Then('the setting {string} has choices {string}', (world: SettingsWorld, key: string, choices: string) => {
  expect(fieldOf(world, key).choices?.map((choice) => `${choice.label}=${choice.value}`).join(',')).toBe(choices.split(',').map((item) => `${item}=${item}`).join(','));
});

Then('the setting {string} is a whole number from {int} to {int} and needed', (world: SettingsWorld, key: string, min: number, max: number) => {
  expect(fieldOf(world, key)).toMatchObject({ kind: 'number', step: 1, min, max, required: true });
});

Then('the setting {string} is any number without bounds', (world: SettingsWorld, key: string) => {
  const field = fieldOf(world, key);
  expect(field).toMatchObject({ kind: 'number', step: 'any', required: false });
  expect(field.min).toBeUndefined();
  expect(field.max).toBeUndefined();
});

Then('the settings draft is {string}', (world: SettingsWorld, draft: string) => {
  const scratch = scratchOf(world);
  expect(draftOf(sectionsOf(world), scratch.values)).toEqual(JSON.parse(draft));
});

When('the person sets the settings draft {string}', (world: SettingsWorld, edits: string) => {
  scratchOf(world).edits = JSON.parse(edits) as SettingsDraft;
});

When('the person picks {string} for the setting {string}', (world: SettingsWorld, label: string, key: string) => {
  const choice = fieldOf(world, key).choices?.find((candidate) => candidate.label === label);
  scratchOf(world).edits = { ...scratchOf(world).edits, [key]: choice?.value ?? '' };
});

When('the person saves the settings form', (world: SettingsWorld) => save(world, scratchOf(world).edits));

When('the person saves the settings form unchanged', (world: SettingsWorld) => save(world, {}));

Then('the settings commit received {string}', (world: SettingsWorld, values: string) => {
  const scratch = scratchOf(world);
  expect(scratch.outcome).toEqual({ ok: true, values: JSON.parse(values) });
  expect(scratch.committed).toEqual(JSON.parse(values));
});

Then('the settings form says {string}', (world: SettingsWorld, error: string) => {
  expect(scratchOf(world).outcome).toEqual({ ok: false, error });
});

Then('nothing was committed', (world: SettingsWorld) => {
  expect(scratchOf(world).committed).toBeUndefined();
});
