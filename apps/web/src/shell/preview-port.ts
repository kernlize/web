import { createDmService, createIdentityService, createNotifyService, createThemeService } from '@kehto/services';
import type { MessagingRegistry } from '@kernlize/messaging';
import { labelConversations, type Profiles } from '@kernlize/core';
import type { KernlHost } from './contract';

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
  // The same naming the live shell's dm service does, from the preview's people.
  const dm = createDmService({ adapter: labelConversations(deps.messaging.composite(), deps.profiles) });
  const services: Readonly<Record<string, Handler>> = {
    dm,
    identity: createIdentityService({ getSigner: () => ({ getPublicKey: () => deps.pubkey() }) }),
    theme: createThemeService(deps.theme).handler,
    notify: createNotifyService({
      present: ({ windowId, message }) => deps.notify({ title: message.title, windowId, tone: 'info', ...(message.body ? { body: message.body } : {}) }),
    }),
  };

  return {
    bind({ windowId, port, domains, admit }) {
      port.onmessage = (event) => {
        const envelope = event.data;
        if (!isEnvelope(envelope) || !admit(envelope)) return;
        const domain = envelope.type.split('.')[0] as string;
        const service = domains.includes(domain) ? services[domain] : undefined;
        if (service) service.handleMessage(windowId, envelope as never, (reply) => port.postMessage(reply));
        else port.postMessage({ type: `${envelope.type}.result`, id: envelope.id, error: 'unavailable' });
      };
      port.start();
      return () => {
        port.onmessage = null;
        port.close();
        for (const service of Object.values(services)) service.onWindowDestroyed?.(windowId);
      };
    },
    close: () => dm.dispose(),
  };
}
