import type { NappletManifest } from '@kehto/nip/5d';
import type { AppletPointer, AppletSummary, BuiltinApplet } from '../types.js';
import type { ResolvedApplet } from './resolve.js';

/**
 * The key shown as the publisher of an applet nobody published. A manifest's catalogue id needs
 * a key, and the all-zero one cannot sign, so it can never collide with a real publisher.
 *
 * @example
 * ```ts
 * summary.builtin && summary.publisher === BUILTIN_PUBLISHER; // true
 * ```
 */
export const BUILTIN_PUBLISHER = '0'.repeat(64);

const ADDRESS = /^kernl:([a-z][a-z0-9-]*)$/;
const MANIFEST_KIND = 35129;

/**
 * The address of an applet that comes with the shell.
 *
 * @param id - The built-in applet's name.
 * @returns `kernl:<id>`.
 * @example
 * ```ts
 * builtinAddress('messages'); // 'kernl:messages'
 * ```
 */
export function builtinAddress(id: string): string {
  return `kernl:${id}`;
}

/**
 * Read a `kernl:<id>` address.
 *
 * @param text - A trimmed address.
 * @returns A built-in pointer, or `undefined` when the text is not one.
 * @example
 * ```ts
 * decodeBuiltin('kernl:messages'); // { kind: 'builtin', id: 'messages', relays: [] }
 * ```
 */
export function decodeBuiltin(text: string): AppletPointer | undefined {
  const id = ADDRESS.exec(text)?.[1];
  return id === undefined ? undefined : { kind: 'builtin', id, relays: Object.freeze([]) };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function manifestOf(applet: BuiltinApplet): NappletManifest {
  const archetypes = (applet.archetypes ?? []).map((entry) => ({ slug: entry.slug, convention: entry.convention, params: [...(entry.params ?? [])] }));
  return {
    format: 'current',
    artifactHash: applet.sha256,
    optional: [...applet.optional],
    archetypeSlugs: [...new Set(archetypes.map((entry) => entry.slug))],
    intents: archetypes.map((entry) => ({ identity: entry.convention, parameters: entry.params })),
    kind: MANIFEST_KIND,
    pubkey: BUILTIN_PUBLISHER,
    dTag: applet.id,
    catalogId: `nip5d:${MANIFEST_KIND}:${BUILTIN_PUBLISHER}:${applet.id}`,
    paths: [{ path: '/index.html', sha256: applet.sha256 }],
    aggregateHash: applet.sha256,
    servers: [],
    requires: [...applet.requires],
    archetypes,
    title: applet.title,
    description: applet.description,
  };
}

function summaryOf(applet: BuiltinApplet): AppletSummary {
  const manifest = manifestOf(applet);
  return {
    identity: { dTag: applet.id, hash: applet.sha256 },
    address: builtinAddress(applet.id),
    title: applet.title,
    description: applet.description,
    publisher: BUILTIN_PUBLISHER,
    requires: Object.freeze([...applet.requires]),
    optional: Object.freeze([...applet.optional]),
    archetypes: Object.freeze([...(manifest.archetypeSlugs as string[])]),
    builtin: true,
    manifest,
  };
}

/**
 * Load an applet that comes with the shell and check it against its pinned hash.
 *
 * Nothing is fetched from the network and no signature is checked: the host that
 * lists the applet is the page the user already trusts with everything else, so
 * what it pins is as trusted as its own code. The check is that the bytes loaded
 * are the bytes pinned. The summary is shaped like a published applet's, so
 * grants, intents and the mount plan treat it the same.
 *
 * @param builtins - The applets the host ships.
 * @param id - The name from a `kernl:<id>` address.
 * @returns The summary and the verified `index.html`.
 * @throws `invalid:pointer` for a name the host does not ship, `unavailable:blob` when the
 * artifact cannot be loaded, `invalid:artifact-hash` when it does not match its pin.
 * @example
 * ```ts
 * const { summary, indexHtml } = await resolveBuiltin(builtins, 'messages');
 * summary.address; // 'kernl:messages'
 * ```
 */
export async function resolveBuiltin(builtins: readonly BuiltinApplet[], id: string): Promise<ResolvedApplet> {
  const applet = builtins.find((candidate) => candidate.id === id);
  if (!applet) throw new Error('invalid:pointer');
  const indexHtml = await applet.load().catch(() => {
    throw new Error('unavailable:blob');
  });
  if ((await sha256Hex(indexHtml)) !== applet.sha256) throw new Error('invalid:artifact-hash');
  return { summary: summaryOf(applet), indexHtml };
}
