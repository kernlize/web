import {
  createGroupMessagesProvider,
  createLegacyMessagesProvider,
  createMessagingRegistry,
  createPrivateMessagesProvider,
  createRatchetMessagesProvider,
  type MessagingBackend,
  type MessagingProvider,
  type MessagingRegistry,
  type MessagingRegistryOptions,
  type ProviderAvailability,
  type ProviderDeps,
  type SavedMessagingPreferences,
} from '@kernlize/messaging';
import type { ISigner } from 'applesauce-signers';
import type { StorageLike } from '../types.js';
import type { MessagingBackendFactories } from './backend-factories.js';
import { createNamespacedStore } from '../persistence/store.js';
import { MESSAGING_UNAVAILABLE_REASONS, signerAvailability, type MessagingEncryption } from './availability.js';

const STORAGE_KEY = 'messaging:v1';

/**
 * What is switched on for someone who has never chosen: the two providers that reach anyone with
 * an account, so a first message can be read and answered. The others publish something about
 * the account when they start, so they wait for the user to switch them on (D-016, D-018).
 */
const FIRST_RUN: SavedMessagingPreferences = Object.freeze({ enabled: Object.freeze(['private', 'legacy']) });

/** Options for {@link createDefaultMessaging}. */
export interface DefaultMessagingOptions {
  readonly storage: StorageLike;
  /** Backend constructors; a provider without one stays unavailable. */
  readonly backends?: MessagingBackendFactories;
  /**
   * The active account's signer, read on every availability check. When given,
   * `private`, `ratchet` and `group` are available only while it has `nip44` and
   * `legacy` only while it has `nip04`, whichever backend is supplied for them.
   */
  readonly signer?: () => ISigner | undefined;
  /** Puts the reply question to the user; see `MessagingRegistryOptions.askReply`. */
  readonly askReply?: MessagingRegistryOptions['askReply'];
}

/**
 * One provider a registry is built with: its description, the encryption it needs, and either its
 * backend or why it cannot run without one.
 */
export type RegisteredProvider = {
  /** Joins the provider's fixed description with the availability check and backend the registry injects. */
  readonly describe: (deps: ProviderDeps) => MessagingProvider;
  /** What the active signer must offer for the provider to run. */
  readonly encryption: MessagingEncryption;
} & ({ readonly backend: () => MessagingBackend } | { readonly missing: string });

/** Options for {@link createProviderMessaging}. */
export interface ProviderMessagingOptions {
  readonly storage: StorageLike;
  /** The providers to register, in their first-run order. */
  readonly providers: readonly RegisteredProvider[];
  /** What the active identity's signer can encrypt, read on every availability check; see {@link DefaultMessagingOptions.signer}. */
  readonly signer?: () => Pick<ISigner, MessagingEncryption> | undefined;
  /** Puts the reply question to the person; see `MessagingRegistryOptions.askReply`. */
  readonly askReply?: MessagingRegistryOptions['askReply'];
}

function availabilityFor(provider: RegisteredProvider, signer: ProviderMessagingOptions['signer']): () => ProviderAvailability {
  if ('missing' in provider) return () => ({ available: false, reason: provider.missing });
  if (signer) return () => signerAvailability(signer(), provider.encryption);
  return () => ({ available: true });
}

function depsFor(provider: RegisteredProvider, signer: ProviderMessagingOptions['signer']): ProviderDeps {
  const available = availabilityFor(provider, signer);
  return {
    available,
    createBackend(): MessagingBackend {
      const availability = available();
      if (!availability.available) throw new Error(`unavailable:${availability.reason}`);
      return (provider as { readonly backend: () => MessagingBackend }).backend();
    },
  };
}

/**
 * A messaging registry over the providers given, with preferences persisted at
 * `kernl:messaging:v1` and `private` and `legacy` switched on for someone who has never chosen.
 * A provider that is not given is not listed; one given without a backend is listed as unavailable.
 *
 * @param options - Storage, the providers, the active signer and the reply question.
 * @returns A `MessagingRegistry` with each provider registered in the order given.
 * @example
 * ```ts
 * const messaging = createProviderMessaging({
 *   storage: localStorage,
 *   providers: [{ describe: createPrivateMessagesProvider, encryption: 'nip44', backend: () => createMemoryBackend() }],
 * });
 * messaging.list().map((entry) => entry.provider.id); // ['private']
 * ```
 */
export function createProviderMessaging(options: ProviderMessagingOptions): MessagingRegistry {
  const store = createNamespacedStore(options.storage, 'kernl');
  const registry = createMessagingRegistry({
    preferences: store.getJson<SavedMessagingPreferences | null>(STORAGE_KEY, null) ?? FIRST_RUN,
    ...(options.askReply ? { askReply: options.askReply } : {}),
    onChange: (next) => store.setJson(STORAGE_KEY, next),
  });
  for (const provider of options.providers) registry.register(provider.describe(depsFor(provider, options.signer)));
  return registry;
}

/**
 * The shell's messaging registry with kernl's four providers registered and
 * preferences persisted at `kernl:messaging:v1`.
 *
 * `createKernl` passes the account-signer backends for all four providers
 * and the active account's signer, so each follows the account:
 * `sign-in-required` while nobody is signed in, `signer-cannot-encrypt` while
 * the signer lacks the encryption the format needs. A provider given no
 * backend stays unavailable: `no-runtime` for `ratchet` and `group`, `sign-in-required`
 * for the others. The shell describes, it does not pretend.
 *
 * The providers start in the order private, legacy, ratchet, group, with
 * `private` and `legacy` switched on for someone who has never chosen; each
 * starts as soon as an account that can run it signs in. The user's own
 * choices, order, reply rule and per-person answers are saved and win.
 *
 * @param options - Storage, backend constructors, the active signer and the reply question.
 * @returns A `MessagingRegistry`.
 * @example
 * ```ts
 * const messaging = createDefaultMessaging({ storage: localStorage });
 * messaging.get('private')?.availability; // { available: false, reason: 'sign-in-required' }
 * messaging.get('ratchet')?.availability; // { available: false, reason: 'no-runtime' }
 * messaging.get('group')?.availability; // { available: false, reason: 'no-runtime' }
 * ```
 */
export function createDefaultMessaging(options: DefaultMessagingOptions): MessagingRegistry {
  const backends = options.backends ?? {};
  const listed = (describe: RegisteredProvider['describe'], encryption: MessagingEncryption, backend: (() => MessagingBackend) | undefined, missing: string): RegisteredProvider => (backend ? { describe, encryption, backend } : { describe, encryption, missing });
  const { signInRequired, noRuntime } = MESSAGING_UNAVAILABLE_REASONS;
  // The storage, signer and reply question pass through as they are; the backends become the providers.
  return createProviderMessaging({
    ...options,
    providers: [
      listed(createPrivateMessagesProvider, 'nip44', backends.private, signInRequired),
      listed(createLegacyMessagesProvider, 'nip04', backends.legacy, signInRequired),
      listed(createRatchetMessagesProvider, 'nip44', backends.ratchet, noRuntime),
      listed(createGroupMessagesProvider, 'nip44', backends.group, noRuntime),
    ],
  });
}
