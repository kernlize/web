import type { AskSignal, ConsentSummary } from '@kernlize/kernel';

/** One question for the person, in this host's own words and dialog. */
export interface Question {
  readonly title: string;
  readonly lines: readonly string[];
  /** Extra choices, each a checkbox that starts unticked. */
  readonly choices?: readonly { readonly id: string; readonly label: string }[];
  /** Aborts when the kernel withdraws the question. */
  readonly signal?: AskSignal;
}

/** What the person said. */
export interface Reply {
  readonly yes: boolean;
  /** The ids of the choices they ticked. */
  readonly ticked: readonly string[];
}

const dialog = document.querySelector<HTMLDialogElement>('#ask')!;
const title = dialog.querySelector<HTMLElement>('#ask-title')!;
const lines = dialog.querySelector<HTMLUListElement>('#ask-lines')!;
const extra = dialog.querySelector<HTMLElement>('#ask-extra')!;

// One dialog, so questions wait their turn.
let queue: Promise<unknown> = Promise.resolve();

function show(question: Question): Promise<Reply> {
  title.textContent = question.title;
  lines.replaceChildren(...question.lines.map((line) => Object.assign(document.createElement('li'), { textContent: line })));
  extra.replaceChildren(...(question.choices ?? []).map((choice) => {
    const label = document.createElement('label');
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', name: choice.id });
    label.append(box, ` ${choice.label}`);
    return label;
  }));
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    const withdraw = (): void => dialog.close('no');
    question.signal?.addEventListener('abort', withdraw, { once: true });
    dialog.addEventListener('close', () => {
      question.signal?.removeEventListener('abort', withdraw);
      const ticked = [...extra.querySelectorAll<HTMLInputElement>('input:checked')].map((box) => box.name);
      // Escape closes with no value: that is a no.
      resolve({ yes: dialog.returnValue === 'yes', ticked });
    }, { once: true });
  });
}

/**
 * Ask the person something. Questions are shown one at a time, in the order asked.
 *
 * @param question - What to show.
 * @returns What they answered; dismissing the dialog is a no.
 */
export function ask(question: Question): Promise<Reply> {
  const reply = queue.then(() => show(question));
  queue = reply.catch(() => undefined);
  return reply;
}

/**
 * The lines of one of the kernel's consent summaries, as this host words them.
 *
 * @param summary - The kernel's own wording of the question.
 * @returns One line per thing the answer changes.
 */
export function linesOf(summary: ConsentSummary): string[] {
  return summary.lines.map((line) => (line.after === undefined ? line.label : `${line.label}: ${line.after}`));
}
