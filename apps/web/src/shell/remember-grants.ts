import { REMEMBER_GRANTS_KEY, type StorageLike } from './contract';

/**
 * Whether a person's grants are remembered when they run an applet. It starts on, and once they
 * change it the choice stays as they left it, both ways, until they change it again (D-059).
 *
 * @param storage - The shell's storage; the offline preview's is scoped away from the live shell's.
 * @returns True unless the person turned it off.
 * @example
 * ```ts
 * readRemember(storage); // true on a fresh browser
 * ```
 */
export function readRemember(storage: StorageLike): boolean {
  return storage.getItem(REMEMBER_GRANTS_KEY) !== 'no';
}

/**
 * Keep the person's choice. Only an off is written, as `no`; turning it back on removes it, so the
 * default and an unset browser read the same.
 *
 * @param storage - The shell's storage.
 * @param remember - What the person chose.
 * @example
 * ```ts
 * writeRemember(storage, false);
 * readRemember(storage); // false, next time too
 * ```
 */
export function writeRemember(storage: StorageLike, remember: boolean): void {
  if (remember) storage.removeItem(REMEMBER_GRANTS_KEY);
  else storage.setItem(REMEMBER_GRANTS_KEY, 'no');
}
