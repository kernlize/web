import { catchError, EMPTY, lastValueFrom, takeUntil, timer, toArray } from 'rxjs';
import type { EventStore } from 'applesauce-core';
import { isAddressableKind, isReplaceable } from 'applesauce-core/helpers';
import type { AddressPointerLoader } from 'applesauce-loaders/loaders';
import type { ConsentRequest } from '@kehto/runtime';
import type { EventTemplate, NostrEvent } from '@napplet/core';
import type { AppletIdentity, ConsentLine, ConsentSummary, KernlHost } from '../types.js';
import { describeChange, isDestructiveKind } from './describe-change.js';

/** Finds the current version of a replaceable event so the summary can show a diff; undefined when it cannot be found. */
export type LookupBefore = (kind: number, pubkey: string, identifier?: string) => Promise<NostrEvent | undefined>;

/** Maps a window to the verified applet running in it. */
export type ResolveAppletIdentity = (windowId: string) => AppletIdentity | undefined;

/** How long a consent prompt waits for the network to return the current version, in milliseconds. */
export const CURRENT_VERSION_TIMEOUT_MS = 4000;

/** The line a destructive summary carries when the version it replaces could not be loaded. */
export const UNKNOWN_CURRENT_VERSION: ConsentLine = { label: 'Current version', after: 'could not be loaded; this replaces it entirely' };

