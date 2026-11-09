import { clockLabel, dayKey, dayLabel, initials, listTimeLabel, snippet, tileHue } from './format.js';
import { failedSendNote } from './send-errors.js';
import {
  countUnread,
  isOwnMessage,
  lastSeen,
  senderName,
  threadTitle,
  type ChatMessage,
  type SeenState,
  type Thread,
} from './threads.js';

/** A message the person sent that the shell has not confirmed. */
export interface PendingSend {
  clientId: string;
  content: string;
  at: number;
  state: 'sending' | 'failed';
  /**
   * The binding stopped waiting for the shell's answer. The send may still
   * happen, so it stays "sending", but the person may now act on it.
   */
  stalled: boolean;
  problem: string;
}

export type HistoryState = 'idle' | 'loading' | 'ready' | 'error';

export interface ThreadEntry {
  thread: Thread;
  messages: ChatMessage[];
  pending: PendingSend[];
  history: HistoryState;
}

export interface ListRow {
  key: string;
  title: string;
  initials: string;
  hue: number;
  preview: string;
  time: string;
  unread: number;
  current: boolean;
}

export interface DayRow {
  kind: 'day';
  key: string;
  label: string;
}

export interface MessageRow {
  kind: 'message';
  key: string;
  own: boolean;
  /** Shown above the first of a run of messages in a group thread. */
  sender: string;
  /** Continues a run by the same person, so it sits tight under the last one. */
  joined: boolean;
  text: string;
  time: string;
  iso: string;
  state: 'sent' | 'sending' | 'failed';
  note: string;
  /** Set when the row offers Retry and Discard. */
  actionable: boolean;
  clientId: string;
}

export type LogRow = DayRow | MessageRow;

export interface ListContext {
  owner: string;
  seen: SeenState;
  openKey: string | null;
  filter: string;
  now: number;
}

const PREVIEW_LENGTH = 80;

/** When a thread last had anything happen in it. */
export function lastActivity(entry: ThreadEntry): number {
  const message = entry.messages.at(-1)?.at ?? 0;
  const pending = entry.pending.at(-1)?.at ?? 0;
  return Math.max(entry.thread.updatedAt, message, pending);
}

function previewOf(entry: ThreadEntry, owner: string): string {
  const message = entry.messages.at(-1);
  const pending = entry.pending.at(-1);
  if (pending && (!message || pending.at >= message.at)) {
    return `You: ${snippet(pending.content, PREVIEW_LENGTH)}`;
  }
  if (!message) return '';
  const text = snippet(message.content, PREVIEW_LENGTH);
  if (isOwnMessage(message, owner)) return `You: ${text}`;
  return entry.thread.kind === 'group' ? `${senderName(entry.thread, message.sender)}: ${text}` : text;
}

function tileSeed(thread: Thread): string {
  return thread.kind === 'group' ? thread.key : thread.peers[0]?.pubkey ?? thread.key;
}

function listRow(entry: ThreadEntry, context: ListContext): ListRow {
  const title = threadTitle(entry.thread);
  const current = entry.thread.key === context.openKey;
  return {
    key: entry.thread.key,
    title,
    initials: initials(title),
    hue: tileHue(tileSeed(entry.thread)),
    preview: previewOf(entry, context.owner),
    time: listTimeLabel(lastActivity(entry), context.now),
    unread: countUnread(entry.messages, context.owner, lastSeen(context.seen, entry.thread.key)),
    current,
  };
}

/** The thread list, most recently active first, narrowed by the search text. */
export function buildListRows(entries: Iterable<ThreadEntry>, context: ListContext): ListRow[] {
  const needle = context.filter.trim().toLowerCase();
  return [...entries]
    .sort((a, b) => lastActivity(b) - lastActivity(a) || a.thread.key.localeCompare(b.thread.key))
    .map((entry) => listRow(entry, context))
    .filter((row) => !needle || row.title.toLowerCase().includes(needle));
}

interface TimelineItem {
  key: string;
  own: boolean;
  sender: string;
  at: number;
  text: string;
  state: MessageRow['state'];
  note: string;
  actionable: boolean;
  clientId: string;
}

function timeline(entry: ThreadEntry, owner: string): TimelineItem[] {
  const confirmed = entry.messages.map((message): TimelineItem => ({
    key: `m:${message.id}`,
    own: isOwnMessage(message, owner),
    sender: message.sender,
    at: message.at,
    text: message.content,
    state: 'sent',
    note: '',
    actionable: false,
    clientId: '',
  }));
  const pending = entry.pending.map((send): TimelineItem => ({
    key: `p:${send.clientId}`,
    own: true,
    sender: owner,
    at: send.at,
    text: send.content,
    state: send.state,
    note: send.state === 'failed' ? failedSendNote(send.problem) : 'sending…',
    actionable: send.state === 'failed' || send.stalled,
    clientId: send.clientId,
  }));
  return [...confirmed, ...pending].sort((a, b) => a.at - b.at);
}

/** The open thread as rows: a separator per day, then that day's messages. */
export function buildLogRows(entry: ThreadEntry, owner: string, now: number): LogRow[] {
  const rows: LogRow[] = [];
  let day = '';
  let previous: TimelineItem | null = null;
  for (const item of timeline(entry, owner)) {
    const itemDay = dayKey(item.at);
    if (itemDay !== day) {
      day = itemDay;
      previous = null;
      rows.push({ kind: 'day', key: `d:${itemDay}`, label: dayLabel(item.at, now) });
    }
    const joined = previous !== null && previous.sender === item.sender && previous.own === item.own;
    const named = entry.thread.kind === 'group' && !item.own && !joined;
    rows.push({
      kind: 'message',
      key: item.key,
      own: item.own,
      sender: named ? senderName(entry.thread, item.sender) : '',
      joined,
      text: item.text,
      time: clockLabel(item.at),
      iso: new Date(item.at).toISOString(),
      state: item.state,
      note: item.note,
      actionable: item.actionable,
      clientId: item.clientId,
    });
    previous = item;
  }
  return rows;
}

export interface ThreadSnapshot {
  key: string;
  title: string;
  initials: string;
  hue: number;
  rows: LogRow[];
  history: HistoryState;
  draft: string;
}

/** Everything the thread pane shows for the open thread. */
export function buildThreadSnapshot(entry: ThreadEntry, owner: string, draft: string): ThreadSnapshot {
  const title = threadTitle(entry.thread);
  return {
    key: entry.thread.key,
    title,
    initials: initials(title),
    hue: tileHue(tileSeed(entry.thread)),
    rows: buildLogRows(entry, owner, Date.now()),
    history: entry.history,
    draft,
  };
}
