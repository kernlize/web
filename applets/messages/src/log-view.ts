import { el, syncRows } from './dom.js';
import type { LogRow, MessageRow } from './view-model.js';

const PINNED_SLACK_PX = 48;

function actionButton(action: 'retry' | 'discard', label: string, clientId: string): HTMLButtonElement {
  const button = el('button', 'text-button', label);
  button.type = 'button';
  button.dataset.action = action;
  button.dataset.clientId = clientId;
  return button;
}

function messageNode(row: MessageRow): HTMLElement {
  const node = el('div', `msg ${row.own ? 'own' : 'theirs'} ${row.state}${row.joined ? ' joined' : ''}`);
  if (row.sender) node.append(el('span', 'sender truncate', row.sender));

  const bubble = el('div', 'bubble');
  const text = el('span', 'text', row.text);
  text.dataset.nappletSelect = 'text';
  bubble.append(text);
  if (row.state === 'sent') {
    const stamp = el('time', 'stamp', row.time);
    stamp.dateTime = row.iso;
    bubble.append(stamp);
  } else if (row.state === 'sending') {
    bubble.append(el('span', 'stamp', row.note));
  }
  node.append(bubble);

  if (row.actionable) {
    const actions = el('div', 'problem');
    if (row.state === 'failed') actions.append(el('span', 'problem-text', row.note));
    actions.append(
      actionButton('retry', 'Retry', row.clientId),
      actionButton('discard', 'Discard', row.clientId),
    );
    node.append(actions);
  }
  return node;
}

function rowNode(row: LogRow): HTMLElement {
  if (row.kind === 'message') return messageNode(row);
  const day = el('div', 'day');
  day.setAttribute('role', 'separator');
  day.append(el('span', '', row.label));
  return day;
}

export interface LogRender {
  rows: readonly LogRow[];
  /** A different thread than last time: start at the newest message. */
  fresh: boolean;
}

/**
 * Update the log in place. It follows new messages only while the reader is
 * already at the bottom, and always after their own send or a thread switch.
 */
export function renderLog(log: HTMLElement, render: LogRender): void {
  const pinned = log.scrollHeight - log.scrollTop - log.clientHeight < PINNED_SLACK_PX;
  const before = log.lastElementChild instanceof HTMLElement ? log.lastElementChild.dataset.key : undefined;
  syncRows(log, render.rows, rowNode);
  const last = render.rows.at(-1);
  const ownArrival = last?.kind === 'message' && last.own && last.key !== before;
  if (render.fresh || pinned || ownArrival) log.scrollTop = log.scrollHeight;
}
