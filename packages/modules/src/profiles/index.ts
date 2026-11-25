/**
 * `@kernlize/modules/profiles`: the profiles module on its own, so a host that lists it bundles only what it needs (D-068).
 *
 * @packageDocumentation
 */
export { profilesModule } from '../modules/profiles.js';
export { createProfiles, toProfileCard, type ProfileCard, type ProfileLoader, type ProfilePointer, type Profiles, type ProfilesOptions } from '../profiles/profiles.js';
