import type { DmSendRequest } from '@napplet/sdk';
import type { Thread } from './threads.js';
import type { PendingSend, ThreadEntry } from './view-model.js';

export function newPendingSend(content: string): PendingSend {
  const clientId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return { clientId, content, at: Date.now(), state: 'sending', stalled: false, problem: '' };
}

export function sendRequest(thread: Thread, pending: PendingSend): DmSendRequest {
  if (thread.kind === 'group') {
    return { conversationId: thread.conversationIds[0], recipients: [], content: pending.content };
  }
  // No conversation id on purpose: the shell decides how a direct message travels.
  return {
    recipients: thread.peers.map((peer) => peer.pubkey),
    content: pending.content,
    clientMessageId: pending.clientId,
  };
}

/** Drop the oldest waiting bubble that the shell has just confirmed by echo. */
export function retirePending(entry: ThreadEntry, content: string): void {
  const index = entry.pending.findIndex((send) => send.state === 'sending' && send.content === content);
  if (index >= 0) entry.pending.splice(index, 1);
}