/** Options for {@link lookupReplaceable}. */
export interface LookupReplaceableOptions {
  /** Loads the current version from the network when the store has none. Without it the lookup reads the store only. */
  readonly loader?: AddressPointerLoader;
  /** The relays to ask, read each time a lookup runs. */
  readonly relays?: () => readonly string[];
  /** How long to wait for the loader; defaults to {@link CURRENT_VERSION_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

function newest(events: readonly NostrEvent[]): NostrEvent | undefined {
  return events.reduce<NostrEvent | undefined>((best, event) => (!best || event.created_at > best.created_at ? event : best), undefined);
}

/**
 * A {@link LookupBefore} over the shell's event store and, on a miss, the
 * network.
 *
 * The store answers first. When it holds no version, the applesauce address
 * loader asks the given relays and the lookup waits at most `timeoutMs` for
 * an answer, then takes the newest version that arrived. A loader that fails
 * or stays silent yields undefined, which the consent summary reports as a
 * current version that could not be loaded.
 *
 * @param store - The event store that holds the current replaceable events.
 * @param options - Network loader, relays and timeout.
 * @returns A lookup for {@link createConsentHandler} and {@link createSigningConsent}.
 * @example
 * ```ts
 * const lookupBefore = lookupReplaceable(eventStore, { loader, relays: () => tiers.get().discovery });
 * createConsentHandler(host, lookupBefore, resolveApplet);
 * ```
 */
export function lookupReplaceable(store: Pick<EventStore, 'getReplaceable'>, options: LookupReplaceableOptions = {}): LookupBefore {
  const { loader } = options;
  return async (kind, pubkey, identifier) => {
    const cached = store.getReplaceable(kind, pubkey, identifier);
    if (cached || !loader) return cached;
    const pointer = { kind, pubkey, relays: [...(options.relays?.() ?? [])], ...(identifier === undefined ? {} : { identifier }) };
    const loaded = await lastValueFrom(
      loader(pointer).pipe(takeUntil(timer(options.timeoutMs ?? CURRENT_VERSION_TIMEOUT_MS)), catchError(() => EMPTY), toArray()),
    );
    return newest(loaded);
  };
}

function identifierOf(event: NostrEvent): string | undefined {
  if (!isAddressableKind(event.kind)) return undefined;
  const tag = event.tags.find((entry) => entry[0] === 'd');
  return tag?.[1] ?? '';
}

/**
 * Describe a write against the version it replaces. A replaceable or
 * addressable write whose current version cannot be found stays destructive
 * and says so first, rather than reading as a first version that removes
 * nothing.
 */
async function describeAgainstCurrent(event: NostrEvent, lookupBefore: LookupBefore, applet: AppletIdentity): Promise<ConsentSummary> {
  if (!isReplaceable(event.kind)) return describeChange(event, undefined, applet);
  const before = await lookupBefore(event.kind, event.pubkey, identifierOf(event));
  const summary = describeChange(event, before, applet);
  return before ? summary : { ...summary, lines: [UNKNOWN_CURRENT_VERSION, ...summary.lines] };
}

/**
 * Answer kehto's own consent requests.
 *
 * The kehto runtime kernl pins emits only `firewall-policy` requests, which
 * carry no event; kernl's guard decides firewall policy itself, so those are
 * refused without asking. Destructive writes are not asked for here: kehto
 * signs through `ShellAdapter.auth.getSigner`, and kernl gates that seam with
 * {@link createSigningConsent}. A request that does carry an event, from a
 * window the shell recognises, is still described and put to the user, so a
 * kehto release that adds such prompts is answered honestly; one from a
 * window the shell cannot name is refused.
 *
 * @param host - Supplies `presentConsent`.
 * @param lookupBefore - Finds the current replaceable event for the diff.
 * @param resolveApplet - Maps the requesting window to its applet identity.
 * @returns A handler for `bridge.registerConsentHandler`.
 * @example
 * ```ts
 * bridge.registerConsentHandler(createConsentHandler(host, lookupBefore, (windowId) => applets.get(windowId)?.summary.identity));
 * ```
 */
export function createConsentHandler(
  host: Pick<KernlHost, 'presentConsent'>,
  lookupBefore: LookupBefore,
  resolveApplet: ResolveAppletIdentity,
): (request: ConsentRequest) => void {
  return (request) => {
    const applet = resolveApplet(request.windowId);
    const { event } = request;
    if (!event || !applet) {
      request.resolve(false);
      return;
    }
    void describeAgainstCurrent(event, lookupBefore, applet).then((summary) =>
      host.presentConsent({ summary, resolve: (allowed) => request.resolve(allowed) }),
    );
  };
}

/** The event fields the signing gate reads, as an applet supplied them. */
export type SigningTemplate = Readonly<Partial<EventTemplate>>;

/**
 * Resolves when an applet's write may be signed and rejects with a stable
 * reason when it may not: `denied:consent` when the user refuses,
 * `denied:unknown-applet` for a destructive write from a window the shell did
 * not mount, `denied:signed-out` for a destructive write while nobody is
 * signed in, `invalid:event-kind` when the kind is not a number.
 */
export type SigningConsent = (windowId: string, template: SigningTemplate) => Promise<void>;

/** What {@link createSigningConsent} needs from the shell. */
export interface SigningConsentOptions {
  readonly host: Pick<KernlHost, 'presentConsent'>;
  readonly lookupBefore: LookupBefore;
  readonly resolveApplet: ResolveAppletIdentity;
  /** The account that will sign, for the before lookup; undefined while nobody is signed in. */
  readonly pubkey: () => string | undefined;
}

function draftOf(template: SigningTemplate, kind: number, pubkey: string): NostrEvent {
  return {
    id: '',
    sig: '',
    pubkey,
    kind,
    created_at: template.created_at ?? 0,
    tags: Array.isArray(template.tags) ? template.tags : [],
    content: typeof template.content === 'string' ? template.content : '',
  };
}

/**
 * The consent gate kernl puts in front of every signature it makes for an
 * applet.
 *
 * Routine kinds pass without a prompt. A destructive kind (see
 * {@link isDestructiveKind}) is described against the account's current
 * version, from the event store or the network (see {@link lookupReplaceable}),
 * and put to the user through
 * `host.presentConsent`; the gate waits for the answer and nothing is signed
 * unless it is yes. The summary's `event` is the unsigned draft: its `id` and
 * `sig` are empty because signing has not happened yet.
 *
 * @param options - Host, before lookup, window-to-applet lookup and the signing pubkey.
 * @returns The gate for `createAuthHooks` and the outbox service.
 * @example
 * ```ts
 * const consent = createSigningConsent({ host, lookupBefore: lookupReplaceable(store), resolveApplet, pubkey: () => accounts.active?.pubkey });
 * await consent('applet-1', { kind: 0, content: '{"name":"bob"}', tags: [] }); // asks the user first
 * ```
 */
export function createSigningConsent(options: SigningConsentOptions): SigningConsent {
  return async (windowId, template) => {
    const { kind } = template;
    if (typeof kind !== 'number') throw new Error('invalid:event-kind');
    if (!isDestructiveKind(kind)) return;
    const applet = options.resolveApplet(windowId);
    if (!applet) throw new Error('denied:unknown-applet');
    const pubkey = options.pubkey();
    if (pubkey === undefined) throw new Error('denied:signed-out');
    const summary = await describeAgainstCurrent(draftOf(template, kind, pubkey), options.lookupBefore, applet);
    const allowed = await new Promise<boolean>((resolve) => options.host.presentConsent({ summary, resolve }));
    if (!allowed) throw new Error('denied:consent');
  };
}
