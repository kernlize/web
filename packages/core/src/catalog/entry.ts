import { naddrEncode, neventEncode } from 'applesauce-core/helpers';
import { NAPPLET_KIND_SNAPSHOT, parseNappletManifest, verifyManifestSignature, type NappletManifest } from '@kehto/nip/5d';
import type { NostrEvent } from '@napplet/core';

/** One applet as the store lists it. Read from a signed manifest; its bytes are verified only when it is opened. */
export interface CatalogEntry {
  /** kehto's publisher- and kind-safe identity; the same id the intent catalogue uses. */
  readonly catalogId: string;
  /** A shareable address the launcher can decode: `naddr1…`, or `nevent1…` for a pinned version. */
  readonly address: string;
  readonly kind: number;
  readonly publisher: string;
  readonly title: string;
  readonly description: string;
  /** Lower-cased topics from the manifest's `t` tags. */
  readonly topics: readonly string[];
  readonly requires: readonly string[];
  /** Roles from `z` tags. */
  readonly archetypes: readonly string[];
  /** Accepted convention identities from `i` tags, such as `napplet:profile/open`. */
  readonly conventions: readonly string[];
  /** A display URL for the icon, from the manifest's first server. Never identity. */
  readonly iconUrl?: string;
  readonly publishedAt: number;
}

const unique = (values: readonly string[]): readonly string[] => Object.freeze([...new Set(values)]);

function topicsOf(event: NostrEvent): readonly string[] {
  return unique(event.tags.filter((tag) => tag[0] === 't' && typeof tag[1] === 'string' && tag[1].trim() !== '').map((tag) => (tag[1] as string).trim().toLowerCase()));
}

function iconUrlOf(manifest: NappletManifest): string | undefined {
  const server = manifest.servers[0];
  return manifest.icon && server ? `${server.replace(/\/+$/, '')}/${manifest.icon.sha256}` : undefined;
}

/**
 * The address a person can paste back into the launcher for this manifest.
 *
 * @param event - A napplet manifest event.
 * @param relays - Where it was found; carried as hints, never as identity.
 * @returns `nevent1…` for a snapshot, `naddr1…` for a root or named applet.
 * @example
 * ```ts
 * addressOf(manifest, ['wss://relay.napplet.soy']); // 'naddr1…'
 * ```
 */
export function addressOf(event: NostrEvent, relays: readonly string[] = []): string {
  if (event.kind === NAPPLET_KIND_SNAPSHOT) return neventEncode({ id: event.id, author: event.pubkey, kind: event.kind, relays: [...relays] });
  const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1] ?? '';
  return naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier, relays: [...relays] });
}

/**
 * Read a store entry from a manifest event.
 *
 * The signature is checked so a relay cannot list an applet under someone
 * else's name; the artifact is not fetched. Malformed manifests yield nothing.
 *
 * @param event - A candidate manifest event.
 * @param relays - Relay hints for the entry's address.
 * @returns The entry, or undefined when the event is not a valid signed manifest.
 * @example
 * ```ts
 * toCatalogEntry(event)?.topics; // ['game', 'puzzle']
 * ```
 */
export function toCatalogEntry(event: NostrEvent, relays: readonly string[] = []): CatalogEntry | undefined {
  let manifest: NappletManifest;
  try {
    if (!verifyManifestSignature(event)) return undefined;
    manifest = parseNappletManifest(event);
  } catch {
    return undefined;
  }
  const iconUrl = iconUrlOf(manifest);
  return Object.freeze({
    catalogId: manifest.catalogId,
    address: addressOf(event, relays),
    kind: event.kind,
    publisher: event.pubkey,
    title: manifest.title ?? (manifest.dTag || 'Untitled applet'),
    description: manifest.description ?? '',
    topics: topicsOf(event),
    requires: unique(manifest.requires),
    archetypes: unique(manifest.archetypeSlugs ?? manifest.archetypes.map((entry) => entry.slug)),
    conventions: unique(manifest.archetypes.map((entry) => entry.convention)),
    ...(iconUrl ? { iconUrl } : {}),
    publishedAt: event.created_at,
  });
}

/**
 * Keep the newest entry per catalogue id, newest first.
 *
 * Named and root applets are replaced on every release, so relays may hold
 * several versions; the store lists one.
 *
 * @param entries - Entries in any order, possibly repeated.
 * @returns One entry per applet.
 * @example
 * ```ts
 * newestEntries([older, newer]); // [newer]
 * ```
 */
export function newestEntries(entries: readonly CatalogEntry[]): readonly CatalogEntry[] {
  const newest = new Map<string, CatalogEntry>();
  for (const entry of entries) {
    const current = newest.get(entry.catalogId);
    if (!current || entry.publishedAt > current.publishedAt) newest.set(entry.catalogId, entry);
  }
  return Object.freeze([...newest.values()].sort((a, b) => b.publishedAt - a.publishedAt));
}
