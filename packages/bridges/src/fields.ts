import type { Locator } from './types';

/**
 * Reads a string field from a locator, rejecting when the field is absent or a list.
 *
 * @param locator - The parsed locator.
 * @param key - The field name.
 * @returns The field value.
 * @throws `invalid:locator-missing-<key>` when the field is not a string.
 */
export function requireField(locator: Locator, key: string): string {
  const value = locator.fields[key];
  if (typeof value !== 'string') throw new Error(`invalid:locator-missing-${key}`);
  return value;
}

/**
 * Reads an optional string field from a locator.
 *
 * @param locator - The parsed locator.
 * @param key - The field name.
 * @returns The field value, or undefined when absent or a list.
 */
export function optionalField(locator: Locator, key: string): string | undefined {
  const value = locator.fields[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Reads a list field from a locator.
 *
 * @param locator - The parsed locator.
 * @param key - The field name.
 * @returns The list, or an empty list when the field is absent or a string.
 */
export function listField(locator: Locator, key: string): readonly string[] {
  const value = locator.fields[key];
  return typeof value === 'object' ? value : [];
}
