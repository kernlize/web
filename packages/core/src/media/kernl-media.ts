import { createMediaService, type HostMediaBridge, type MediaPlayback, type MediaPlaybackBackend, type MediaPlaybackCommand, type MediaSessionSnapshot } from '@kehto/services';
import type { ServiceHandler } from '@kehto/runtime';
import { BehaviorSubject, type Observable } from 'rxjs';
import type { StorageLike } from '../types.js';
import { mediaSettingsFrom, readMediaSettings, writeMediaSettings, type MediaSettings } from './settings.js';

/** A session as the shell's player shows it. */
export interface MediaSessionView extends MediaSessionSnapshot {
  /** True when the shell plays a video for it, which needs somewhere to be shown. */
  readonly video: boolean;
  /** The session the player's controls are for: the one started last, or else the newest. */
  readonly current: boolean;
}

/** What the person can do from the shell's player. */
export type MediaUserCommand = Pick<MediaPlaybackCommand, 'action' | 'value'>;

/** The shell's media: the `media` service applets talk to, and what its player needs. */
export interface KernlMedia {
  /** Registered as the `media` service. */
  readonly handler: ServiceHandler;
  /** Every session, oldest first. */
  readonly sessions$: Observable<readonly MediaSessionView[]>;
  readonly settings$: Observable<MediaSettings>;
  settings(): MediaSettings;
  /** Change some settings; they are kept, and take effect on what is playing now. */
  configure(change: Partial<MediaSettings>): MediaSettings;
  /** The person pressed a control. */
  command(sessionId: string, command: MediaUserCommand): void;
  /** The person ended a session. */
  end(sessionId: string): void;
  /** The element a shell-played session plays in, to be shown. */
  element(sessionId: string): HTMLMediaElement | undefined;
  /** An applet's window was hidden or shown. */
  setWindowVisible(windowId: string, visible: boolean): void;
  destroy(): void;
}

/** Dependencies for {@link createKernlMedia}. */
export interface KernlMediaOptions {
  readonly storage: StorageLike;
  /** Plays what applets ask the shell to play; without it only applets' own media is listed. */
  readonly playback?: MediaPlaybackBackend;
  /** The operating system's media controls; the browser's by default. */
  readonly hostBridge?: HostMediaBridge;
  /** Whether the person is working in an applet's window now. */
  readonly isFocused: (windowId: string) => boolean;
}

type Send = (message: unknown) => void;

const ACTIVE = new Set(['playing', 'buffering']);

/**
 * The `media` service under the person's media settings (D-061). kehto keeps the sessions, plays
 * what an applet asks the shell to play, and mirrors the current one to the operating system; this
 * decides what may play at once, whether a session may start on its own, and what a hidden window
 * does. A session the shell pauses on its own is paused with `focus-lost`, never `user`, and only a
 * session it paused that way is resumed, with `focus-gained`.
 *
 * @param options - Storage for the settings, the playback backend and the OS bridge.
 * @returns The service and the player's view of it.
 * @example
 * ```ts
 * const media = createKernlMedia({ storage, playback: createBrowserMediaPlayback({ resource }), isFocused: (windowId) => wm.isFocused(windowId) });
 * registry.media = media.handler;
 * media.sessions$.subscribe((sessions) => draw(sessions));
 * ```
 */
