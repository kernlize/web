/** A conversation or message id split into its provider prefix and the provider's own id. */
export interface NamespacedId {
  readonly providerId: string;
  readonly innerId: string;
}

/**
 * Prefix a provider-local id with its provider id so it is unique across the composite.
 *
 * @param providerId - The provider that owns `innerId`.
 * @param innerId - The id as the provider knows it. May itself contain `:`.
 * @returns `"<providerId>:<innerId>"`.
 * @example
 * ```ts
 * namespaceId('private', 'direct:ab,cd'); // 'private:direct:ab,cd'
 * ```
 */
export function namespaceId(providerId: string, innerId: string): string {
  return `${providerId}:${innerId}`;
}

/**
 * Split a composite id on its first `:`. Everything after it belongs to the provider.
 *
 * @param id - A composite id produced by {@link namespaceId}.
 * @returns The two halves, or `undefined` when `id` has no provider prefix.
 * @example
 * ```ts
 * splitId('private:direct:ab,cd'); // { providerId: 'private', innerId: 'direct:ab,cd' }
 * splitId('orphan'); // undefined
 * ```
 */
export function splitId(id: string): NamespacedId | undefined {
  const at = id.indexOf(':');
  if (at <= 0) return undefined;
  return { providerId: id.slice(0, at), innerId: id.slice(at + 1) };
}
