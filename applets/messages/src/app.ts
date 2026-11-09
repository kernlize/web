import { NOTIFY_DOMAIN, type DmMessage, type Subscription } from '@napplet/sdk';
import { resolveAccount } from './account.js';
import { parseAccountId } from './account-id.js';
import { runtimeHasDomain } from './domain-availability.js';
import { snippet } from './format.js';
import { readHistory } from './history.js';
import { newPendingSend, retirePending, sendRequest } from './outgoing.js';
import type { Lane } from './pacer.js';
import { createPersistence } from './persist.js';
import { failureReason, isUnansweredSend, sendFailureText } from './send-errors.js';
import { onMessage, readConversations, send, sendNotice, startLiveDelivery, stopLiveDelivery } from './shell.js';
import {
  absorbThread,
  buildThreads,
  directKey,
  isOwnMessage,
  lastSeen,
  mergeMessages,
  seenAfterArrival,
  senderName,
  toChatMessage,
  type ChatMessage,
  type SeenState,
  type Thread,
} from './threads.js';
import {
  buildListRows,
  buildThreadSnapshot,
  lastActivity,
  type ListRow,
  type PendingSend,
  type ThreadEntry,
} from './view-model.js';
import { createView, type Phase, type View } from './view.js';

const CONVERSATION_LIMIT = 50;
const NOTICE_LENGTH = 80;

export class MessagesApp {
  private readonly view: View;
  private readonly persistence = createPersistence();
  private readonly entries = new Map<string, ThreadEntry>();
  private readonly conversationIndex = new Map<string, string>();
  private readonly loadedConversations = new Set<string>();
  /** Threads the background reader gave up on until someone opens them. */
  private readonly unreadable = new Set<string>();
  private readonly arrivals: ChatMessage[] = [];
  private drafts = new Map<string, string>();
  private seen: SeenState = { baseline: Date.now(), threads: {} };
  private phase: Phase = 'loading';
  private owner = '';
  private openKey: string | null = null;
  private pane: 'list' | 'thread' = 'list';
  private filter = '';
  private generation = 0;
  private asking = false;
  private filling = false;
  private queuedOpen: string | null = null;
  private feed: Subscription | null = null;
  private subscriptionId: string | null = null;