export function createKernlMedia(options: KernlMediaOptions): KernlMedia {
  const settings$ = new BehaviorSubject<MediaSettings>(readMediaSettings(options.storage));
  // A playback is found again by its element, the one thing kehto hands back for a session.
  const playbacks = new WeakMap<object, MediaPlayback>();
  const sends = new Map<string, Send>();
  const pausedWhileHidden = new Set<string>();
  const hiddenWindows = new Set<string>();
  let started: string[] = [];
  let statuses = new Map<string, string | undefined>();

  const playback: MediaPlaybackBackend | undefined = options.playback && {
    open: async (windowId, request, signal, changed) => {
      const allowed = settings$.value.autoplay === 'allow' ? request : { ...request, autoplay: false };
      const opened = await (options.playback as MediaPlaybackBackend).open(windowId, allowed, signal, changed);
      if (opened.element) playbacks.set(opened.element, opened);
      return opened;
    },
  };
  const service = createMediaService({ ...(playback ? { playback } : {}), ...(options.hostBridge ? { hostBridge: options.hostBridge } : {}) });
  const sessions$ = new BehaviorSubject<readonly MediaSessionView[]>([]);

  /** Ask the owner to pause or resume for a reason the shell gives; an applet's own player that cannot pause is ended. */
  function steer(session: MediaSessionSnapshot, action: 'play' | 'pause', reason: 'focus-lost' | 'focus-gained'): void {
    if (session.owner === 'shell') {
      const held = playbacks.get(service.getElement(session.sessionId) ?? session);
      // A backend that shows nothing hands back no element to find it by; kehto's own command still reaches it, as the person's.
      if (held) held.command({ action, reason });
      else service.command(session.sessionId, { action });
      return;
    }
    if (!session.actions.includes(action)) {
      if (action === 'pause') service.retire(session.sessionId, 'policy');
      return;
    }
    (sends.get(session.windowId) as Send)({ type: 'media.command', sessionId: session.sessionId, action, reason });
  }

  /** `winner` has the output: under one at a time, everything else playing gives it up. */
  function takeOver(winner: string): void {
    const { concurrency, takeover } = settings$.value;
    if (concurrency !== 'one') return;
    for (const session of service.getSessions()) {
      if (session.sessionId === winner || !ACTIVE.has(session.state?.status ?? '')) continue;
      if (takeover === 'end') service.retire(session.sessionId, 'preempted');
      else steer(session, 'pause', 'focus-lost');
    }
  }

  function publish(): void {
    const sessions = service.getSessions();
    const live = new Set(sessions.map((session) => session.sessionId));
    const current = started.filter((id) => live.has(id)).at(-1) ?? sessions.at(-1)?.sessionId;
    sessions$.next(sessions.map((session) => ({
      ...session,
      video: service.getElement(session.sessionId)?.tagName === 'VIDEO',
      current: session.sessionId === current,
    })));
  }

  function observe(sessions: readonly MediaSessionSnapshot[]): void {
    const fresh = sessions.filter((session) => session.state?.status === 'playing' && statuses.get(session.sessionId) !== 'playing').map((session) => session.sessionId);
    statuses = new Map(sessions.map((session) => [session.sessionId, session.state?.status]));
    const live = new Set(statuses.keys());
    started = started.filter((id) => live.has(id));
    // A pause or failure the shell did not cause means the person or the applet decided; that is not undone on show.
    for (const id of pausedWhileHidden) {
      const reason = sessions.find((session) => session.sessionId === id)?.state?.reason;
      if (!live.has(id) || (reason !== undefined && reason !== 'focus-lost')) pausedWhileHidden.delete(id);
    }
    for (const id of fresh) {
      started = [...started.filter((other) => other !== id), id];
      takeOver(id);
    }
    publish();
  }

  const unsubscribe = service.subscribe(observe);

  /**
   * An applet's own Play on a session the shell plays: the person's settings decide when media
   * starts, so it counts only while they are working in the applet and can see it. Dropped
   * silently, as NAP-MEDIA asks of a command the shell will not carry out.
   */
  function refusesPlay(windowId: string, message: unknown): boolean {
    const { type, action } = message as { type?: unknown; action?: unknown };
    if (type !== 'media.command' || action !== 'play') return false;
    const { autoplay, hidden } = settings$.value;
    return (hidden === 'pause' && hiddenWindows.has(windowId)) || (autoplay === 'block' && !options.isFocused(windowId));
  }

  const handler: ServiceHandler = {
    ...service,
    handleMessage(windowId, message, send) {
      sends.set(windowId, send as Send);
      if (refusesPlay(windowId, message)) return;
      service.handleMessage(windowId, message, send);
    },
    onWindowDestroyed(windowId) {
      sends.delete(windowId);
      hiddenWindows.delete(windowId);
      service.onWindowDestroyed?.(windowId);
    },
  };

  return {
    handler,
    sessions$: sessions$.asObservable(),
    settings$: settings$.asObservable(),
    settings: () => settings$.value,
    configure(change) {
      const next = writeMediaSettings(options.storage, mediaSettingsFrom({ ...settings$.value, ...change }));
      settings$.next(next);
      const latest = started.filter((id) => ACTIVE.has(String(statuses.get(id)))).at(-1);
      if (latest) takeOver(latest);
      return next;
    },
    command(sessionId, command) {
      pausedWhileHidden.delete(sessionId);
      service.command(sessionId, command);
    },
    end: (sessionId) => service.retire(sessionId, 'user'),
    element: (sessionId) => service.getElement(sessionId),
    setWindowVisible(windowId, visible) {
      if (visible) hiddenWindows.delete(windowId);
      else hiddenWindows.add(windowId);
      if (settings$.value.hidden !== 'pause') return;
      for (const session of service.getSessions()) {
        if (session.windowId !== windowId) continue;
        if (!visible && ACTIVE.has(String(session.state?.status))) {
          pausedWhileHidden.add(session.sessionId);
          steer(session, 'pause', 'focus-lost');
        } else if (visible && pausedWhileHidden.delete(session.sessionId)) {
          steer(session, 'play', 'focus-gained');
        }
      }
    },
    destroy() {
      unsubscribe();
      service.destroy();
      sessions$.complete();
      settings$.complete();
    },
  };
}
