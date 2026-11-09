/* global $state */
import type { MessagingBackend } from '@kernlize/messaging';

/**
 * Messages that arrived while the user was not looking at them. The count is the shell's own:
 * a provider's unread number never goes down, because nothing tells a provider what was read.
 */
export class UnreadMessages {
  count = $state(0);

  /** Count what arrives from other people until the returned function is called. */
  watch(backend: MessagingBackend, reading: () => boolean): () => void {
    let stopped = false;
    let subscriptionId: string | undefined;
    void (async () => {
      const owner = (await backend.status()).ownerPubkey;
      const subscription = await backend.subscribe({}, (message) => {
        if (message.senderPubkey !== owner && !reading()) this.count += 1;
      });
      if (stopped) void backend.unsubscribe(subscription.subscriptionId);
      else subscriptionId = subscription.subscriptionId;
    })();
    return () => {
      stopped = true;
      if (subscriptionId !== undefined) void backend.unsubscribe(subscriptionId);
    };
  }

  clear(): void {
    this.count = 0;
  }
}
