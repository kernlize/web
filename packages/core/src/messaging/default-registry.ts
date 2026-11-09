import {
  createGroupMessagesProvider,
  createLegacyMessagesProvider,
  createMessagingRegistry,
  createPrivateMessagesProvider,
  createRatchetMessagesProvider,
  type MessagingBackend,
  type MessagingPreferences,
  type MessagingRegistry,
  type ProviderAvailability,
  type ProviderDeps,
} from '@kernlize/messaging';
import type { ISigner } from 'applesauce-signers';
import type { MessagingBackendFactories, StorageLike } from '../types.js';
import { createNamespacedStore } from '../persistence/store.js';
import { MESSAGING_UNAVAILABLE_REASONS, signerAvailability, type MessagingEncryption } from './availability.js';

const STORAGE_KEY = 'messaging:v1';

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
}

const ENCRYPTION: Readonly<Record<keyof MessagingBackendFactories, MessagingEncryption>> = { private: 'nip44', legacy: 'nip04', ratchet: 'nip44', group: 'nip44' };

function availabilityFor(id: keyof MessagingBackendFactories, options: DefaultMessagingOptions): () => ProviderAvailability {
  const factory = options.backends?.[id];
  const { signer } = options;
  if (factory && signer) return () => signerAvailability(signer(), ENCRYPTION[id]);
  if (factory) return () => ({ available: true });
  const reason = id === 'ratchet' || id === 'group' ? MESSAGING_UNAVAILABLE_REASONS.noRuntime : MESSAGING_UNAVAILABLE_REASONS.signInRequired;
  return () => ({ available: false, reason });
}

function depsFor(id: keyof MessagingBackendFactories, options: DefaultMessagingOptions): ProviderDeps {
  const available = availabilityFor(id, options);
  const factory = options.backends?.[id] as () => MessagingBackend;
  return {
    available,
    createBackend(): MessagingBackend {
      const availability = available();
      if (!availability.available) throw new Error(`unavailable:${availability.reason}`);
      return factory();
    },
  };
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
 * @param options - Storage, backend constructors and the active signer.
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
  const store = createNamespacedStore(options.storage, 'kernl');
  const preferences = store.getJson<MessagingPreferences | null>(STORAGE_KEY, null);
  const registry = createMessagingRegistry({
    ...(preferences ? { preferences } : {}),
    onChange: (next) => store.setJson(STORAGE_KEY, next),
  });
  registry.register(createPrivateMessagesProvider(depsFor('private', options)));
  registry.register(createLegacyMessagesProvider(depsFor('legacy', options)));
  registry.register(createRatchetMessagesProvider(depsFor('ratchet', options)));
  registry.register(createGroupMessagesProvider(depsFor('group', options)));
  return registry;
}
