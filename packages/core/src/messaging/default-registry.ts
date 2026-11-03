import {
  createLegacyMessagesProvider,
  createMessagingRegistry,
  createPrivateMessagesProvider,
  createRatchetMessagesProvider,
  type MessagingBackend,
  type MessagingPreferences,
  type MessagingRegistry,
  type ProviderAvailability,
  type ProviderDeps,
} from '@kernl/messaging';
import type { MessagingBackendFactories, StorageLike } from '../types.js';
import { createNamespacedStore } from '../persistence/store.js';

const STORAGE_KEY = 'messaging:v1';

/**
 * Why each provider is unavailable until the host supplies its backend.
 *
 * @example
 * ```ts
 * MESSAGING_UNAVAILABLE_REASONS.private; // 'needs-local-key-signer'
 * ```
 */
export const MESSAGING_UNAVAILABLE_REASONS: Readonly<Record<keyof MessagingBackendFactories, string>> = Object.freeze({
  private: 'needs-local-key-signer',
  legacy: 'not-implemented',
  ratchet: 'no-runtime',
});

/** Options for {@link createDefaultMessaging}. */
export interface DefaultMessagingOptions {
  readonly storage: StorageLike;
  /** Backend constructors the host can supply; a missing one leaves the provider unavailable. */
  readonly backends?: MessagingBackendFactories;
}

function depsFor(id: keyof MessagingBackendFactories, factory: (() => MessagingBackend) | undefined): ProviderDeps {
  const reason = MESSAGING_UNAVAILABLE_REASONS[id];
  const available = (): ProviderAvailability => (factory ? { available: true } : { available: false, reason });
  return {
    available,
    createBackend() {
      if (!factory) throw new Error(`unavailable:${reason}`);
      return factory();
    },
  };
}

/**
 * The shell's messaging registry with kernl's three providers registered and
 * preferences persisted at `kernl:messaging:v1`.
 *
 * kehto's sealed-message adapter wants the owner's raw secret key, which kernl
 * never holds outside an applesauce signer, so `private` is unavailable with
 * reason `needs-local-key-signer` until the host supplies a backend built from
 * a signer it controls. `legacy` is `not-implemented` and `ratchet` is
 * `no-runtime` for the same reason: the shell describes, it does not pretend.
 *
 * @param options - Storage and optional backend constructors.
 * @returns A `MessagingRegistry`.
 * @example
 * ```ts
 * const messaging = createDefaultMessaging({ storage: localStorage });
 * messaging.get('private')?.availability; // { available: false, reason: 'needs-local-key-signer' }
 * ```
 */
export function createDefaultMessaging(options: DefaultMessagingOptions): MessagingRegistry {
  const store = createNamespacedStore(options.storage, 'kernl');
  const preferences = store.getJson<MessagingPreferences | null>(STORAGE_KEY, null);
  const registry = createMessagingRegistry({
    ...(preferences ? { preferences } : {}),
    onChange: (next) => store.setJson(STORAGE_KEY, next),
  });
  const backends = options.backends ?? {};
  registry.register(createPrivateMessagesProvider(depsFor('private', backends.private)));
  registry.register(createLegacyMessagesProvider(depsFor('legacy', backends.legacy)));
  registry.register(createRatchetMessagesProvider(depsFor('ratchet', backends.ratchet)));
  return registry;
}
