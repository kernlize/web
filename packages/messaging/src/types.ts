import type {
  DmConversationPage,
  DmConversationQuery,
  DmMessage,
  DmMessagePage,
  DmMessageQuery,
  DmOk,
  DmPeer,
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
  /** Its backend is running. */
  readonly enabled: boolean;
  readonly availability: ProviderAvailability;
}

/**
 * What the shell does when a message would leave through one provider while the person it is
 * for last wrote through another: `ask` the user, use `theirs`, or keep `mine`.
 */
export type ReplyRule = 'ask' | 'theirs' | 'mine';

/** Persisted registry preferences. */
export interface MessagingPreferences {
  /** The providers the user wants on, in their order: those running and those waiting until they can run. */
  readonly enabled: readonly string[];
  /** Every registered provider, the user's first choice first. */
  readonly order: readonly string[];
  /** The first enabled provider in `order`: the one a new conversation uses. */
  readonly defaultProvider?: string;
  readonly reply: ReplyRule;
  /** People for whom the user settled the question, by public key. */
  readonly replyChoices: Readonly<Record<string, Exclude<ReplyRule, 'ask'>>>;
}

/** Preferences as an earlier session saved them; snapshots older than the order carry only `enabled` and `defaultProvider`. */
export type SavedMessagingPreferences = Pick<MessagingPreferences, 'enabled'> & Partial<MessagingPreferences>;

/** The question the shell puts to the user before a reply leaves through a provider the correspondent did not use. */
export interface ReplyPrompt {
  /** Who the message is for. */
  readonly peer: DmPeer;
  /** The provider that person last wrote through. */
  readonly theirs: MessagingProvider;
  /** The provider the message would use otherwise. */
  readonly mine: MessagingProvider;
}

/** The user's answer to a {@link ReplyPrompt}. */
export interface ReplyAnswer {
  readonly use: Exclude<ReplyRule, 'ask'>;
  /** `conversation` settles it for this person, `always` for everyone. */
  readonly remember: 'once' | 'conversation' | 'always';
}

/** Registry of providers; the shell holds exactly one. */
export interface MessagingRegistry {
  register(provider: MessagingProvider): void;
  /** Every provider, in the user's order. */
  list(): readonly ProviderEntry[];
  get(id: string): ProviderEntry | undefined;
  /** Enable a provider. Throws `unavailable:<reason>` when it cannot run. */
  enable(id: string): void;
  disable(id: string): void;
  /** Put an enabled provider first. */
  setDefault(id: string): void;
  /** Reorder the providers; ids left out keep their relative order after the ones named. */
  setOrder(ids: readonly string[]): void;
  setReplyRule(rule: ReplyRule): void;
  /** Forget what the user settled for one person, or for everyone when no key is given. */
  forgetReplyChoice(pubkey?: string): void;
  preferences(): MessagingPreferences;
  /** One backend that spans every enabled provider, for the NAP `dm` service. */
  composite(): MessagingBackend;
  /** Close every backend. */
  close(): void;
}
