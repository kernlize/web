const SECURE_SCHEME = 'wss://';

/**
 * A relay or file server as the shell shows it: its own host, with the port when the address has
 * one, and nothing else changed. No label is dropped and no nickname stands in for it (D-051).
 */
export function hostOf(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    const [host = address] = address.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/);
    return host;
  }
}

/** What a person typed into a relay field, as the address the shell stores. Bare hostnames get the secure scheme. */
export function serverAddress(input: string): string {
  const trimmed = input.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `${SECURE_SCHEME}${trimmed}`;
}
