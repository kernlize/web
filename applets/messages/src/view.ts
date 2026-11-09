import { must } from './dom.js';
import { moveListFocus, renderList, threadButton } from './list-view.js';
import { renderLog } from './log-view.js';
import type { HistoryState, ListRow, ThreadSnapshot } from './view-model.js';

export type Phase = 'loading' | 'ready' | 'unavailable' | 'signed-out' | 'error';

export interface Snapshot {
  phase: Phase;
  pane: 'list' | 'thread';
  rows: ListRow[];
  filtering: boolean;
  thread: ThreadSnapshot | null;
}

export interface ViewHandlers {
  open(key: string): void;
  back(): void;
  send(text: string): void;
  retry(clientId: string): void;
  discard(clientId: string): void;
  draft(text: string): void;
  filter(text: string): void;
  /** Returns what is wrong with the input, or null once the thread is open. */
  startWith(input: string): string | null;
  reload(): void;
  reloadHistory(): void;
}

export interface View {
  render(snapshot: Snapshot): void;
  focusComposer(): void;
  focusThread(key: string): void;
  showNewForm(): void;
}

const PHASE_NOTICE: Record<Exclude<Phase, 'ready'>, { text: string; retry: boolean }> = {
  loading: { text: 'Loading…', retry: false },
  unavailable: { text: 'Messages are not available here yet.', retry: true },
  'signed-out': { text: 'Sign in to read your messages.', retry: false },
  error: { text: 'Could not load your conversations.', retry: true },
};

function findElements() {
  return {
    frame: must<HTMLElement>('#frame'),
    notice: must<HTMLElement>('#notice'),
    noticeText: must<HTMLElement>('#noticeText'),
    noticeRetry: must<HTMLButtonElement>('#noticeRetry'),
    listPane: must<HTMLElement>('#listPane'),
    filterInput: must<HTMLInputElement>('#filterInput'),
    newButton: must<HTMLButtonElement>('#newButton'),
    newForm: must<HTMLElement>('#newForm'),
    newStart: must<HTMLButtonElement>('#newStart'),
    toInput: must<HTMLInputElement>('#toInput'),
    toError: must<HTMLElement>('#toError'),
    newCancel: must<HTMLButtonElement>('#newCancel'),
    listNote: must<HTMLElement>('#listNote'),
    listNoteText: must<HTMLElement>('#listNoteText'),
    listNoteNew: must<HTMLButtonElement>('#listNoteNew'),
    threadList: must<HTMLElement>('#threadList'),
    threadPane: must<HTMLElement>('#threadPane'),
    threadHead: must<HTMLElement>('#threadHead'),
    backButton: must<HTMLButtonElement>('#backButton'),
    threadTile: must<HTMLElement>('#threadTile'),
    threadTitle: must<HTMLElement>('#threadTitle'),
    threadNote: must<HTMLElement>('#threadNote'),
    threadNoteText: must<HTMLElement>('#threadNoteText'),
    threadNoteRetry: must<HTMLButtonElement>('#threadNoteRetry'),
    log: must<HTMLElement>('#log'),
    composer: must<HTMLElement>('#composer'),
    messageInput: must<HTMLTextAreaElement>('#messageInput'),
    sendButton: must<HTMLButtonElement>('#sendButton'),
    threadHint: must<HTMLElement>('#threadHint'),
  };
}

type Elements = ReturnType<typeof findElements>;

