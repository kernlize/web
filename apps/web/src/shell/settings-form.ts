import type { ConfigSettingsContext } from '@kehto/services';

type Schema = ConfigSettingsContext['schema'];
type Values = ConfigSettingsContext['values'];

/** How a setting is drawn: a text box, a masked box, a list to pick from, a number box or a checkbox. */
export type SettingsFieldKind = 'text' | 'secret' | 'choice' | 'number' | 'toggle';

/** One choice of a `choice` field. `value` is the JSON of the schema's enum entry, so numbers survive the form. */
export interface SettingsChoice {
  readonly value: string;
  readonly label: string;
}

export interface SettingsField {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly kind: SettingsFieldKind;
  readonly required: boolean;
  readonly choices?: readonly SettingsChoice[];
  readonly min?: number;
  readonly max?: number;
  /** `1` for whole numbers, otherwise any number. */
  readonly step?: number | 'any';
  /** The secret already has a value; leaving the box empty keeps it. */
  readonly kept?: boolean;
}

export interface SettingsSection {
  /** The applet's section name, or undefined for settings without one. */
  readonly id: string | undefined;
  readonly heading: string;
  readonly fields: readonly SettingsField[];
}

/** What the form edits: text for boxes and lists, true or false for checkboxes. A number box bound by Svelte holds a number, or null when empty. */
export type SettingsDraft = Record<string, string | number | boolean | null>;

export type SettingsOutcome = { readonly ok: true; readonly values: Values } | { readonly ok: false; readonly error: string };

/** `apiKey`, `api_key` and `api-key` all read "Api key". */
function humanize(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const typeOf = (schema: Schema): string | undefined => (Array.isArray(schema.type) ? schema.type.find((name) => name !== 'null') : (schema.type as string | undefined));

function kindOf(schema: Schema): SettingsFieldKind | undefined {
  const type = typeOf(schema);
  if (Array.isArray(schema.enum) && schema.enum.length > 0 && type !== 'boolean') return 'choice';
  if (type === 'string') return schema['x-napplet-secret'] === true ? 'secret' : 'text';
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'boolean') return 'toggle';
  return undefined;
}

const bound = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

function fieldOf(key: string, schema: Schema, required: boolean, values: Values): SettingsField | undefined {
  const kind = kindOf(schema);
  if (!kind) return undefined;
  const description = typeof schema.description === 'string' ? schema.description : undefined;
  const base = { key, label: typeof schema.title === 'string' ? schema.title : humanize(key), kind, required, ...(description ? { description } : {}) };
  if (kind === 'choice') return { ...base, choices: (schema.enum as readonly unknown[]).map((item) => ({ value: JSON.stringify(item), label: typeof item === 'string' ? item : JSON.stringify(item) })) };
  if (kind === 'number') {
    const min = bound(schema.minimum);
    const max = bound(schema.maximum);
    return { ...base, step: typeOf(schema) === 'integer' ? 1 : 'any', ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
  }
  if (kind === 'secret') return { ...base, kept: typeof values[key] === 'string' && values[key] !== '' };
  return base;
}

const orderOf = (schema: Schema): number => (typeof schema['x-napplet-order'] === 'number' ? schema['x-napplet-order'] : Number.POSITIVE_INFINITY);

const sectionOf = (schema: Schema): string | undefined => (typeof schema['x-napplet-section'] === 'string' && schema['x-napplet-section'] !== '' ? schema['x-napplet-section'] : undefined);

/**
 * The form an applet's schema asks for, one section per `x-napplet-section`, settings without one
 * first. Within a section `x-napplet-order` sorts ascending and ties go alphabetically, as NAP-CONFIG's
 * extensions table says. Kinds the form cannot draw (objects, lists) are left out and keep their values.
 */
export function settingsSections(schema: Schema, values: Values): readonly SettingsSection[] {
  const required = new Set(schema.required ?? []);
  const entries = Object.entries(schema.properties ?? {}).sort(([a, left], [b, right]) => orderOf(left) - orderOf(right) || a.localeCompare(b));
  const sections = new Map<string | undefined, SettingsField[]>([[undefined, []]]);
  for (const [key, property] of entries) {
    const field = fieldOf(key, property, required.has(key), values);
    if (!field) continue;
    const id = sectionOf(property);
    sections.set(id, [...(sections.get(id) ?? []), field]);
  }
  return [...sections].filter(([, fields]) => fields.length > 0).map(([id, fields]) => ({ id, heading: id === undefined ? 'General' : humanize(id), fields }));
}

/** The form's starting state from the applet's current values. A secret starts empty, so it is never put back on screen. */
export function draftOf(sections: readonly SettingsSection[], values: Values): SettingsDraft {
  const draft: SettingsDraft = {};
  for (const field of sections.flatMap((section) => section.fields)) {
    const value = values[field.key];
    if (field.kind === 'toggle') draft[field.key] = value === true;
    else if (field.kind === 'secret') draft[field.key] = '';
    else if (field.kind === 'choice') draft[field.key] = value === undefined ? '' : JSON.stringify(value);
    else draft[field.key] = value === undefined ? '' : String(value);
  }
  return draft;
}

function readNumber(field: SettingsField, text: string): number | string {
  const value = Number(text);
  if (!Number.isFinite(value)) return `${field.label} needs a number.`;
  if (field.step === 1 && !Number.isInteger(value)) return `${field.label} needs a whole number.`;
  if (field.min !== undefined && value < field.min) return `${field.label} is at least ${field.min}.`;
  if (field.max !== undefined && value > field.max) return `${field.label} is at most ${field.max}.`;
  return value;
}

/** One field's value from the form, `undefined` to leave it unset, or the words for what is wrong with it. */
function readField(field: SettingsField, entry: SettingsDraft[string] | undefined, current: unknown): { value?: unknown; error?: string } {
  if (field.kind === 'toggle') return { value: entry === true };
  const text = typeof entry === 'number' ? String(entry) : typeof entry === 'string' ? entry : '';
  if (field.kind === 'secret' && text === '') return current === undefined ? {} : { value: current };
  if (text === '' && field.kind !== 'text') return field.required ? { error: `${field.label} is needed.` } : {};
  if (field.kind === 'choice') return { value: JSON.parse(text) as unknown };
  if (field.kind === 'number') {
    const read = readNumber(field, text.trim());
    return typeof read === 'number' ? { value: read } : { error: read };
  }
  return { value: text };
}

/**
 * The values to commit: the applet's current values with every field on the form applied over them,
 * or the first thing the person has to fix. kehto's commit checks again; this only gives plain words.
 */
export function valuesOf(sections: readonly SettingsSection[], draft: SettingsDraft, current: Values): SettingsOutcome {
  const values: Record<string, unknown> = { ...current };
  for (const field of sections.flatMap((section) => section.fields)) {
    const read = readField(field, draft[field.key], current[field.key]);
    if (read.error) return { ok: false, error: read.error };
    if (read.value === undefined) delete values[field.key];
    else values[field.key] = read.value;
  }
  return { ok: true, values };
}

/** Check the form, then hand it to kehto, which validates, saves and tells the applet; a refusal comes back as words. */
export function commitSettings(context: ConfigSettingsContext, sections: readonly SettingsSection[], draft: SettingsDraft): SettingsOutcome {
  const read = valuesOf(sections, draft, context.values);
  if (!read.ok) return read;
  try {
    return { ok: true, values: context.commit(read.values) };
  } catch {
    return { ok: false, error: 'These settings were not accepted. Check the values and try again.' };
  }
}
