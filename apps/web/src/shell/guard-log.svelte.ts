/* global $state, $derived, $effect */
import type { GuardEvent, OpClass } from '@kernl/guard';

const KEEP = 50;

const OP_WORDS: Readonly<Record<OpClass, string>> = {
  'relay:subscribe': 'network reads',
  'relay:publish': 'publishes',
  'relay:publish:delete': 'deletions',
  'outbox:subscribe': 'network reads',
  'outbox:publish': 'publishes',
  'resource:bytes': 'web fetches',
  'storage:write': 'storage writes',
  'dm:send': 'messages',
  'intent:invoke': 'applet launches',
  control: 'control messages',
  generic: 'requests',
};

const VERBS: Readonly<Record<GuardEvent['disposition'], string>> = {
  pass: 'was allowed',
  defer: 'went over its allowance',
  reject: 'went over a limit',
  quarantine: 'was quarantined',
  flag: 'was flagged',
};

function because(event: GuardEvent): string {
  const { reason, opClass } = event;
  if (reason === 'flood:burst') return 'a burst of messages';
  if (reason === 'flood:queue-full' || reason === 'defer:queue-full') return 'its queue is full';
  if (reason === 'flood:quarantine') return 'it kept flooding the shell';
  if (reason === 'flood:hidden-resource') return 'too many web fetches while hidden';
  if (reason.startsWith('rate:')) return `too many ${OP_WORDS[opClass]}`;
  if (reason.startsWith('size:')) return `an oversized request (${OP_WORDS[opClass]})`;
  if (reason.startsWith('prompt:')) return 'it needs your answer first';
  return reason;
}

/** "Applet Notes went over its allowance: too many network reads". kernl reports these; the rates that refuse requests run inside the runtime. */
export function describeGuardEvent(event: GuardEvent, title: string): string {
  return `Applet ${title} ${VERBS[event.disposition]}: ${because(event)}`;
}

export class GuardLog {
  events = $state.raw<readonly GuardEvent[]>([]);
  quarantined = $state.raw<ReadonlySet<string>>(new Set());
  total = $state(0);

  push(event: GuardEvent): void {
    this.events = [event, ...this.events].slice(0, KEEP);
    this.total += 1;
    if (event.disposition === 'quarantine' && !this.quarantined.has(event.windowId)) {
      this.quarantined = new Set([...this.quarantined, event.windowId]);
    }
  }

  released(windowId: string): void {
    if (!this.quarantined.has(windowId)) return;
    const next = new Set(this.quarantined);
    next.delete(windowId);
    this.quarantined = next;
  }

  forWindow(windowId: string): readonly GuardEvent[] {
    return this.events.filter((event) => event.windowId === windowId);
  }
}