function fitComposer(elements: Elements): void {
  const input = elements.messageInput;
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight + 2}px`;
  elements.sendButton.disabled = input.value.trim() === '';
}

function renderPhase(elements: Elements, phase: Phase): void {
  const ready = phase === 'ready';
  elements.frame.dataset.phase = phase;
  elements.listPane.hidden = !ready;
  elements.threadPane.hidden = !ready;
  elements.notice.hidden = ready;
  if (ready) return;
  const notice = PHASE_NOTICE[phase];
  elements.noticeText.textContent = notice.text;
  elements.noticeRetry.hidden = !notice.retry;
}

function renderListNote(elements: Elements, snapshot: Snapshot): void {
  const empty = snapshot.rows.length === 0;
  elements.listNote.hidden = !empty;
  if (!empty) return;
  elements.listNoteText.textContent = snapshot.filtering ? 'No matches.' : 'No conversations yet.';
  elements.listNoteNew.hidden = snapshot.filtering;
}

function threadNote(thread: ThreadSnapshot): { text: string; retry: boolean } | null {
  if (thread.history === 'error') return { text: 'Could not load this conversation.', retry: true };
  if (thread.rows.length > 0) return null;
  return thread.history === 'ready'
    ? { text: 'No messages yet.', retry: false }
    : { text: 'Loading…', retry: false };
}

function renderThreadNote(elements: Elements, thread: ThreadSnapshot): void {
  const note = threadNote(thread);
  elements.threadNote.hidden = note === null;
  if (!note) return;
  elements.threadNoteText.textContent = note.text;
  elements.threadNoteRetry.hidden = !note.retry;
}

/**
 * Filling a whole thread at once would be read out message by message, so the
 * live region is silenced for that one paint and switched back on after it.
 */
function quietly(log: HTMLElement, paint: () => void): void {
  log.setAttribute('aria-live', 'off');
  paint();
  window.setTimeout(() => log.setAttribute('aria-live', 'polite'), 0);
}

function createThreadRenderer(elements: Elements): (thread: ThreadSnapshot | null) => void {
  let shownKey: string | null = null;
  let shownHistory: HistoryState | null = null;

  return (thread) => {
    const open = thread !== null;
    elements.threadHint.hidden = open;
    elements.threadHead.hidden = !open;
    elements.log.hidden = !open;
    elements.composer.hidden = !open;
    if (!thread) {
      elements.threadNote.hidden = true;
      shownKey = null;
      return;
    }
    const fresh = thread.key !== shownKey;
    const arrived = shownHistory !== 'ready' && thread.history === 'ready';
    elements.threadTitle.textContent = thread.title;
    elements.threadTile.textContent = thread.initials;
    elements.threadTile.style.setProperty('--hue', String(thread.hue));
    renderThreadNote(elements, thread);
    const paint = (): void => renderLog(elements.log, { rows: thread.rows, fresh: fresh || arrived });
    if (fresh || arrived) quietly(elements.log, paint);
    else paint();
    if (fresh) {
      elements.messageInput.value = thread.draft;
      fitComposer(elements);
    }
    shownKey = thread.key;
    shownHistory = thread.history;
  };
}

function bindNewForm(elements: Elements, handlers: ViewHandlers): { show(): void; hide(): void } {
  const hide = (): void => {
    elements.newForm.hidden = true;
    elements.toInput.value = '';
    elements.toError.textContent = '';
  };
  const show = (): void => {
    elements.newForm.hidden = false;
    elements.toInput.focus();
  };
  elements.newButton.addEventListener('click', show);
  elements.listNoteNew.addEventListener('click', show);
  elements.newCancel.addEventListener('click', () => {
    hide();
    elements.newButton.focus();
  });
  elements.toInput.addEventListener('input', () => {
    elements.toError.textContent = '';
  });
  const start = (): void => {
    const problem = handlers.startWith(elements.toInput.value);
    if (problem) elements.toError.textContent = problem;
    else hide();
  };
  elements.newStart.addEventListener('click', start);
  elements.toInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) start();
    if (event.key !== 'Escape') return;
    hide();
    elements.newButton.focus();
  });
  return { show, hide };
}

function bindComposer(elements: Elements, handlers: ViewHandlers): void {
  const submit = (): void => {
    const text = elements.messageInput.value;
    if (text.trim() === '') return;
    elements.messageInput.value = '';
    fitComposer(elements);
    handlers.send(text);
    elements.messageInput.focus();
  };
  elements.sendButton.addEventListener('click', submit);
  elements.messageInput.addEventListener('input', () => {
    fitComposer(elements);
    handlers.draft(elements.messageInput.value);
  });
  elements.messageInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    submit();
  });
}

function bindLists(elements: Elements, handlers: ViewHandlers): void {
  elements.threadList.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('.thread-item');
    if (button?.dataset.key) handlers.open(button.dataset.key);
  });
  elements.threadList.addEventListener('keydown', (event) => moveListFocus(elements.threadList, event));
  elements.log.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-action]');
    const clientId = button?.dataset.clientId;
    if (!button || !clientId) return;
    if (button.dataset.action === 'retry') handlers.retry(clientId);
    else handlers.discard(clientId);
  });
  elements.filterInput.addEventListener('input', () => handlers.filter(elements.filterInput.value));
  elements.backButton.addEventListener('click', () => handlers.back());
  elements.noticeRetry.addEventListener('click', () => handlers.reload());
  elements.threadNoteRetry.addEventListener('click', () => handlers.reloadHistory());
}

export function createView(handlers: ViewHandlers): View {
  const elements = findElements();
  const renderThread = createThreadRenderer(elements);
  const newForm = bindNewForm(elements, handlers);
  bindComposer(elements, handlers);
  bindLists(elements, handlers);

  return {
    render(snapshot) {
      renderPhase(elements, snapshot.phase);
      elements.frame.dataset.pane = snapshot.pane;
      if (snapshot.phase !== 'ready') return;
      renderList(elements.threadList, snapshot.rows);
      renderListNote(elements, snapshot);
      renderThread(snapshot.thread);
    },
    focusComposer() {
      elements.messageInput.focus();
    },
    focusThread(key) {
      (threadButton(elements.threadList, key) ?? elements.newButton).focus();
    },
    showNewForm() {
      // Narrow frames show one pane at a time; the form lives in the list pane.
      if (elements.listPane.getClientRects().length === 0) handlers.back();
      newForm.show();
    },
  };
}
