import { createDmService, createIdentityService, createNotifyService, createThemeService } from '@kehto/services';
import type { MessagingRegistry } from '@kernlize/messaging';
import { labelConversations, locateRecipients, type AppletMessageDirection, type Profiles } from '@kernlize/core';
import { createPreviewPeople } from './preview-people';
import type { KernlHost } from './contract';
import type { ShellTheme } from './shell-theme';

/** The domains the preview can put behind an applet's port. Anything else is left out of its environment. */
export const PORT_DOMAINS: readonly string[] = ['dm', 'identity', 'theme', 'notify'];

type Envelope = { readonly type: string; readonly id?: unknown };
type Handler = ReturnType<typeof createThemeService>['handler'];

/** The part of a `MessagePort` the preview uses; a test hands in a plain object. */
export interface PortLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
}

export interface PreviewPortDeps {
  readonly messaging: MessagingRegistry;
  /** The signed-in preview account. */
  readonly pubkey: () => string;
  readonly notify: KernlHost['notify'];
  /** Names the people in conversations, as the live shell's profiles do. */
  readonly profiles: Pick<Profiles, 'settled'>;
  /** The shell's colours, so the applet matches the page it sits in. */
  readonly theme?: Parameters<typeof createThemeService>[0];
  /** Hears every envelope on a port, both ways, as the live shell reports its traffic. */
  readonly report?: (windowId: string, direction: AppletMessageDirection, message: unknown) => void;
}

export interface PortBinding {
  readonly windowId: string;
  readonly port: PortLike;
  /** The domains this applet was granted; a request for any other is answered with an error. */
  readonly domains: readonly string[];
  /** The guard's say on each envelope; false stops it reaching a service. */
  readonly admit: (envelope: Envelope) => boolean;
}

export interface PreviewPorts {
  /** Serve one applet over its port until the returned function is called. */
  bind(binding: PortBinding): () => void;
  /**
   * Tell every bound applet that was given the theme the colours changed, and answer `theme.get`
   * with them from now on. The live shell's theme service broadcasts through kehto's runtime; the
   * preview has none, so the same service hands the envelope here to carry to each applet (D-064).
   */
  publishTheme(theme: ShellTheme): void;
  close(): void;
}

const isEnvelope = (data: unknown): data is Envelope => typeof data === 'object' && data !== null && typeof (data as Envelope).type === 'string';

/**
 * The preview's side of a real applet's port: kehto's own services for messages, the account,
 * the theme and notifications, over the preview's in-memory state. The live shell hands the port
 * to kehto's runtime; the preview has no runtime, so it routes each envelope to the service that
 * owns its domain and lets the same guard look at it first (D-011).
 */
export function createPreviewPorts(deps: PreviewPortDeps): PreviewPorts {
  /** Every applet this preview has bound, so a theme change can reach the ones still open. */
  const bound = new Map<string, PortBinding>();
  const deliver = (windowId: string, port: PortLike, envelope: unknown): void => {
    deps.report?.(windowId, 'to-applet', envelope);
    port.postMessage(envelope);
  };
  // The same naming the live shell's dm service does, from the preview's people.
  const dm = createDmService({ adapter: labelConversations(locateRecipients(deps.messaging.composite(), createPreviewPeople()), deps.profiles) });
  const theme = createThemeService({
    ...deps.theme,
    onBroadcast: (envelope) => {
      for (const applet of bound.values()) if (applet.domains.includes('theme')) deliver(applet.windowId, applet.port, envelope);
    },
  });
  const services: Readonly<Record<string, Handler>> = {
    dm,
    identity: createIdentityService({ getSigner: () => ({ getPublicKey: () => deps.pubkey() }) }),
    theme: theme.handler,
    notify: createNotifyService({
      present: ({ windowId, message }) => deps.notify({ title: message.title, windowId, tone: 'info', ...(message.body ? { body: message.body } : {}) }),
    }),
  };

  return {
    bind(binding) {
      const { windowId, port, domains, admit } = binding;
      const send = (reply: unknown): void => deliver(windowId, port, reply);
      port.onmessage = (event) => {
        const envelope = event.data;
        deps.report?.(windowId, 'from-applet', envelope);
        if (!isEnvelope(envelope) || !admit(envelope)) return;
        const domain = envelope.type.split('.')[0] as string;
        const service = domains.includes(domain) ? services[domain] : undefined;
        if (service) service.handleMessage(windowId, envelope as never, send);
        else send({ type: `${envelope.type}.result`, id: envelope.id, error: 'unavailable' });
      };
      port.start();
      bound.set(windowId, binding);
      return () => {
        bound.delete(windowId);
        port.onmessage = null;
        port.close();
        for (const service of Object.values(services)) service.onWindowDestroyed?.(windowId);
      };
    },
    publishTheme: (next) => void theme.publishTheme(next),
    close: () => dm.dispose(),
  };
}
