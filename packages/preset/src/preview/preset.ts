import type { Theme } from '@napplet/nap/theme/types';
import { RelayPool } from 'applesauce-relay';
import type { NostrEvent } from 'applesauce-core/helpers';
import type { BridgeRegistry, TorrentBackend } from '@kernlize/bridges';
import type { KernelBaseOptions, KernlHost, KernlModule, SettingsPrompt } from '@kernlize/kernel';
import { type AccountFileServers, type KernlMultiplayer, cacheModule, catalogModule, directoryModule, downloadsModule, intentsModule, mailboxesModule, messagingModule, peopleModule, profilesModule, settingsModule, socialModule, themeModule } from '@kernlize/modules';
import { stacksModule } from '@kernlize/modules/stacks';
import { createRatchetMessagesBackend, ratchet } from '@kernlize/modules/messaging/ratchet';
import { groups } from '@kernlize/modules/messaging/groups';
import { createMemoryRelays, type MemoryRelays } from '../memory-relays.js';
import { CORRESPONDENT_PROFILES, correspondentProviders } from './correspondents.js';
import { offlineBridgesModule, offlineDownloadsFetch, offlineFilesModule, offlineMultiplayerModule } from './offline.js';

/** One sample applet the preview serves: its signed manifest, and the bytes its `x` tag names. */
export interface PreviewSample {
  /** The signed manifest (kind 35129), seeded onto the page's relays as if it were published. */
  readonly manifest: NostrEvent;
  /** The artifact as shipped, or a loader read the first time the kernel asks for it. Never hashed here: the kernel verifies it. */
  readonly bytes: Uint8Array | string | (() => Promise<Uint8Array | string>);
}

/** What `@kernlize/applet-samples` writes to `samples.json`. */
export interface ShippedSamples {
  readonly publisher: string;
  /** The publisher's signed profile, so the store names who published the samples. */
  readonly profile?: NostrEvent;
  readonly samples: readonly { readonly name: string; readonly title?: string; readonly manifest: NostrEvent; readonly file: string }[];
  /** Signed stacks (kind 30267) over the samples, so the store's Stacks tab lists something. */
  readonly stacks?: readonly NostrEvent[];
}

/** What {@link previewPreset} takes. */
export interface PreviewPresetOptions {
  /** The samples the store lists and the preview serves. */
  readonly samples?: readonly PreviewSample[];
  /** More signed events to put on the page's relays, such as the samples' publisher's profile. */
  readonly seed?: readonly NostrEvent[];
  /** Seconds since the epoch, for the correspondents' history and replies; the system clock by default. */
  readonly now?: () => number;
  /** How long a correspondent takes to answer, in milliseconds; 900 by default. */
  readonly replyDelayMs?: number;
  /** Theme pushed to applets that hold `theme:read`. */
  readonly theme?: Theme;
  /** The host's settings form, for applets' settings (D-036). */
  readonly presentSettings?: (prompt: SettingsPrompt) => void;
  /** The engine for magnet links, such as one that reaches nobody; without one they are handed to the host's `openLink`. */
  readonly torrent?: TorrentBackend;
}

/** The modules the preview composes, in the order they set up. */
export type PreviewModules = readonly [
  ReturnType<typeof themeModule>,
  ReturnType<typeof profilesModule>,
  ReturnType<typeof peopleModule>,
  ReturnType<typeof socialModule>,
  ReturnType<typeof messagingModule>,
  ReturnType<typeof directoryModule>,
  ReturnType<typeof mailboxesModule>,
  KernlModule<'files', AccountFileServers>,
  ReturnType<typeof settingsModule>,
  ReturnType<typeof catalogModule>,
  ReturnType<typeof stacksModule>,
  ReturnType<typeof intentsModule>,
  KernlModule<'bridges', BridgeRegistry>,
  ReturnType<typeof downloadsModule>,
  KernlModule<'multiplayer', KernlMultiplayer>,
  ReturnType<typeof cacheModule>,
];

/** What `createKernl` takes to run the preview, over the host given. */
export type PreviewKernlOptions = Required<Pick<KernelBaseOptions, 'host' | 'pool' | 'artifactCache'>> & { readonly modules: PreviewModules };

/** The preview's parts, which {@link PreviewPreset.options} puts together for `createKernl`. */
export interface PreviewPreset {
  /** The relays that live in the page; seed more onto them, or read what was published. */
  readonly memory: MemoryRelays;
  /** applesauce's real pool, dialling only `memory`. */
  readonly pool: RelayPool;
  readonly modules: PreviewModules;
  /** No artifact cache: the preview writes nothing to Cache Storage, and its bytes are in memory anyway. */
  artifactCache(): Promise<undefined>;
  /** The samples' bytes by the hash their manifests name; `unavailable:blob` for any other. */
  fetchBlob(sha256: string, servers: readonly string[]): Promise<Uint8Array>;
  /** Everything `createKernl` takes, over the host given with its `fetchBlob` replaced by the preview's. */
  options(host: KernlHost): PreviewKernlOptions;
}

