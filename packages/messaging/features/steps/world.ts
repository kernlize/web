import type {
  DmConversationPage,
  DmMessage,
  DmMessagePage,
  DmOk,
  DmSendResult,
  DmStatus,
} from '@napplet/core';
import type {
  EnabledBackend,
  MemoryBackend,
  MessagingBackend,
  MessagingPreferences,
  MessagingProvider,
  MessagingRegistry,
  ProviderAvailability,
} from '@kernlize/messaging';

export interface FakeProvider {
  availability: ProviderAvailability;
  created: number;
  closed: boolean;
  closable: boolean;
}

export interface MessagingState {
  error?: Error;
  registry?: MessagingRegistry;
  notifications: MessagingPreferences[];
  fakes: Map<string, FakeProvider>;
  memory: Map<string, MessagingBackend>;
  enabled: EnabledBackend[];
  defaultId?: string;
  composite?: MessagingBackend;
  status?: DmStatus;
  conversationPage?: DmConversationPage;
  messagePage?: DmMessagePage;
  sendResult?: DmSendResult;
  delivered: DmMessage[];
  subscriptionId?: string;
  unsubscribeResult?: DmOk;
  backend?: MemoryBackend;
  provider?: MessagingProvider;
  available: ProviderAvailability;
  injected?: MessagingBackend;
}

export interface MessagingWorld {
  messaging?: MessagingState;
}

export function state(world: MessagingWorld): MessagingState {
  world.messaging ??= {
    notifications: [],
    fakes: new Map(),
    memory: new Map(),
    enabled: [],
    delivered: [],
    available: { available: true },
  };
  return world.messaging;
}

export function list(text: string): string[] {
  return text === '' ? [] : text.split(', ');
}

export async function attempt(world: MessagingWorld, action: () => unknown): Promise<void> {
  const s = state(world);
  try {
    await action();
  } catch (error) {
    s.error = error as Error;
  }
}
