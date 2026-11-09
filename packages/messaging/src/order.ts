/**
 * Put the named ids first, in the order given, and keep every other id after them in the order it had.
 *
 * @param current - The order so far.
 * @param first - Ids to move to the front; duplicates count once.
 * @returns The new order, holding exactly the ids of `current` and `first`.
 * @example
 * ```ts
 * arrange(['private', 'legacy', 'ratchet'], ['ratchet']); // ['ratchet', 'private', 'legacy']
 * ```
 */
export function arrange(current: readonly string[], first: readonly string[]): string[] {
  const head = [...new Set(first)];
  return [...head, ...current.filter((id) => !head.includes(id))];
}
