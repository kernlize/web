/* global $state */
import { createGuardLog } from '@kernlize/ui-model';
import type { GuardEvent, OpClass } from '@kernlize/guard';
import { observe } from './observe.svelte';

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
  if (reason === 'flood:prompts') return 'it asked you too many questions at once';
  if (reason === 'flood:queue-full' || reason === 'defer:queue-full') return 'its queue is full';
  if (reason === 'flood:quarantine') return 'it kept flooding the shell';
  if (reason === 'flood:hidden-resource') return 'too many web fetches while hidden';
  if (reason.startsWith('rate:')) return `too many ${OP_WORDS[opClass]}`;
  if (reason.startsWith('size:')) return `an oversized request (${OP_WORDS[opClass]})`;
  return reason;
}

/** "went over a limit: too many network reads", or "is waiting until you can see it: its publishes are held". */
export function guardEventWords(event: GuardEvent): string {
  if (event.reason.startsWith('hidden:')) return `is waiting until you can see it: its ${OP_WORDS[event.opClass]} are held`;
  return `${VERBS[event.disposition]}: ${because(event)}`;
}

/** "Applet Notes went over a limit: too many network reads". A hidden applet's held requests read as waiting, not as a limit. */
export function describeGuardEvent(event: GuardEvent, title: string): string {
  return `Applet ${title} ${guardEventWords(event)}`;
}

/** The guard panel's binding to the guard log model (#74); the words above are the shell's own. */
export class GuardLog {
  readonly model = createGuardLog(KEEP);
  readonly #events = observe(this.model.events$, []);
  readonly #quarantined = observe(this.model.quarantined$, new Set<string>());
  readonly #total = observe(this.model.total$, 0);

  get events(): readonly GuardEvent[] {
    return this.#events.value;
  }

  get quarantined(): ReadonlySet<string> {
    return this.#quarantined.value;
  }

  get total(): number {
    return this.#total.value;
  }

  push(event: GuardEvent): void {
    this.model.push(event);
  }

  released(windowId: string): void {
    this.model.released(windowId);
  }

  forWindow(windowId: string): readonly GuardEvent[] {
    return this.events.filter((event) => event.windowId === windowId);
  }
}
