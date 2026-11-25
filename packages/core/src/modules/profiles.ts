import { lookupRelaysOf, type KernlModule } from '@kernlize/kernel';
import { createProfiles, type Profiles, type ProfilesOptions } from '../profiles/profiles.js';

/**
 * People's profiles, read from the shell's store and loaded on demand through the shell's loader:
 * `kernl.profiles`. The session is labelled by the signed-in identity's profile, and the messages
 * applet's conversations by their people's, only while it is loaded.
 *
 * @param options - How long an unwatched card keeps its subscription open.
 * @returns The module; its api is `Profiles`.
 * @example
 * ```ts
 * const kernl = createKernl({ host, modules: [profilesModule()] });
 * kernl.profiles.card$(pubkey).subscribe(render);
 * ```
 */
export function profilesModule(options: Pick<ProfilesOptions, 'keepAliveMs'> = {}): KernlModule<'profiles', Profiles> {
  return {
    id: 'profiles',
    setup: (context) => ({
      api: createProfiles({ ...options, store: context.eventStore, load: context.replaceableLoader, lookupRelays: () => lookupRelaysOf(context.tiers.get()) }),
    }),
  };
}
