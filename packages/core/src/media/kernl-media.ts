import { createMediaService, type HostMediaBridge, type MediaPlayback, type MediaPlaybackBackend, type MediaPlaybackCommand, type MediaService, type MediaSessionSnapshot } from '@kehto/services';
import type { ServiceHandler } from '@kehto/runtime';
import { BehaviorSubject, type Observable } from 'rxjs';
import type { StorageLike } from '../types.js';
import { createKeptSessions, type KeptSession, type KeptSessions } from './kept.js';
import { ACTIVE, createMediaSteering, type MediaSteering } from './steering.js';
import { mediaSettingsFrom, readMediaSettings, writeMediaSettings, type MediaSettings } from './settings.js';

/** A session as the shell's player shows it. */
export interface MediaSessionView extends MediaSessionSnapshot {
  /** True when the shell plays a video for it, which needs somewhere to be shown. */
  readonly video: boolean;
  /** The session the player's controls are for: the one started last, or else the newest. */
  readonly current: boolean;
  /** The shell plays it on after its applet closed; the applet can no longer reach it. */
  readonly detached: boolean;
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

/**
 * The `media` service under the person's media settings (D-063). kehto keeps the sessions, plays
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
  const pausedWhileHidden = new Set<string>();
  const hiddenWindows = new Set<string>();
  let started: string[] = [];
  let statuses = new Map<string, string | undefined>();

  const kept = createKeptSessions({ started: (id) => start(id), changed: () => publish() });
  const playback = options.playback && keptBackend(options.playback, () => settings$.value, kept, (opened) => steering.hold(opened));
  const service = createMediaService({ ...(playback ? { playback } : {}), ...(options.hostBridge ? { hostBridge: options.hostBridge } : {}) });
  const steering = createMediaSteering(service, () => settings$.value);
  const sessions$ = new BehaviorSubject<readonly MediaSessionView[]>([]);

  function takeOver(winner: string): void {
    steering.takeOver(winner);
    const { concurrency, takeover } = settings$.value;
    if (concurrency === 'one') kept.yieldTo(winner, takeover);
  }

  function start(id: string): void {
    started = [...started.filter((other) => other !== id), id];
    takeOver(id);
  }

  function publish(): void {
    sessions$.next(viewsOf(service, kept, started));
  }

  function observe(sessions: readonly MediaSessionSnapshot[]): void {
    const fresh = sessions.filter((session) => session.state?.status === 'playing' && statuses.get(session.sessionId) !== 'playing').map((session) => session.sessionId);
    statuses = new Map(sessions.map((session) => [session.sessionId, session.state?.status]));
    const live = new Set([...statuses.keys(), ...kept.all().map((session) => session.id)]);
    started = started.filter((id) => live.has(id));
    // A pause or failure the shell did not cause means the person or the applet decided; that is not undone on show.
    for (const id of pausedWhileHidden) {
      const reason = sessions.find((session) => session.sessionId === id)?.state?.reason;
      if (!live.has(id) || (reason !== undefined && reason !== 'focus-lost')) pausedWhileHidden.delete(id);
    }
    for (const id of fresh) start(id);
    publish();
  }

  const unsubscribe = service.subscribe(observe);

  const handler: ServiceHandler = {
    ...service,
    handleMessage(windowId, message, send) {
      steering.reach(windowId, send as Send);
      if (refusesPlay(message, settings$.value, hiddenWindows.has(windowId), () => options.isFocused(windowId))) return;
      service.handleMessage(windowId, message, send);
    },
    onWindowDestroyed(windowId) {
      steering.forget(windowId);
      hiddenWindows.delete(windowId);
      // Detached before kehto retires them, so nothing is sent to the closed applet and the person stops them (D-063).
      const adopted = keepOnClose(service, steering, kept, windowId, settings$.value.closed);
      started = started.map((id) => adopted.find((session) => session.from === id)?.id ?? id);
      service.onWindowDestroyed?.(windowId);
      if (settings$.value.closed === 'pause') for (const session of adopted) if (ACTIVE.has(String(session.snapshot.state?.status))) session.playback.command({ action: 'pause', reason: 'focus-lost' });
      publish();
    },
  };

  const statusOf = (id: string): string => String(kept.get(id)?.snapshot.state?.status ?? statuses.get(id));

  return {
    handler,
    sessions$: sessions$.asObservable(),
    settings$: settings$.asObservable(),
    settings: () => settings$.value,
    configure(change) {
      const next = writeMediaSettings(options.storage, mediaSettingsFrom({ ...settings$.value, ...change }));
      settings$.next(next);
      const latest = started.filter((id) => ACTIVE.has(statusOf(id))).at(-1);
      if (latest) takeOver(latest);
      return next;
    },
    command(sessionId, command) {
      pausedWhileHidden.delete(sessionId);
      const detached = kept.get(sessionId);
      if (!detached) service.command(sessionId, command);
      else if (detached.snapshot.actions.includes(command.action)) detached.playback.command({ ...command, reason: 'user' });
    },
    end(sessionId) {
      const detached = kept.get(sessionId);
      if (detached) kept.end(detached);
      else service.retire(sessionId, 'user');
    },
    element: (sessionId) => kept.get(sessionId)?.playback.element ?? service.getElement(sessionId),
    setWindowVisible(windowId, visible) {
      if (visible) hiddenWindows.delete(windowId);
      else hiddenWindows.add(windowId);
      if (settings$.value.hidden !== 'pause') return;
      for (const session of service.getSessions()) {
        if (session.windowId !== windowId) continue;
        if (!visible && ACTIVE.has(String(session.state?.status))) {
          pausedWhileHidden.add(session.sessionId);
          steering.steer(session, 'pause', 'focus-lost');
        } else if (visible && pausedWhileHidden.delete(session.sessionId)) {
          steering.steer(session, 'play', 'focus-gained');
        }
      }
    },
    destroy() {
      unsubscribe();
      for (const session of kept.all()) kept.end(session);
      service.destroy();
      sessions$.complete();
      settings$.complete();
    },
  };
}

/**
 * An applet's own Play on a session the shell plays: the person's settings decide when media
 * starts, so it counts only while they are working in the applet and can see it. Dropped
 * silently, as NAP-MEDIA asks of a command the shell will not carry out.
 */
function refusesPlay(message: unknown, settings: MediaSettings, hidden: boolean, focused: () => boolean): boolean {
  const { type, action } = message as { type?: unknown; action?: unknown };
  if (type !== 'media.command' || action !== 'play') return false;
  return (settings.hidden === 'pause' && hidden) || (settings.autoplay === 'block' && !focused());
}

/** The backend kehto is given: autoplay as the person allows, and each playback wrapped so it can outlive its applet. */
function keptBackend(backend: MediaPlaybackBackend, settings: () => MediaSettings, kept: KeptSessions, hold: (playback: MediaPlayback) => void): MediaPlaybackBackend {
  return {
    async open(windowId, request, signal, changed) {
      const allowed = settings().autoplay === 'allow' ? request : { ...request, autoplay: false };
      let opened: MediaPlayback | undefined;
      // A kept playback reports to the shell alone: kehto has let its session go.
      const report: typeof changed = (state, actions) => {
        if (!opened || !kept.report(opened, state, actions)) changed(state, actions);
      };
      opened = await backend.open(windowId, allowed, signal, report);
      hold(opened);
      return kept.wrap(opened);
    },
  };
}

/** Adopt the sessions the shell plays for a closing window, unless the person chose to stop them. */
function keepOnClose(service: MediaService, steering: MediaSteering, kept: KeptSessions, windowId: string, closed: MediaSettings['closed']): KeptSession[] {
  if (closed === 'stop') return [];
  return service.getSessions().flatMap((session) => {
    const playback = session.windowId === windowId && session.owner === 'shell' ? steering.held(session.sessionId) : undefined;
    return playback ? [kept.adopt(playback, session)] : [];
  });
}

/** What the player lists: kehto's sessions, then those kept after their applets closed. */
function viewsOf(service: MediaService, kept: KeptSessions, started: readonly string[]): MediaSessionView[] {
  const views = [
    ...service.getSessions().map((session) => ({ ...session, detached: false, video: service.getElement(session.sessionId)?.tagName === 'VIDEO' })),
    ...kept.all().map((session) => ({ ...session.snapshot, detached: true, video: session.playback.element?.tagName === 'VIDEO' })),
  ];
  const live = new Set(views.map((view) => view.sessionId));
  const current = started.filter((id) => live.has(id)).at(-1) ?? views.at(-1)?.sessionId;
  return views.map((view) => ({ ...view, current: view.sessionId === current }));
}
