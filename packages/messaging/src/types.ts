import type {
  DmConversationPage,
  DmConversationQuery,
  DmMessage,
  DmMessagePage,
  DmMessageQuery,
  DmOk,
  DmSendRequest,
  DmSendResult,
  DmStatus,
  DmSubscribeRequest,
  DmSubscription,
} from '@napplet/core';

/**
 * The backend contract a provider exposes. Structurally identical to kehto's
 * `DmAdapter` so a provider's backend can be handed to `createDmService`
 * without translation, while keeping this package free of a kehto dependency.
 */
export interface MessagingBackend {
  status(): Promise<DmStatus> | DmStatus;
  conversations(query?: DmConversationQuery): Promise<DmConversationPage> | DmConversationPage;
  messages(query: DmMessageQuery): Promise<DmMessagePage> | DmMessagePage;
  send(request: DmSendRequest): Promise<DmSendResult>;
  subscribe(request: DmSubscribeRequest, onMessage: (message: DmMessage) => void): Promise<DmSubscription> | DmSubscription;
  unsubscribe(subscriptionId: string): Promise<DmOk> | DmOk;
  close?(): void;
}

/** How much a provider protects message content and metadata. Stated, never ranked. */
export interface SecurityProperties {
  /** Compromise of today's keys does not reveal yesterday's messages. */
  readonly forwardSecrecy: boolean;
  /** The session heals after a key compromise once both parties exchange messages. */
  readonly postCompromiseSecurity: boolean;
  /** How much an observer of the network learns about who talks to whom and when. */
  readonly metadataProtection: 'none' | 'partial' | 'strong';
  /** The correspondent must use a client that speaks this provider. */
  readonly requiresSameClient: boolean;
  /** Conversations with more than two participants are supported. */
  readonly groups: boolean;
  /** Where the protocol is specified, for the docs. Not shown in the public UI. */
  readonly specification?: string;
  /** The provider is still changing and may lose history between versions. */
  readonly experimental: boolean;
}

/** Why a provider cannot currently be used. */
export type ProviderAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

/** A pluggable private-messaging implementation. */
export interface MessagingProvider {
  /** Stable identifier used as the conversation-id prefix (`private:`, `legacy:`). */
  readonly id: string;
  /** User-facing name. No protocol vocabulary. */
  readonly name: string;
  /** One sentence for the picker. */
  readonly description: string;
  readonly properties: SecurityProperties;
  /** Whether the provider can run in this shell right now. */
  availability(): ProviderAvailability;
  /** Build the backend. Called once per enable; the registry owns the instance. */
  createBackend(): MessagingBackend;
}

/** A provider plus its registry state. */
export interface ProviderEntry {
  readonly provider: MessagingProvider;
  readonly enabled: boolean;
  readonly availability: ProviderAvailability;
}

/** Persisted registry preferences. */
export interface MessagingPreferences {
  readonly enabled: readonly string[];
  /** Provider used when a send names no provider and the recipient has no history. */
  readonly defaultProvider?: string;
}

/** Registry of providers; the shell holds exactly one. */
export interface MessagingRegistry {
  register(provider: MessagingProvider): void;
  list(): readonly ProviderEntry[];
  get(id: string): ProviderEntry | undefined;
  /** Enable a provider. Throws `unavailable:<reason>` when it cannot run. */
  enable(id: string): void;
  disable(id: string): void;
  setDefault(id: string): void;
  preferences(): MessagingPreferences;
  /** One backend that spans every enabled provider, for the NAP `dm` service. */
  composite(): MessagingBackend;
  /** Close every backend. */
  close(): void;
}
