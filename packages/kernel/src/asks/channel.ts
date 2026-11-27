import type { KernlHost } from '../types.js';
import { ASK_REFUSALS, type Ask, type AskAnswer, type AskKind, type AskRenderer } from './kinds.js';

/** The host's side of the asks: one renderer per kind it draws. */
export type AskHost = Pick<KernlHost, 'asks'>;

/** Puts questions to the person through the host's renderers. */
export interface AskChannel {
  /** Whether the host has a renderer for this kind. */
  has(kind: AskKind): boolean;
  /**
   * Ask, and resolve with the person's answer. Resolves with the kind's refusal when nothing draws
   * the kind, when the renderer throws or rejects, and when the window that asked has closed by the
   * time it answers. Never rejects. Nothing here times an ask out.
   */
  ask<K extends AskKind>(ask: Ask<K>): Promise<AskAnswer<K>>;
}

/** Options for {@link createAskChannel}. */
export interface AskChannelOptions {
  readonly host: AskHost;
  /** Whether the window that asked still runs the applet that asked; an answer for one that does not is discarded. Every window counts as open without it. */
  readonly isAsking?: (windowId: string, ask: Ask) => boolean;
}

function rendererFor<K extends AskKind>(host: AskHost, kind: K): AskRenderer<K> | undefined {
  const own = host.asks?.[kind] as AskRenderer<K> | undefined;
  return own ? (ask) => own.call(host.asks, ask) : undefined;
}

/**
 * The kernel's ask channel over a host (D-067). A kind the host registers in `asks` is drawn by
 * that renderer; any other kind is refused. The kernel decides that the person is asked and what
 * they are told; the host decides how it looks.
 *
 * @param options - The host, and how to tell whether the window that asked is still open.
 * @returns The channel.
 * @example
 * ```ts
 * const asks = createAskChannel({ host });
 * const allowed = await asks.ask({ kind: 'upload.file', windowId, applet, facts: details, defaultText: describeUpload(details, applet) });
 * ```
 */
export function createAskChannel(options: AskChannelOptions): AskChannel {
  const { host } = options;
  return {
    has: (kind) => rendererFor(host, kind) !== undefined,
    async ask<K extends AskKind>(ask: Ask<K>): Promise<AskAnswer<K>> {
      const refusal = ASK_REFUSALS[ask.kind] as AskAnswer<K>;
      const render = rendererFor(host, ask.kind);
      if (!render) return refusal;
      let answer: AskAnswer<K>;
      try {
        answer = await render(ask);
      } catch {
        return refusal;
      }
      // The answer is the asking window's only: once it has closed, or runs another applet, it applies to nothing.
      if (ask.windowId !== undefined && options.isAsking && !options.isAsking(ask.windowId, ask)) return refusal;
      return answer;
    },
  };
}

/**
 * The channel a host or a channel stands for: a host's own, built from its renderers, or the
 * kernel's, which also discards answers for windows that have closed.
 *
 * @param source - A host, or the kernel's channel.
 * @returns The channel.
 * @example
 * ```ts
 * const asks = toAskChannel(host); // the same as createAskChannel({ host })
 * ```
 */
export function toAskChannel(source: AskHost | AskChannel): AskChannel {
  return 'ask' in source && 'has' in source ? source : createAskChannel({ host: source });
}
