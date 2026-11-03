import { createCompositeBackend } from './composite.js';
import type {
  MessagingBackend,
  MessagingPreferences,
  MessagingProvider,
  MessagingRegistry,
  ProviderEntry,
} from './types.js';

/** Options for {@link createMessagingRegistry}. */
export interface MessagingRegistryOptions {
  /** Preferences saved by an earlier session. Providers named here are enabled as they are registered. */
  readonly preferences?: MessagingPreferences;
  /** Called with a frozen snapshot after every change to the preferences. */
  readonly onChange?: (preferences: MessagingPreferences) => void;
}

/**
 * Create the shell's provider registry.
 *
 * The registry owns one backend per enabled provider and hands out a single
 * composite backend for the NAP `dm` service. Preferences restored at
 * construction are applied lazily: a provider that appears in the saved
 * `enabled` list is enabled the moment it is registered, if it is available;
 * an unavailable one stays disabled and reports why through `list()`.
 *
 * `close()` closes every backend without touching the preferences, so a
 * shutdown never erases what the user chose. A closed registry is not reused.
 *
 * @param options - Saved preferences and a change listener.
 * @returns A `MessagingRegistry`.
 * @example
 * ```ts
 * const registry = createMessagingRegistry({
 *   preferences: load(),
 *   onChange: (prefs) => save(prefs),
 * });
 * registry.register(createPrivateMessagesProvider(deps));
 * registry.enable('private');
 * registry.setDefault('private');
 * ```
 */
export function createMessagingRegistry(options: MessagingRegistryOptions = {}): MessagingRegistry {
  const providers = new Map<string, MessagingProvider>();
  const backends = new Map<string, MessagingBackend>();
  const restoring = new Set(options.preferences?.enabled ?? []);
  let restoringDefault = options.preferences?.defaultProvider;
  let defaultProvider: string | undefined;
  let composite: MessagingBackend | undefined;

  const snapshot = (): MessagingPreferences =>
    Object.freeze({
      enabled: Object.freeze([...backends.keys()]),
      ...(defaultProvider === undefined ? {} : { defaultProvider }),
    });

  const notify = (): void => options.onChange?.(snapshot());

  const lookup = (id: string): MessagingProvider => {
    const provider = providers.get(id);
    if (!provider) throw new Error('invalid:unknown-provider');
    return provider;
  };

  const entryFor = (provider: MessagingProvider): ProviderEntry => ({
    provider,
    enabled: backends.has(provider.id),
    availability: provider.availability(),
  });

  const activate = (provider: MessagingProvider): void => {
    const availability = provider.availability();
    if (!availability.available) throw new Error(`unavailable:${availability.reason}`);
    backends.set(provider.id, provider.createBackend());
  };

  const restore = (provider: MessagingProvider): void => {
    if (!restoring.delete(provider.id)) return;
    if (!provider.availability().available) return;
    activate(provider);
    if (restoringDefault === provider.id) {
      defaultProvider = provider.id;
      restoringDefault = undefined;
    }
    notify();
  };

  return {
    register(provider) {
      if (providers.has(provider.id)) throw new Error('invalid:duplicate-provider');
      providers.set(provider.id, provider);
      restore(provider);
    },
    list: () => [...providers.values()].map(entryFor),
    get(id) {
      const provider = providers.get(id);
      return provider && entryFor(provider);
    },
    enable(id) {
      const provider = lookup(id);
      if (backends.has(id)) return;
      activate(provider);
      notify();
    },
    disable(id) {
      lookup(id);
      const backend = backends.get(id);
      if (!backend) return;
      backend.close?.();
      backends.delete(id);
      if (defaultProvider === id) defaultProvider = undefined;
      notify();
    },
    setDefault(id) {
      if (!backends.has(id)) throw new Error('invalid:provider-not-enabled');
      defaultProvider = id;
      restoringDefault = undefined;
      notify();
    },
    preferences: snapshot,
    composite() {
      composite ??= createCompositeBackend(
        () => [...backends].map(([id, backend]) => ({ id, backend })),
        () => defaultProvider,
      );
      return composite;
    },
    close() {
      for (const backend of backends.values()) backend.close?.();
    },
  };
}
