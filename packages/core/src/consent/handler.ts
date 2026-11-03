import type { EventStore } from 'applesauce-core';
import type { ConsentRequest } from '@kehto/runtime';
import type { EventTemplate, NostrEvent } from '@napplet/core';
import type { AppletIdentity, ConsentSummary, KernlHost } from '../types.js';
import { describeChange, isDestructiveKind } from './describe-change.js';

/** Finds the current version of a replaceable event so the summary can show a diff. */
export type LookupBefore = (kind: number, pubkey: string, identifier?: string) => NostrEvent | undefined;

/** Maps a window to the verified applet running in it. */
export type ResolveAppletIdentity = (windowId: string) => AppletIdentity | undefined;

/**
 * A {@link LookupBefore} over the shell's event store.
 *
 * @param store - The event store that holds the current replaceable events.
 * @returns A lookup for {@link createConsentHandler}.
 * @example
 * ```ts
 * createConsentHandler(host, lookupReplaceable(eventStore), resolveApplet);
 * ```
 */
export function lookupReplaceable(store: Pick<EventStore, 'getReplaceable'>): LookupBefore {
  return (kind, pubkey, identifier) => store.getReplaceable(kind, pubkey, identifier);
}

function identifierOf(event: NostrEvent): string | undefined {
  const tag = event.tags.find((entry) => entry[0] === 'd');
  return tag?.[1];
}

function describeAgainstCurrent(event: NostrEvent, lookupBefore: LookupBefore, applet: AppletIdentity): ConsentSummary {
  return describeChange(event, lookupBefore(event.kind, event.pubkey, identifierOf(event)), applet);
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
    host.presentConsent({
      summary: describeAgainstCurrent(event, lookupBefore, applet),
      resolve: (allowed) => request.resolve(allowed),
    });
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
 * version from the event store and put to the user through
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
    const summary = describeAgainstCurrent(draftOf(template, kind, pubkey), options.lookupBefore, applet);
    const allowed = await new Promise<boolean>((resolve) => options.host.presentConsent({ summary, resolve }));
    if (!allowed) throw new Error('denied:consent');
  };
}
