import { createAskRenderers } from '@kernlize/ui-model';
import type { AskRenderers, KernlHost, StorageLike } from './contract';
import type { ConsentQueue } from './consent-queue.svelte';
import type { FirewallQueue } from './firewall-queue.svelte';
import type { HandlerQueue } from './handler-queue.svelte';
import type { NoticeStore } from './notice-store.svelte';
import type { ReplyQueue } from './reply-queue.svelte';
import type { SettingsQueue } from './settings-queue.svelte';
import type { ShortcutRunner } from './shortcuts';
import { describeStop } from './stop-words';
import type { WindowStore } from './window-store.svelte';

interface HostDeps {
  readonly storage: StorageLike;
  readonly consent: Pick<ConsentQueue, 'model'>;
  readonly firewall: Pick<FirewallQueue, 'model'>;
  readonly settings: Pick<SettingsQueue, 'model'>;
  readonly notices: NoticeStore;
  readonly windows: WindowStore;
  readonly handlers: Pick<HandlerQueue, 'model'>;
  readonly replies: Pick<ReplyQueue, 'model'>;
  readonly opener: AppletOpener;
  readonly shortcuts: ShortcutRunner;
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

/**
 * A view of `storage` whose keys all carry `prefix`. The preview keeps its state under its
 * own prefix, so the applets a person ran or kept in the live shell never show up in the preview,
 * which cannot open them, and what they try in the preview never follows them into the live shell.
 */
export function scopedStorage(storage: StorageLike, prefix: string): StorageLike {
  return {
    getItem: (key) => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, value),
    removeItem: (key) => storage.removeItem(prefix + key),
  };
}

/** The prefix the preview keeps its state under. */
export const PREVIEW_STORAGE_PREFIX = 'preview:';

/** Every question the kernel puts to the person, each kind waiting in its dialog's queue (D-067, #74). */
function asksFor(deps: HostDeps): AskRenderers {
  const consent = deps.consent.model;
  return createAskRenderers({
    'sign.replace': consent,
    'upload.file': consent,
    'download.add': consent,
    'connection.direct': consent,
    'firewall.approve': deps.firewall.model,
    'intent.choose-handler': deps.handlers.model,
    'messaging.choose-reply': deps.replies.model,
    'settings.present': deps.settings.model,
  });
}

/** The UI's side of the contract: dialogs, firewall questions, applet settings, the handler chooser, the reply question, toasts, link confirmation, opening and focusing windows. */
export function createHost(deps: HostDeps): KernlHost {
  return {
    storage: deps.storage,
    asks: asksFor(deps),
    notify: (notice) => void deps.notices.push(notice),
    openLink(url, options) {
      // The firewall already put this link to the person, or a rule of theirs let it through; anything else is asked about here.
      if (!options?.approved && !window.confirm(`Leave kernl and open this link?\n\n${url}`)) return;
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    getVisibility: (windowId) => deps.windows.visibilityOf(windowId),
    openApplet: async (address) => deps.opener.open?.(address),
    focusApplet: (windowId) => deps.windows.focus(windowId),
    onShortcut: (key) => deps.shortcuts.run?.(key),
    onRevoked(windowId, reason, details) {
      const title = deps.windows.get(windowId)?.plan.summary.title ?? 'An applet';
      const report = describeStop(reason, details, Date.now());
      deps.windows.markRevoked(windowId, report);
      // A stopped applet's questions go with it, each answered with its refusal (#74).
      for (const queue of [deps.consent, deps.firewall, deps.handlers, deps.replies, deps.settings]) queue.model.dismissWindow(windowId);
      deps.notices.push({ title: `${title} was stopped`, body: report.words, tone: 'warning', windowId });
    },
  };
}