const REPLY_DELAY_MS = 900;
/** The page's relays answer at once, so the ratchet need not wait the library's 10 s for an identity's devices. */
const RATCHET_DISCOVERY = Object.freeze({ fetchMs: 500, fastMs: 100 });
const seconds = (): number => Math.floor(Date.now() / 1000);
const hashOf = (manifest: NostrEvent): string | undefined => manifest.tags.find((tag) => tag[0] === 'x')?.[1];

function blobsOf(samples: readonly PreviewSample[]): PreviewPreset['fetchBlob'] {
  const byHash = new Map(samples.map((sample) => [hashOf(sample.manifest), sample.bytes] as const));
  return async (sha256) => {
    const held = byHash.get(sha256);
    if (held === undefined) throw new Error('unavailable:blob');
    const bytes = typeof held === 'function' ? await held() : held;
    return typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  };
}

function previewModules(options: PreviewPresetOptions): PreviewModules {
  const clock = { now: options.now ?? seconds, replyDelayMs: options.replyDelayMs ?? REPLY_DELAY_MS };
  return [
    themeModule(options.theme),
    profilesModule(),
    peopleModule(),
    socialModule(),
    messagingModule({ providers: [...correspondentProviders(clock), { ...ratchet(), backend: (parts) => createRatchetMessagesBackend({ ...parts, discoveryTimeouts: RATCHET_DISCOVERY }) }, groups()] }),
    directoryModule(),
    mailboxesModule(),
    offlineFilesModule(),
    settingsModule(options.presentSettings),
    catalogModule(),
    stacksModule(),
    intentsModule(),
    offlineBridgesModule(options.torrent),
    downloadsModule({ fetch: offlineDownloadsFetch }),
    offlineMultiplayerModule(),
    cacheModule(),
  ];
}

/**
 * kernl.run's preview: the real kernel and kernl's own modules over parts that live in the page
 * (D-068). The samples' signed manifests and the people's profiles are on relays in memory, the
 * samples' bytes are served by hash for the kernel to verify, Ada and Grace have already written,
 * and download programs, web pages and tool searches are answered or refused without leaving the
 * page. Keyboard shortcuts are left out, as the preview always hid them (D-054).
 *
 * @param options - The samples and other events to seed, the correspondents' clock, and the host's theme, settings form and torrent engine.
 * @returns The preview's parts, and `options(host)` for `createKernl`.
 * @example
 * ```ts
 * const preview = previewPreset({ ...shippedSamples(listing, (file) => loadFile(file)), theme });
 * const kernl = createKernl(preview.options(host));
 * ```
 */
export function previewPreset(options: PreviewPresetOptions = {}): PreviewPreset {
  const samples = options.samples ?? [];
  const memory = createMemoryRelays();
  memory.seed(...CORRESPONDENT_PROFILES, ...samples.map((sample) => sample.manifest), ...(options.seed ?? []));
  const pool = new RelayPool({ WebSocket: memory.WebSocket });
  const modules = previewModules(options);
  const fetchBlob = blobsOf(samples);
  const artifactCache = (): Promise<undefined> => Promise.resolve(undefined);
  return {
    memory,
    pool,
    modules,
    artifactCache,
    fetchBlob,
    options: (host) => ({ host: { ...host, fetchBlob }, pool, artifactCache, modules }),
  };
}

/**
 * The samples as `@kernlize/applet-samples` ships them, with the publisher's profile and stacks to seed.
 *
 * @param shipped - The parsed `samples.json`.
 * @param load - Reads a shipped file, such as `notes.html`, when the kernel first asks for it.
 * @returns The `samples` and `seed` options for {@link previewPreset}.
 * @example
 * ```ts
 * previewPreset(shippedSamples(listing, async (file) => (await fetch(`/samples/${file}`)).text()));
 * ```
 */
export function shippedSamples(shipped: ShippedSamples, load: (file: string) => Promise<Uint8Array | string>): Required<Pick<PreviewPresetOptions, 'samples' | 'seed'>> {
  return {
    samples: shipped.samples.map((sample) => ({ manifest: sample.manifest, bytes: () => load(sample.file) })),
    seed: [...(shipped.profile ? [shipped.profile] : []), ...(shipped.stacks ?? [])],
  };
}
