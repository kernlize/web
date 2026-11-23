import { createCommonService } from '@kehto/services';
import { publishAccepted } from '../applesauce/relay-backend.js';
import { selectRelayTier } from '../applesauce/relay-hooks.js';
import { shellRelayOrigins } from '../kernl-services.js';
import type { People } from '../people/person.js';
import type { Profiles } from '../profiles/profiles.js';
import { createCommonActions } from '../social/common-actions.js';
import type { KernlModule } from './module.js';

const FOLLOWS = 3;

/**
 * The `common` domain: profile lookups and social actions for applets (NAP-COMMON). Writes are
 * signed through the kernel's consent and published to the tier for their kind (D-035).
 *
 * @returns The module. It needs the kernel's `profiles` and `people`.
 * @example
 * ```ts
 * createKernl({ host, modules: [themeModule(), socialModule()] });
 * ```
 */
export function socialModule(): KernlModule<'social'> {
  return {
    id: 'social',
    requires: ['profiles', 'people'],
    setup(context) {
      const people = context.use<People>('people');
      const actions = createCommonActions({
        store: context.eventStore,
        profiles: context.use<Profiles>('profiles'),
        locate: people.locate,
        pubkey: () => context.identity.pubkey(),
        sign: (windowId, template) => context.sign(windowId, template),
        publish: (event) => publishAccepted(context.pool, selectRelayTier(context.tiers, [{ kinds: [event.kind] }]), event),
        loadFollows: (pubkey) => context.loadReplaceable({ kind: FOLLOWS, pubkey }),
      });
      return { services: { common: createCommonService({ planRelays: () => shellRelayOrigins(context.tiers), ...actions }) } };
    },
  };
}
