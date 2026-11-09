import { IDENTITY_DOMAIN, KEYS_DOMAIN } from '@napplet/sdk';
import { MessagesApp } from './app.js';
import { runtimeHasDomain } from './domain-availability.js';
import { onAccountChanged, registerShortcut } from './shell.js';
import { followTheme } from './theme.js';
import './styles.css';
import './tiers.css';

const app = new MessagesApp();
const closers: Array<() => void> = [];
let disposed = false;

const SHORTCUTS = [
  { id: 'messages.new', label: 'New message', defaultKey: 'Ctrl+N', run: () => app.showNewMessage() },
  { id: 'messages.next', label: 'Next conversation', defaultKey: 'Alt+ArrowDown', run: () => app.step(1) },
  { id: 'messages.previous', label: 'Previous conversation', defaultKey: 'Alt+ArrowUp', run: () => app.step(-1) },
];

function followAccount(): void {
  if (!runtimeHasDomain(IDENTITY_DOMAIN)) return;
  try {
    const subscription = onAccountChanged(() => void app.start());
    closers.push(() => subscription.close());
  } catch {
    // Without account changes the owner named by the message status still holds.
  }
}

/**
 * Shortcuts are offered to the shell, which owns the keymap; the default keys
 * are suggestions. With no key handling in the shell the buttons do the same.
 */
async function registerShortcuts(): Promise<void> {
  if (!runtimeHasDomain(KEYS_DOMAIN)) return;
  for (const { run, ...action } of SHORTCUTS) {
    try {
      const close = await registerShortcut(action, run);
      if (disposed) close();
      else closers.push(close);
    } catch {
      // This one action stays button-only.
    }
  }
}

function dispose(): void {
  if (disposed) return;
  disposed = true;
  app.dispose();
  for (const close of closers.splice(0)) close();
}

/**
 * Order matters: the shell drops what an applet sends over its budget, and
 * the first second is the tightest. The list comes first (four requests); the
 * current theme and the shortcuts are queued behind it as soon as it has been
 * asked for, or once startup ends without a list. Listening for account
 * changes sends nothing, so it starts at once.
 */
function boot(): void {
  let queued = false;
  const queueTheRest = (): void => {
    if (queued) return;
    queued = true;
    const themeSubscription = followTheme();
    if (themeSubscription) closers.push(() => themeSubscription.close());
    void registerShortcuts();
  };
  followAccount();
  window.addEventListener('pagehide', dispose);
  void app.start(queueTheRest).finally(queueTheRest);
}

boot();

// Opening a conversation on another applet's request (`napplet:dm/open`) is
// declared in the manifest but not wired here: the installed SDK has no call
// for receiving such a request. Once it has one, route it through ./shell.js;
// the whole handler is `app.openDirect(parseOpenRequest(payload))`.
