import type { MediaPlayback, MediaService, MediaSessionSnapshot } from '@kehto/services';
import type { MediaSettings } from './settings.js';

type Send = (message: unknown) => void;

/** States in which a session holds the output. */
export const ACTIVE = new Set(['playing', 'buffering']);

/** How the shell pauses and resumes sessions for its own reasons. */
export interface MediaSteering {
  /** Keep a playback the backend opened, to command it directly later. */
  hold(playback: MediaPlayback): void;
  /** The playback kept for a session the shell plays, when it shows something to find it by. */
  held(sessionId: string): MediaPlayback | undefined;
  /** Where to reach a window's applet. */
  reach(windowId: string, send: Send): void;
  forget(windowId: string): void;
  /** Ask the owner to pause or resume for a reason the shell gives. */
  steer(session: MediaSessionSnapshot, action: 'play' | 'pause', reason: 'focus-lost' | 'focus-gained'): void;
  /** `winner` has the output: under one at a time, everything else playing gives it up. */
  takeOver(winner: string): void;
}

/**
 * kehto stamps every command it sends `user`, so a pause the shell decides goes around it: to the
 * playback kehto opened through kernl's backend, or straight to the applet for its own media. An
 * applet's own player that cannot pause is ended, as NAP-MEDIA requires (D-063).
 *
 * @param service - kehto's media service.
 * @param settings - The person's media settings now.
 * @returns The steering.
 * @example
 * ```ts
 * const steering = createMediaSteering(service, () => settings$.value);
 * steering.takeOver('media-2');
 * ```
 */
export function createMediaSteering(service: MediaService, settings: () => MediaSettings): MediaSteering {
  // A playback is found again by its element, the one thing kehto hands back for a session.
  const playbacks = new WeakMap<object, MediaPlayback>();
  const sends = new Map<string, Send>();

  function held(sessionId: string): MediaPlayback | undefined {
    const element = service.getElement(sessionId);
    return element && playbacks.get(element);
  }

  function steer(session: MediaSessionSnapshot, action: 'play' | 'pause', reason: 'focus-lost' | 'focus-gained'): void {
    if (session.owner === 'shell') {
      const playback = held(session.sessionId);
      // A backend that shows nothing hands back no element to find it by; kehto's own command still reaches it, as the person's.
      if (playback) playback.command({ action, reason });
      else service.command(session.sessionId, { action });
      return;
    }
    if (!session.actions.includes(action)) {
      if (action === 'pause') service.retire(session.sessionId, 'policy');
      return;
    }
    (sends.get(session.windowId) as Send)({ type: 'media.command', sessionId: session.sessionId, action, reason });
  }

  return {
    hold(playback) {
      if (playback.element) playbacks.set(playback.element, playback);
    },
    held,
    reach: (windowId, send) => void sends.set(windowId, send),
    forget: (windowId) => void sends.delete(windowId),
    steer,
    takeOver(winner) {
      const { concurrency, takeover } = settings();
      if (concurrency !== 'one') return;
      for (const session of service.getSessions()) {
        if (session.sessionId === winner || !ACTIVE.has(String(session.state?.status))) continue;
        if (takeover === 'end') service.retire(session.sessionId, 'preempted');
        else steer(session, 'pause', 'focus-lost');
      }
    },
  };
}
