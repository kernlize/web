import type { EventStore } from 'applesauce-core';
import type { ConsentRequest } from '@kehto/runtime';
import type { NostrEvent } from '@napplet/core';
import type { AppletIdentity, KernlHost } from '../types.js';
import { describeChange } from './describe-change.js';

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

/**
 * Turn kehto consent requests into host prompts that describe the change.
 *
 * A request without an event (kehto's `firewall-policy` prompt) or from a
 * window the shell does not recognise is refused without asking: kernl never
 * signs for an applet it cannot name, and its guard uses `allow`/`deny`
 * policies, so a firewall prompt is not an expected path.
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
    const identifier = identifierOf(event);
    const before = lookupBefore(event.kind, event.pubkey, identifier);
    host.presentConsent({
      summary: describeChange(event, before, applet),
      resolve: (allowed) => request.resolve(allowed),
    });
  };
}
