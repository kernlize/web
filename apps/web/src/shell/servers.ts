/** Leading labels that only say "this is a server for the network"; they add nothing for a person. */
const GENERIC_LABELS = new Set(['relay', 'nostr', 'nos']);
/** Second-level labels under country codes that are not registrable on their own (`co.uk`). */
const SHARED_SECOND_LEVEL = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org']);

const SECURE_SCHEME = 'wss://';

function registrable(labels: readonly string[]): boolean {
  if (labels.length < 2) return false;
  if (labels.length > 2) return true;
  const [second = '', top = ''] = labels;
  return !(top.length === 2 && SHARED_SECOND_LEVEL.has(second));
}

/**
 * A server as a person reads it: the hostname without the scheme, minus one leading generic
 * label when what remains is still a domain someone registered. `wss://relay.damus.io` reads
 * `damus.io`; `wss://nos.lol` stays `nos.lol`. The full address stays in data (D-006).
 */
export function serverName(address: string): string {
  let host: string;
  try {
    host = new URL(address).hostname;
  } catch {
    host = address.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/:?#]/)[0] ?? address;
  }
  const labels = host.toLowerCase().split('.');
  const [first = '', ...rest] = labels;
  return GENERIC_LABELS.has(first) && registrable(rest) ? rest.join('.') : host;
}

/** What a person typed into "Server address", as the address the shell stores. Bare hostnames get the secure scheme. */
export function serverAddress(input: string): string {
  const trimmed = input.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `${SECURE_SCHEME}${trimmed}`;
}
