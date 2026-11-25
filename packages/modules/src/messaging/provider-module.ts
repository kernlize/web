import type { MessagingBackend } from '@kernlize/messaging';
import type { StorageLike } from '@kernlize/kernel';
import type { RegisteredProvider } from './default-registry.js';
import type { SignerMessagingOptions } from './signer-backend.js';

/** What the messaging module hands a provider to build its backend: the shell's store, pool, tiers and storage, and the active identity. */
export interface ProviderParts extends SignerMessagingOptions {
  readonly storage: StorageLike;
}

/** What a host may set on any provider. */
export interface ProviderOptions {
  /** The backend to run instead of kernl's own over the active identity, such as one the host built. */
  readonly backend?: () => MessagingBackend;
}

/**
 * One provider the messaging module registers, such as `privateDm()`. Each lives in its own file,
 * so a shell that does not list a provider does not load the library behind it.
 */
export interface MessagingProviderModule {
  /** Joins the provider's fixed description with the availability check and backend the registry injects. */
  readonly describe: RegisteredProvider['describe'];
  /** What the active identity's signer must offer for the provider to run. */
  readonly encryption: RegisteredProvider['encryption'];
  /** The provider's id, also its conversation-id prefix. */
  readonly id: string;
  /** Its backend over the shell's parts. */
  readonly backend: (parts: ProviderParts) => MessagingBackend;
}

/**
 * Join a provider's description with the backend a host chose for it, or kernl's own.
 *
 * @param provider - The provider without a backend.
 * @param own - kernl's backend over the shell's parts.
 * @param options - The host's choices for this provider.
 * @returns The provider as the messaging module takes it.
 * @example
 * ```ts
 * const custom = messagingProviderModule({ id: 'private', describe: createPrivateMessagesProvider, encryption: 'nip44' }, createPrivateMessagesBackend, {});
 * ```
 */
export function messagingProviderModule(provider: Omit<MessagingProviderModule, 'backend'>, own: (parts: ProviderParts) => MessagingBackend, options: ProviderOptions): MessagingProviderModule {
  const { backend } = options;
  return { ...provider, backend: backend ? () => backend() : own };
}
