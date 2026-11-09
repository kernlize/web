import type { KernlHost, StorageLike } from './contract';
import type { ConsentQueue } from './consent-queue.svelte';
import type { HandlerQueue } from './handler-queue.svelte';
import type { NoticeStore } from './notice-store.svelte';
import type { WindowStore } from './window-store.svelte';

interface HostDeps {
  readonly storage: StorageLike;
  readonly consent: ConsentQueue;
  readonly notices: NoticeStore;
  readonly windows: WindowStore;
  readonly handlers: Pick<HandlerQueue, 'ask'>;
  readonly opener: AppletOpener;
}

/**
 * How the core asks the desktop to open an applet for a request another applet made. The desktop
 * fills `open` once it is on screen; until then nothing opens and the request is reported as failed.
 */
export interface AppletOpener {
  open?: (address: string) => Promise<string | undefined>;
}

/** `localStorage` when the browser allows it, otherwise a page-lifetime map. */
export function pickStorage(): StorageLike {
  try {
    const probe = '__kernl_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
      removeItem: (key) => void memory.delete(key),
    };
  }
}

const REVOKE_REASONS: Readonly<Record<string, string>> = {
  quarantine: 'The guard stopped it because it kept flooding the shell.',
  host: 'The shell closed it.',
};

/** Plain words for a revocation reason; reasons the shell does not know pass through. */
const revokeReason = (reason: string): string => REVOKE_REASONS[reason] ?? reason;

/** The UI's side of the contract: dialogs, the handler chooser, toasts, link confirmation, opening and focusing windows. */
export function createHost(deps: HostDeps): KernlHost {
  return {
    storage: deps.storage,
    presentConsent: (prompt) => deps.consent.enqueue(prompt),
    notify: (notice) => void deps.notices.push(notice),
    openLink(url) {
      if (!window.confirm(`Leave kernl and open this link?\n\n${url}`)) return;
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    getVisibility: (windowId) => deps.windows.visibilityOf(windowId),
    chooseHandler: (prompt) => deps.handlers.ask(prompt),
    openApplet: async (address) => deps.opener.open?.(address),
    focusApplet: (windowId) => deps.windows.focus(windowId),
    onRevoked(windowId, reason) {
      const title = deps.windows.get(windowId)?.plan.summary.title ?? 'An applet';
      const words = revokeReason(reason);
      deps.windows.markRevoked(windowId, words);
      deps.notices.push({ title: `${title} was stopped`, body: words, tone: 'warning', windowId });
    },
  };
}
