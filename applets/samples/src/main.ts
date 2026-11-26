import './styles.css';
import { actionsFor, draftFor, extrasFor, type Action } from './actions.js';
import { runtimeHasDomain } from './domain-availability.js';
import * as shell from './shell.js';
import { sampleFor } from './specs.js';
import { grantedLine, notGranted } from './words.js';

// One page, three builds: the build mode names the sample (vite.config.ts).
const spec = sampleFor(import.meta.env.MODE);
const MAX_LINES = 12;

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const log = byId<HTMLUListElement>('log');
const note = byId<HTMLTextAreaElement>('note');

function write(text: string): void {
  const item = document.createElement('li');
  item.textContent = text;
  log.prepend(item);
  while (log.children.length > MAX_LINES) log.lastElementChild?.remove();
}

const writeAnswer = (pending: Promise<string | undefined>): void => {
  void pending.then((text) => {
    if (text) write(text);
  });
};

/** What each button does; every call goes through src/shell.ts. */
function perform(id: string): void {
  const publishing = draftFor(id, note.value);
  if (publishing) return writeAnswer(shell.publish(publishing.name, publishing.draft));
  switch (id) {
    case 'notify':
      return writeAnswer(shell.sendNotification(spec.title));
    case 'settings':
      return writeAnswer(shell.openSettings(write));
    case 'intent':
      return writeAnswer(shell.openProfile());
    case 'flood':
      return shell.flood(write);
    case 'download':
      return writeAnswer(shell.download());
    case 'link':
      return writeAnswer(shell.openLink());
    default:
      return write(`Unknown request ${id}.`);
  }
}

/** A button for an action; one whose domain the shell did not inject is marked and refuses locally. */
function actionItem(action: Action): HTMLLIElement {
  const granted = runtimeHasDomain(action.domain);
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = action.label;
  if (!granted) button.dataset.missing = '1';
  button.addEventListener('click', () => (runtimeHasDomain(action.domain) ? perform(action.id) : write(notGranted(action.domain))));
  const hint = document.createElement('span');
  hint.textContent = granted ? action.hint : `${action.hint} (not granted)`;
  item.append(button, hint);
  return item;
}

function render(): void {
  document.title = spec.title;
  const declared = [...spec.requires, ...spec.optional];
  byId('granted').textContent = grantedLine(declared.filter(runtimeHasDomain));
  byId('actions').append(...actionsFor(spec).map(actionItem));
  const extras = extrasFor(spec);
  if (extras.length) {
    byId('extraActions').append(...extras.map(actionItem));
    byId('extras').hidden = false;
  }
}

render();
// Profiles takes requests other applets hand over; the shell delivers them only with the intent grant.
if (spec.accepts.length && runtimeHasDomain('intent')) shell.onProfileRequest(write);
window.addEventListener('pagehide', shell.closeFlood);
