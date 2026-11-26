/**
 * The three samples this package builds from one page, which kernl.run's preview
 * loads through `previewPreset` (D-070).
 *
 * Owner's decisions on #131: publishes and the flood go through OUTBOX
 * instead of `relay`; `link` and `torrent` are optional on Notes and Pulse, and
 * `intent` is optional on Profiles so it can receive profile requests.
 *
 * Pure: `vite.config.ts` reads it for each build's manifest and the page reads
 * it for its buttons, so it imports nothing.
 */
export interface SampleSpec {
  /** The build mode, the manifest's `d` tag and the shipped file's name. */
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly blurb: string;
  readonly requires: readonly string[];
  readonly optional: readonly string[];
  readonly topics: readonly string[];
  /** Conventions it accepts from other applets, such as `napplet:profile/open`. */
  readonly accepts: readonly string[];
  /** Extra buttons, by action id, that only this sample shows. */
  readonly extras: readonly string[];
}

export const SAMPLES: readonly SampleSpec[] = [
  {
    name: 'notes',
    title: 'Notes',
    description:
      'Write short notes and publish them to your network. Every publish and every deletion is shown to you before it happens.',
    blurb: 'Publishing, deleting and the consent dialog.',
    requires: ['outbox', 'identity', 'intent'],
    optional: ['notify', 'storage', 'config', 'link', 'torrent'],
    topics: ['writing', 'social'],
    accepts: [],
    extras: [],
  },
  {
    name: 'pulse',
    title: 'Pulse',
    description:
      'A live view of what your connections are up to. Reads from the network constantly, which is exactly what the guard is for.',
    blurb: 'Flooding the shell and watching the guard respond.',
    requires: ['outbox'],
    optional: ['notify', 'media', 'resource', 'link', 'torrent'],
    topics: ['social', 'guard'],
    accepts: [],
    extras: ['contacts', 'servers', 'vanish'],
  },
  {
    name: 'profiles',
    title: 'Profiles',
    description:
      "Shows a person's profile when another applet asks for one. When an applet you run wants a profile opened, the shell offers this one to take it.",
    blurb: 'Taking requests that other applets hand over.',
    requires: [],
    optional: ['notify', 'intent'],
    topics: ['social', 'people'],
    accepts: ['napplet:profile/open'],
    extras: [],
  },
];

/** The spec for a build mode; the dev server's own mode falls back to the first sample. */
export function sampleFor(mode: string): SampleSpec {
  return SAMPLES.find((spec) => spec.name === mode) ?? (SAMPLES[0] as SampleSpec);
}

/** The manifest archetypes a spec declares: one per accepted convention, carrying a `pubkey`. */
export function archetypesOf(spec: SampleSpec): { slug: string; convention: string; params: string[] }[] {
  return spec.accepts.map((convention) => ({
    slug: convention.slice('napplet:'.length).split('/')[0] as string,
    convention,
    params: ['pubkey'],
  }));
}
