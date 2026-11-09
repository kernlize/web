/**
 * A shell's binding may answer a refused request by resolving with an error
 * record (`{ error: "<reason>" }`, every other field undefined) instead of
 * rejecting. Turn that into the rejection the rest of the applet expects,
 * carrying the reason unchanged so the wording and retry rules see it.
 */
export function unwrapDmResult<T>(result: T): T {
  if (typeof result === 'object' && result !== null) {
    const reason = (result as { error?: unknown }).error;
    if (typeof reason === 'string' && reason !== '') throw new Error(reason);
  }
  return result;
}
