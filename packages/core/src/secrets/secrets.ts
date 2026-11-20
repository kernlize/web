import type { StorageLike } from '../types.js';

/** How a secrets provider keeps what it is given, so the shell can say so truthfully. */
export interface SecretsDescription {
  /** What the provider is, in a few plain words: "this browser", "the system keychain". */
  readonly label: string;
  /**
   * `plain`: kept as typed, readable by anything that can read the shell's storage.
   * `protected`: kept by something that guards it, such as a keychain, an extension or a service that asks before it answers.
   * `session`: kept in memory only, gone when the shell closes.
   */
  readonly keeps: 'plain' | 'protected' | 'session';
}

/**
 * Where the shell keeps what must not be shown again: the passwords and keys of the
 * services it signs in to for the person. It is one small contract so a host can put
 * its own keeper behind it: a browser extension, a service running on the device, the
 * platform's keychain in a native shell.
 *
 * Names are the shell's own, such as `download:transmission:password`; a provider keeps
 * them apart from anything else it holds and never interprets them. Every method may
 * reject with `unavailable:secrets` (the keeper cannot be reached) or `denied:secrets`
 * (it, or the person, said no); a caller treats both as "not available now", never as
 * "there is no secret". Identity keys are not kept here: they live in signers (SOUL opinion 1).
 */
export interface SecretsProvider {
  readonly description: SecretsDescription;
  /** The secret under a name, or undefined when there is none. */
  get(name: string): Promise<string | undefined>;
  /** Keep a secret under a name, replacing any that was there. */
  set(name: string, value: string): Promise<void>;
  /** Forget the secret under a name; forgetting one that is not there succeeds. */
  delete(name: string): Promise<void>;
}

const STORAGE_PREFIX = 'kernl:secrets:v1:';

/**
 * The default provider: secrets kept in the host's storage, as typed. It protects nothing
 * beyond what the storage itself does, and says so (`keeps: 'plain'`); a host that can do
 * better passes its own provider as `KernlOptions.secrets`.
 *
 * @param storage - The host's storage; each secret is one key under `kernl:secrets:v1:`.
 * @returns A provider over that storage; `set` rejects `unavailable:secrets` when the storage refuses the write.
 * @example
 * ```ts
 * const secrets = createStorageSecrets(localStorage);
 * await secrets.set('download:sabnzbd:apiKey', 'k1');
 * await secrets.get('download:sabnzbd:apiKey'); // 'k1'
 * ```
 */
export function createStorageSecrets(storage: StorageLike): SecretsProvider {
  return {
    description: { label: 'this device', keeps: 'plain' },
    get: async (name) => storage.getItem(STORAGE_PREFIX + name) ?? undefined,
    async set(name, value) {
      try {
        storage.setItem(STORAGE_PREFIX + name, value);
      } catch {
        // Storage that is full or switched off refuses the write; the reason says only that, never the value.
        throw new Error('unavailable:secrets');
      }
    },
    delete: async (name) => storage.removeItem(STORAGE_PREFIX + name),
  };
}

/**
 * A provider that keeps secrets in memory only, for a host that wants nothing written
 * down and for a shell that is tried without leaving a trace.
 *
 * @returns A provider whose secrets end with it.
 * @example
 * ```ts
 * const kernl = createKernl({ host, secrets: createMemorySecrets() });
 * ```
 */
export function createMemorySecrets(): SecretsProvider {
  const held = new Map<string, string>();
  return {
    description: { label: 'this session', keeps: 'session' },
    get: async (name) => held.get(name),
    set: async (name, value) => void held.set(name, value),
    delete: async (name) => void held.delete(name),
  };
}
