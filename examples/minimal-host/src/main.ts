import { createKernel, createThrowawayIdentity, type AppletHandle, type AppletSummary, type BuiltinApplet, type KernlHost } from '@kernlize/kernel';
import { messagingModule, privateDm } from '@kernlize/modules/messaging';
import { filesModule } from '@kernlize/modules/uploads';
import { ask, linesOf } from './ask';

/**
 * A host with its own UX on kernl's kernel: two modules, one applet pinned by hash, no store.
 * Everything the person sees is this page's; the kernel only asks, through `host.asks`.
 */

const $ = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;

// The applet ships with the page. The kernel hashes the bytes `load` returns and refuses any
// that do not match `sha256`, which the build fixed from the file it shipped.
const NOTE: BuiltinApplet = {
  id: 'note',
  title: 'Note to a friend',
  description: 'Sends a note as a private message, or uploads it as a file.',
  sha256: __APPLET_SHA256__,
  requires: ['dm'],
  optional: ['upload'],
  async load() {
    const response = await fetch(new URL('./applet.html', document.baseURI));
    if (!response.ok) throw new Error(`applet.html answered ${response.status}`);
    return response.text();
  },
};

let frame: HTMLIFrameElement | undefined;
let handle: AppletHandle | undefined;

function problem(text: string | undefined): void {
  const line = $('#problem');
  line.hidden = text === undefined;
  line.textContent = text ?? '';
}

const host: KernlHost = {
  storage: localStorage,
  // The one question these two modules put to the person. Any other kind is refused without asking.
  asks: {
    'upload.file': async (question) => (await ask({ title: question.defaultText.title, lines: linesOf(question.defaultText) })).yes,
  },
  notify: (notice) => problem(notice.body ? `${notice.title}: ${notice.body}` : notice.title),
  openLink(url, options) {
    if (options?.approved) window.open(url, '_blank', 'noopener,noreferrer');
  },
  getVisibility: () => {
    const visible = frame?.isConnected === true && document.visibilityState === 'visible';
    return { visible, focused: visible && document.hasFocus() };
  },
  onRevoked(_windowId, reason) {
    frame?.remove();
    frame = undefined;
    handle = undefined;
    problem(`The applet was stopped (${reason}).`);
  },
};

const kernl = createKernel({
  host,
  builtins: [NOTE],
  modules: [messagingModule({ providers: [privateDm()] }), filesModule()],
});
window.addEventListener('message', (event) => kernl.handleWindowMessage(event));
document.addEventListener('visibilitychange', () => handle?.setVisibility(host.getVisibility(handle.windowId)));

/** Ask, in this page's dialog, for what the applet needs. False when the person said no. */
async function agree(summary: AppletSummary): Promise<boolean> {
  const granted = kernl.grants.get(summary.identity);
  if (granted?.domains.includes('dm')) return true;
  const reply = await ask({
    title: `Open ${summary.title}?`,
    lines: [summary.description, 'It can read and send your private messages.'],
    choices: [{ id: 'upload', label: 'Let it upload files too. It can read your messages, so a file could carry them out.' }],
  });
  if (!reply.yes) return false;
  kernl.grants.allowDomain(summary.identity, 'dm');
  // Beside messages, upload is withheld unless the person keeps it, here and nowhere else (D-046, D-060).
  if (reply.ticked.includes('upload')) kernl.grants.allowDomain(summary.identity, 'upload', { unsafe: true });
  return true;
}

async function open(summary: AppletSummary): Promise<void> {
  problem(undefined);
  if (!(await agree(summary))) return;
  try {
    const plan = await kernl.plan(summary);
    frame = document.createElement('iframe');
    frame.title = summary.title;
    $('#stage').replaceChildren(frame);
    handle = kernl.mount(plan, frame);
    $('#open').hidden = true;
  } catch (error) {
    problem(`Could not open ${summary.title}: ${(error as Error).message}`);
  }
}

async function show(): Promise<void> {
  try {
    const summary = await kernl.resolve(kernl.decodePointer(`kernl:${NOTE.id}`));
    $('#card-title').textContent = summary.title;
    $('#card-description').textContent = summary.description;
    $('#card-pin').textContent = `Pinned to sha256 ${NOTE.sha256.slice(0, 12)}…`;
    $('#open').onclick = () => void open(summary);
    $('#card').hidden = false;
  } catch (error) {
    const reason = (error as Error).message;
    problem(`${NOTE.title} was not opened: ${reason === 'invalid:artifact-hash' ? 'these are not the bytes this page pinned.' : reason}`);
  }
}

$('#sign-in').addEventListener('click', async () => {
  const session = await kernl.login(createThrowawayIdentity('Minimal host'));
  $('#who').textContent = `Signed in as ${session.pubkey}`;
  $('#sign-in').hidden = true;
  await show();
});