  constructor() {
    this.view = createView({
      open: (key) => this.open(key),
      back: () => this.back(),
      send: (text) => this.send(text),
      retry: (clientId) => this.retry(clientId),
      discard: (clientId) => this.discard(clientId),
      draft: (text) => this.setDraft(text),
      filter: (text) => this.setFilter(text),
      startWith: (input) => this.startWith(input),
      reload: () => void this.start(),
      reloadHistory: () => this.reloadOpenHistory(),
    });
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /**
   * Load the list for whoever owns the messages now; safe to call again.
   * Four requests: the status, then the saved state, the conversations and
   * live delivery together. No thread's history is read here. `requested` is
   * called once those are on their way, so the caller can queue what may wait.
   */
  async start(requested: () => void = () => undefined): Promise<void> {
    const generation = ++this.generation;
    this.stopListening();
    this.reset();
    this.setPhase('loading');
    const account = await resolveAccount();
    if (generation !== this.generation) return;
    if (account.phase !== 'ready') {
      this.setPhase(account.phase);
      return;
    }
    this.owner = account.owner;
    const saved = this.persistence.load(this.owner);
    const listed = this.reloadConversations().then(
      () => true,
      () => false,
    );
    void this.listen(generation);
    requested();
    const { drafts, seen } = await saved;
    const ok = await listed;
    if (generation !== this.generation) return;
    if (!ok) {
      this.stopListening();
      this.setPhase('error');
      return;
    }
    this.drafts = drafts;
    this.seen = seen ?? { baseline: Date.now(), threads: {} };
    if (!seen) this.save();
    this.setPhase('ready');
    void this.placeArrivals(generation);
    void this.fillPreviews(generation);
    this.openQueued();
  }

  /** Open the thread with one person, creating an empty one if needed. */
  openDirect(pubkey: string): void {
    if (this.phase !== 'ready') {
      this.queuedOpen = pubkey;
      return;
    }
    const key = directKey([pubkey]);
    if (!this.entries.has(key)) {
      const thread: Thread = { key, kind: 'direct', conversationIds: [], peers: [{ pubkey }], updatedAt: Date.now() };
      this.entries.set(key, { thread, messages: [], pending: [], history: 'ready' });
    }
    this.open(key);
  }

  showNewMessage(): void {
    if (this.phase === 'ready') this.view.showNewForm();
  }

  /** Open the thread after (1) or before (-1) the open one in list order. */
  step(direction: 1 | -1): void {
    const rows = this.listRows();
    if (this.phase !== 'ready' || rows.length === 0) return;
    const index = rows.findIndex((row) => row.key === this.openKey);
    const start = index < 0 && direction < 0 ? rows.length : index;
    const next = Math.min(rows.length - 1, Math.max(0, start + direction));
    this.open(rows[next].key);
  }

  dispose(): void {
    this.generation += 1;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.persistence.flush();
    this.stopListening();
  }

  private readonly onVisibility = (): void => {
    const entry = this.openEntry();
    if (document.hidden || !entry) return;
    this.markSeen(entry);
    this.render();
  };

  private reset(): void {
    this.entries.clear();
    this.conversationIndex.clear();
    this.loadedConversations.clear();
    this.unreadable.clear();
    this.arrivals.length = 0;
    this.drafts = new Map();
    this.owner = '';
    this.openKey = null;
    this.pane = 'list';
    this.asking = false;
    this.filling = false;
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.render();
  }

  private save(): void {
    this.persistence.save(this.owner, this.drafts, this.seen);
  }

  private async reloadConversations(): Promise<void> {
    const page = await readConversations(CONVERSATION_LIMIT);
    for (const thread of buildThreads(page.conversations, this.owner)) this.adopt(thread);
  }

  private adopt(thread: Thread): ThreadEntry {
    let entry = this.entries.get(thread.key);
    if (entry) absorbThread(entry.thread, thread);
    else {
      entry = { thread, messages: [], pending: [], history: 'idle' };
      this.entries.set(thread.key, entry);
    }
    for (const id of entry.thread.conversationIds) this.conversationIndex.set(id, thread.key);
    return entry;
  }

  private async listen(generation: number): Promise<void> {
    try {
      this.feed = onMessage((message) => this.receive(message));
      const subscriptionId = await startLiveDelivery();
      if (generation === this.generation) this.subscriptionId = subscriptionId;
      else stopLiveDelivery(subscriptionId);
    } catch {
      // History and sending still work when the shell refuses live delivery.
    }
  }

  private stopListening(): void {
    this.feed?.close();
    this.feed = null;
    if (this.subscriptionId) stopLiveDelivery(this.subscriptionId);
    this.subscriptionId = null;
  }

  /** Conversations of this thread whose history has not been read yet. */
  private unloaded(entry: ThreadEntry): string[] {
    return entry.thread.conversationIds.filter((id) => !this.loadedConversations.has(id));
  }

  /** The open thread is read at full pace; any other only while the shell is otherwise idle. */
  private laneFor(entry: ThreadEntry): Lane {
    return this.openKey === entry.thread.key ? 'normal' : 'background';
  }

  private async loadHistory(entry: ThreadEntry, generation: number): Promise<void> {
    if (entry.history === 'loading') return;
    entry.history = this.unloaded(entry).length > 0 ? 'loading' : 'ready';
    this.render();
    try {
      // Re-checked every round: a conversation can join the thread meanwhile.
      for (let id = this.unloaded(entry)[0]; id !== undefined; id = this.unloaded(entry)[0]) {
        const messages = await readHistory(id, () => this.laneFor(entry));
        if (generation !== this.generation) return;
        this.loadedConversations.add(id);
        entry.messages = mergeMessages(entry.messages, messages);
      }
      entry.history = 'ready';
    } catch {
      if (generation !== this.generation) return;
      entry.history = 'error';
    }
    if (this.isShowing(entry.thread.key)) this.markSeen(entry);
    this.render();
  }

  /**
   * Previews and unread counts for threads nobody has opened: one thread at a
   * time, most recent first, in the lane that only moves while nothing else
   * has been asked of the shell for a second. Never a burst.
   */
  private async fillPreviews(generation: number): Promise<void> {
    if (this.filling) return;
    this.filling = true;
    for (let entry = this.nextUnread(); entry && generation === this.generation; entry = this.nextUnread()) {
      await this.loadHistory(entry, generation);
      if (entry.history !== 'ready') this.unreadable.add(entry.thread.key);
    }
    if (generation === this.generation) this.filling = false;
  }

  private nextUnread(): ThreadEntry | undefined {
    return [...this.entries.values()]
      .filter((entry) => entry.history !== 'loading' && !this.unreadable.has(entry.thread.key))
      .filter((entry) => this.unloaded(entry).length > 0)
      .sort((a, b) => lastActivity(b) - lastActivity(a))[0];
  }

  private reloadOpenHistory(): void {
    const entry = this.openEntry();
    if (entry) void this.loadHistory(entry, this.generation);
  }

  private openQueued(): void {
    const pubkey = this.queuedOpen;
    this.queuedOpen = null;
    if (pubkey) this.openDirect(pubkey);
  }

  private openEntry(): ThreadEntry | null {
    return this.openKey ? this.entries.get(this.openKey) ?? null : null;
  }

  private isShowing(key: string): boolean {
    return this.openKey === key && !document.hidden;
  }

  private markSeen(entry: ThreadEntry): void {
    const latest = entry.messages.at(-1)?.at ?? 0;
    this.seen.threads[entry.thread.key] = Math.max(Date.now(), latest);
    this.save();
  }

  /** A thread started from "New message" that never got a word leaves no trace. */
  private pruneUnused(keep: string | null): void {
    for (const [key, entry] of this.entries) {
      const used = entry.thread.conversationIds.length > 0 || entry.pending.length > 0 || this.drafts.has(key);
      if (!used && key !== keep) this.entries.delete(key);
    }
  }

  private open(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.pruneUnused(key);
    this.openKey = key;
    this.pane = 'thread';
    this.markSeen(entry);
    this.render();
    this.view.focusComposer();
    this.unreadable.delete(key);
    void this.loadHistory(entry, this.generation);
  }

  private back(): void {
    const key = this.openKey;
    this.openKey = null;
    this.pane = 'list';
    this.pruneUnused(null);
    this.render();
    if (key) this.view.focusThread(key);
  }

  private startWith(input: string): string | null {
    const pubkey = parseAccountId(input);
    if (!pubkey) return sendFailureText('invalid:recipient');
    this.openDirect(pubkey);
    return null;
  }

  private setDraft(text: string): void {
    if (!this.openKey) return;
    if (text) this.drafts.set(this.openKey, text);
    else this.drafts.delete(this.openKey);
    this.save();
  }

  private setFilter(text: string): void {
    this.filter = text;
    this.render();
  }

  private send(text: string): void {
    const entry = this.openEntry();
    const content = text.trim();
    if (!entry || !content) return;
    const pending = newPendingSend(content);
    entry.pending.push(pending);
    this.setDraft('');
    this.render();
    void this.deliver(entry, pending);
  }

  private retry(clientId: string): void {
    const entry = this.openEntry();
    const pending = entry?.pending.find((candidate) => candidate.clientId === clientId);
    if (!entry || !pending) return;
    pending.state = 'sending';
    pending.stalled = false;
    pending.problem = '';
    pending.at = Date.now();
    this.render();
    void this.deliver(entry, pending);
  }

  private discard(clientId: string): void {
    const entry = this.openEntry();
    if (!entry) return;
    entry.pending = entry.pending.filter((candidate) => candidate.clientId !== clientId);
    this.render();
  }

  /**
   * One attempt, never repeated here. The shell may put a question to the
   * person before it sends, so this can stay open for minutes and nothing
   * races it against a clock. When the binding itself stops waiting, the send
   * may still happen: the bubble stays "sending", the live echo settles it,
   * and the person gets the choice to send again or discard.
   */
  private async deliver(entry: ThreadEntry, pending: PendingSend): Promise<void> {
    const generation = this.generation;
    try {
      const result = await send(sendRequest(entry.thread, pending));
      if (generation !== this.generation) return;
      if (!result.ok) throw new Error('send failed');
      this.confirm(entry, pending, toChatMessage(result.message));
    } catch (error) {
      if (generation !== this.generation) return;
      const reason = failureReason(error);
      pending.stalled = isUnansweredSend(reason);
      if (!pending.stalled) {
        pending.state = 'failed';
        pending.problem = sendFailureText(reason);
      }
    }
    this.render();
  }

  private confirm(entry: ThreadEntry, pending: PendingSend, message: ChatMessage): void {
    entry.pending = entry.pending.filter((candidate) => candidate !== pending);
    const joined = !entry.thread.conversationIds.includes(message.conversationId);
    if (joined) entry.thread.conversationIds.push(message.conversationId);
    this.conversationIndex.set(message.conversationId, entry.thread.key);
    entry.messages = mergeMessages(entry.messages, [message]);
    entry.thread.updatedAt = Math.max(entry.thread.updatedAt, message.at);
    if (this.isShowing(entry.thread.key)) this.markSeen(entry);
    // The shell chose the conversation; it may hold history not read yet.
    if (joined) void this.loadHistory(entry, this.generation);
  }

  private receive(raw: DmMessage): void {
    this.arrivals.push(toChatMessage(raw));
    if (this.phase === 'ready') void this.placeArrivals(this.generation);
  }

  /**
   * Put live messages into their threads. One from a conversation not seen
   * yet means asking the shell who is in it, once for however many arrived.
   */
  private async placeArrivals(generation: number): Promise<void> {
    if (this.asking) return;
    if (this.arrivals.some((message) => !this.conversationIndex.has(message.conversationId))) {
      this.asking = true;
      try {
        await this.reloadConversations();
      } catch {
        // Without the list, a message from someone else still names its thread.
      }
      if (generation !== this.generation) return;
      this.asking = false;
    }
    for (const message of this.arrivals.splice(0)) this.place(message);
    void this.fillPreviews(generation);
  }

  private place(message: ChatMessage): void {
    let key = this.conversationIndex.get(message.conversationId);
    if (!key && !isOwnMessage(message, this.owner)) {
      key = this.adopt({
        key: directKey([message.sender]),
        kind: 'direct',
        conversationIds: [message.conversationId],
        peers: [{ pubkey: message.sender }],
        updatedAt: message.at,
      }).thread.key;
    }
    const entry = key ? this.entries.get(key) : undefined;
    if (!entry) return;
    const known = entry.messages.some((existing) => existing.id === message.id);
    entry.messages = mergeMessages(entry.messages, [message]);
    entry.thread.updatedAt = Math.max(entry.thread.updatedAt, message.at);
    if (isOwnMessage(message, this.owner)) retirePending(entry, message.content);
    else if (!known) this.noticeArrival(entry, message);
    // A conversation that just joined the thread on screen is read right away.
    if (this.isShowing(entry.thread.key) && this.unloaded(entry).length > 0) {
      void this.loadHistory(entry, this.generation);
    }
    this.render();
  }

  private noticeArrival(entry: ThreadEntry, message: ChatMessage): void {
    const key = entry.thread.key;
    if (this.isShowing(key)) {
      this.markSeen(entry);
      return;
    }
    const seenAt = seenAfterArrival(lastSeen(this.seen, key), message.at);
    if (seenAt !== lastSeen(this.seen, key)) {
      this.seen.threads[key] = seenAt;
      this.save();
    }
    // Old messages a shell replays on subscribing are not news.
    if (message.at <= seenAt || !runtimeHasDomain(NOTIFY_DOMAIN)) return;
    sendNotice(senderName(entry.thread, message.sender), snippet(message.content, NOTICE_LENGTH));
  }

  private listRows(): ListRow[] {
    return buildListRows(this.entries.values(), {
      owner: this.owner,
      seen: this.seen,
      openKey: this.openKey,
      filter: this.filter,
      now: Date.now(),
    });
  }

  private render(): void {
    const entry = this.openEntry();
    this.view.render({
      phase: this.phase,
      pane: this.pane,
      rows: this.listRows(),
      filtering: this.filter.trim() !== '',
      thread: entry ? buildThreadSnapshot(entry, this.owner, this.drafts.get(entry.thread.key) ?? '') : null,
    });
  }
}
