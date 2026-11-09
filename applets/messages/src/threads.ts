import { shortAccountId } from './account-id.js';

export interface Peer {
  pubkey: string;
  label?: string;
}

/** The part of a shell conversation summary this applet reads. */
export interface ConversationSummary {
  id: string;
  kind: 'direct' | 'group';
  participants: readonly Peer[];
  subject?: string;
  updatedAt?: number;
}

/** A message as the shell reports it. */
export interface ShellMessage {
  id: string;
  conversationId: string;
  senderPubkey: string;
  createdAt: number;
  content: string;
  status: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  sender: string;
  /** Milliseconds since the epoch. */
  at: number;
  content: string;
  status: string;
}

/**
 * What a person sees as one conversation. The shell reports one conversation
 * per provider, so a thread with one person may span several of them.
 */
export interface Thread {
  key: string;
  kind: 'direct' | 'group';
  conversationIds: string[];
  /** Everyone in it except the owner; the owner alone for notes to self. */
  peers: Peer[];
  subject?: string;
  /** Milliseconds since the epoch; 0 when the shell gave no time. */
  updatedAt: number;
}

export interface SeenState {
  /** Threads never opened count as seen up to this moment (first run). */
  baseline: number;
  threads: Record<string, number>;
}

const MILLISECOND_FLOOR = 1e11;

/**
 * The interface leaves the unit of a timestamp open. Seconds stay below 1e11
 * until the year 5138 and milliseconds have been above it since 1973, so the
 * magnitude tells them apart.
 */
export function toMillis(timestamp: number): number {
  return timestamp >= MILLISECOND_FLOOR ? timestamp : timestamp * 1000;
}

export function toChatMessage(message: ShellMessage): ChatMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    sender: message.senderPubkey,
    at: toMillis(message.createdAt),
    content: message.content,
    status: message.status,
  };
}

/** The key of the one thread shared with exactly these people. */
export function directKey(peers: readonly string[]): string {
  return `direct:${[...new Set(peers)].sort().join('+')}`;
}

function peersOf(conversation: ConversationSummary, owner: string): Peer[] {
  const byPubkey = new Map<string, Peer>();
  for (const participant of conversation.participants) {
    if (participant.pubkey === owner || byPubkey.has(participant.pubkey)) continue;
    byPubkey.set(
      participant.pubkey,
      participant.label ? { pubkey: participant.pubkey, label: participant.label } : { pubkey: participant.pubkey },
    );
  }
  return [...byPubkey.values()];
}

/** Which thread a shell conversation belongs to. */
export function threadKey(conversation: ConversationSummary, owner: string): string {
  if (conversation.kind === 'group') return `group:${conversation.id}`;
  const peers = peersOf(conversation, owner).map((peer) => peer.pubkey);
  return directKey(peers.length > 0 ? peers : [owner]);
}

function adoptLabels(known: Peer[], incoming: readonly Peer[]): Peer[] {
  return known.map((peer) => {
    if (peer.label) return peer;
    const labelled = incoming.find((candidate) => candidate.pubkey === peer.pubkey && candidate.label);
    return labelled ?? peer;
  });
}

function threadFrom(conversation: ConversationSummary, owner: string): Thread {
  const peers = peersOf(conversation, owner);
  const thread: Thread = {
    key: threadKey(conversation, owner),
    kind: conversation.kind,
    conversationIds: [conversation.id],
    peers: peers.length > 0 ? peers : [{ pubkey: owner }],
    updatedAt: conversation.updatedAt === undefined ? 0 : toMillis(conversation.updatedAt),
  };
  if (conversation.subject) thread.subject = conversation.subject;
  return thread;
}

/** Fold one more conversation of the same thread into it. */
export function absorbThread(target: Thread, source: Thread): void {
  for (const id of source.conversationIds) {
    if (!target.conversationIds.includes(id)) target.conversationIds.push(id);
  }
  target.peers = adoptLabels(target.peers, source.peers);
  target.updatedAt = Math.max(target.updatedAt, source.updatedAt);
  if (source.subject) target.subject = source.subject;
}

/**
 * One thread per person for direct conversations with the same participant
 * set, one thread per group conversation, most recently active first.
 */
export function buildThreads(conversations: readonly ConversationSummary[], owner: string): Thread[] {
  const byKey = new Map<string, Thread>();
  for (const conversation of conversations) {
    const thread = threadFrom(conversation, owner);
    const existing = byKey.get(thread.key);
    if (existing) absorbThread(existing, thread);
    else byKey.set(thread.key, thread);
  }
  return [...byKey.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key));
}

/**
 * Union by message id, oldest first; an incoming copy replaces a stored one.
 * Shell times can be whole seconds, so a message and its reply may share one:
 * ties keep the order the messages arrived in rather than an arbitrary one.
 */
export function mergeMessages(
  current: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.at - b.at);
}

/** Without a known owner, the delivery state still tells sent from received. */
export function isOwnMessage(message: ChatMessage, owner: string): boolean {
  return owner ? message.sender === owner : message.status !== 'received';
}

export function lastSeen(seen: SeenState, key: string): number {
  return seen.threads[key] ?? seen.baseline;
}

const STAMP_SLACK_MS = 1000;

/**
 * Where "last seen" must sit once a message has arrived live for a thread
 * that is not on screen. Shells stamp messages in whole seconds, so one that
 * arrives just after the thread was looked at can carry a time just before
 * it; it is still new. Anything older than that slack is history the shell
 * is replaying, and stays seen.
 */
export function seenAfterArrival(seenAt: number, arrivedAt: number): number {
  const rounding = arrivedAt <= seenAt && arrivedAt > seenAt - STAMP_SLACK_MS;
  return rounding ? arrivedAt - 1 : seenAt;
}

/** Messages from other people that are newer than the last look at the thread. */
export function countUnread(messages: readonly ChatMessage[], owner: string, seenAt: number): number {
  return messages.filter((message) => message.at > seenAt && !isOwnMessage(message, owner)).length;
}

export function peerName(peer: Peer): string {
  return peer.label?.trim() || shortAccountId(peer.pubkey);
}

const NAMED_PEERS = 3;

export function threadTitle(thread: Thread): string {
  if (thread.subject?.trim()) return thread.subject.trim();
  const names = thread.peers.slice(0, NAMED_PEERS).map(peerName);
  const rest = thread.peers.length - names.length;
  return rest > 0 ? `${names.join(', ')} +${rest}` : names.join(', ');
}

/** The display name of whoever wrote a message in this thread. */
export function senderName(thread: Thread, sender: string): string {
  const peer = thread.peers.find((candidate) => candidate.pubkey === sender);
  return peer ? peerName(peer) : shortAccountId(sender);
}
