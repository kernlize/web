import type { KernlHost, StorageLike } from './contract';
import type { ConsentQueue } from './consent-queue.svelte';
import type { NoticeStore } from './notice-store.svelte';
import type { WindowStore } from './window-store.svelte';

interface HostDeps {
  readonly storage: StorageLike;
  readonly consent: ConsentQueue;
  readonly notices: NoticeStore;
  readonly windows: WindowStore;
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

/** The UI's side of the contract: dialogs, toasts, link confirmation and window visibility. */
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
    onRevoked(windowId, reason) {
      const title = deps.windows.get(windowId)?.plan.summary.title ?? 'An applet';
      deps.windows.markRevoked(windowId, reason);
      deps.notices.push({ title: `${title} was stopped`, body: reason, tone: 'warning', windowId });
    },
  };
}
