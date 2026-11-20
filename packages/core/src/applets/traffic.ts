import { Subject, type Observable } from 'rxjs';
import { originRegistry } from '@kehto/shell';

/** Which way a message went, from the applet's side. */
export type AppletMessageDirection = 'from-applet' | 'to-applet';

/**
 * One message between an applet and the shell. `via` is the channel: `window` for a window-level
 * message (NIP-5D allows one, `napplet.hello`), `port` for everything on the bound port.
 */
export interface AppletMessage {
  readonly windowId: string;
  readonly direction: AppletMessageDirection;
  readonly via: 'window' | 'port';
  /** The envelope's `type`, or `unknown` for anything that is not an envelope. */
  readonly type: string;
  /** What failed, when the envelope reports a failure; see {@link appletMessageFailure}. */
  readonly error?: string;
  /** The message itself. It can hold private messages, signed events and stored values: keep it in memory only. */
  readonly message: unknown;
  readonly at: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined);

/**
 * What an envelope says failed: its `error` string, or for a `*.error` envelope its `message`,
 * its `reason` or its type. kehto's runtime answers a failed request with a `*.result` carrying
 * `error`, so this covers its replies; kehto's own devtools read envelopes the same way.
 *
 * @param message - Any message an applet sent or received.
 * @returns The failure, or `undefined` when the message reports none.
 * @example
 * ```ts
 * appletMessageFailure({ type: 'inc.channel.open.result', id: '1', error: 'target denied' }); // 'target denied'
 * appletMessageFailure({ type: 'storage.get.result', id: '2', value: 'x' }); // undefined
 * ```
 */
export function appletMessageFailure(message: unknown): string | undefined {
  if (!isRecord(message)) return undefined;
  const error = text(message.error);
  if (error) return error;
  const type = text(message.type);
  if (!type?.endsWith('.error')) return undefined;
  return text(message.message) ?? text(message.reason) ?? type;
}

/**
 * Describe one message for {@link AppletMessage} reporting, timestamped now.
 *
 * @param windowId - The applet's window.
 * @param direction - Which way it went.
 * @param via - The channel it went over.
 * @param message - The message itself.
 * @returns The report.
 * @example
 * ```ts
 * describeAppletMessage('applet-1', 'to-applet', 'port', { type: 'shell.init', id: '1' }).type; // 'shell.init'
 * ```
 */
export function describeAppletMessage(windowId: string, direction: AppletMessageDirection, via: AppletMessage['via'], message: unknown): AppletMessage {
  const type = isRecord(message) ? text(message.type) : undefined;
  const error = appletMessageFailure(message);
  return { windowId, direction, via, type: clip(type ?? 'unknown', TYPE_LIMIT), message, at: Date.now(), ...(error ? { error: clip(error, ERROR_LIMIT) } : {}) };
}

// An applet chooses its envelopes' `type` and `error`; neither is let grow without bound.
const TYPE_LIMIT = 128;
const ERROR_LIMIT = 512;
const clip = (value: string, limit: number): string => (value.length > limit ? `${value.slice(0, limit)}…` : value);

type Outgoing = (windowId: string, message: unknown) => void;
type Send = typeof originRegistry.postToNapplet;

/** The wrapper in place now, its listeners, and what it wrapped. */
let installed: { readonly wrapper: Send; readonly original: Send; readonly listeners: Set<Outgoing> } | undefined;

/**
 * Hear every message kehto sends to an applet. kehto's shell adapter has an observe-only hook for
 * what arrives on a port (`onNappletMessage`) and none for what it sends, so this wraps
 * `originRegistry.postToNapplet`, the one function every reply goes through, as kehto's own devtools
 * do. The wrapper is shared by every shell on the page and removed when the last one stops listening,
 * unless something wrapped it in turn, which is then left in place with the wrapper gone quiet.
 * Only what kehto delivered is heard.
 */
function hearOutgoing(listener: Outgoing): () => void {
  if (!installed) {
    const original = originRegistry.postToNapplet;
    const listeners = new Set<Outgoing>();
    const wrapper: Send = (windowId, message) => {
      const delivered = original.call(originRegistry, windowId, message);
      if (delivered) for (const each of listeners) each(windowId, message);
      return delivered;
    };
    originRegistry.postToNapplet = wrapper;
    installed = { wrapper, original, listeners };
  }
  const { listeners } = installed;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || installed?.listeners !== listeners) return;
    if (originRegistry.postToNapplet === installed.wrapper) originRegistry.postToNapplet = installed.original;
    installed = undefined;
  };
}

/** The shell's side of {@link AppletMessage} reporting. */
export interface AppletTraffic {
  readonly traffic$: Observable<AppletMessage>;
  /** Report a message an applet sent. */
  fromApplet(windowId: string, via: AppletMessage['via'], message: unknown): void;
  /** Stop reporting; idempotent. */
  close(): void;
}

/**
 * Report what this shell's applets send and receive, for the windows `owns` accepts. Window ids
 * are counted per shell, so two shells on one page can both have an `applet-1` and would each hear
 * the other's; a host runs one shell per page.
 *
 * @param owns - Whether a window belongs to this shell.
 * @returns The stream and the hooks that feed it.
 * @example
 * ```ts
 * const traffic = createAppletTraffic((windowId) => handles.has(windowId));
 * traffic.traffic$.subscribe((message) => log.push(message));
 * ```
 */
export function createAppletTraffic(owns: (windowId: string) => boolean): AppletTraffic {
  const traffic$ = new Subject<AppletMessage>();
  const stop = hearOutgoing((windowId, message) => {
    if (owns(windowId)) traffic$.next(describeAppletMessage(windowId, 'to-applet', 'port', message));
  });
  return {
    traffic$: traffic$.asObservable(),
    fromApplet: (windowId, via, message) => traffic$.next(describeAppletMessage(windowId, 'from-applet', via, message)),
    close() {
      stop();
      traffic$.complete();
    },
  };
}
