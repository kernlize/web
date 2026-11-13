import { createConfigService } from '@kehto/services';
import { createAppletConfig } from '@kernlize/core';
import type { KernlHost } from './contract';

/** The settings the Notes sample registers: one of each kind the shell's form draws. */
export const PREVIEW_SETTINGS_SCHEMA = {
  type: 'object',
  properties: {
    signature: { type: 'string', title: 'Signature', description: 'Added under every note.', default: '' },
    size: { type: 'integer', title: 'Text size', minimum: 12, maximum: 24, default: 15, 'x-napplet-section': 'look', 'x-napplet-order': 1 },
    tone: { type: 'string', title: 'Colour tone', enum: ['calm', 'bright'], default: 'calm', 'x-napplet-section': 'look', 'x-napplet-order': 2 },
    compact: { type: 'boolean', title: 'Compact list', default: false, 'x-napplet-section': 'look' },
    token: { type: 'string', title: 'Sync token', description: 'Kept by the shell; never shown again.', 'x-napplet-secret': true, 'x-napplet-section': 'sync' },
  },
} as const;

const SECRETS = new Set(['token']);

/** What the applet now holds, in words; a secret is only said to be set. */
function describeValues(values: Readonly<Record<string, unknown>>): string {
  const parts = Object.entries(values).map(([key, value]) => (SECRETS.has(key) ? `${key} set` : `${key} ${JSON.stringify(value)}`));
  return `Its settings: ${parts.join(', ')}.`;
}

export interface PreviewConfig {
  /** Register the sample's schema the first time, so its values are heard, then ask the shell to show the form. */
  open(windowId: string, onValues: (text: string) => void): void;
  /** The window closed: kehto forgets its schema and its listener. */
  forget(windowId: string): void;
}

/**
 * The preview's settings: kehto's own config service and the core's per-applet store, with the
 * sample applet's requests posted in as the envelopes a real applet would send over its port.
 * Like the live shell, there are none when the host cannot show the form (D-036).
 */
export function createPreviewConfig(host: KernlHost, appletOf: (windowId: string) => { readonly key: string; readonly title: string } | undefined): PreviewConfig | undefined {
  const present = host.presentSettings?.bind(host);
  if (!present) return undefined;
  const service = createConfigService(createAppletConfig({ storage: host.storage, appletOf, present }));
  const registered = new Set<string>();
  const ignore = (): void => undefined;
  return {
    open(windowId, onValues) {
      if (!registered.has(windowId)) {
        registered.add(windowId);
        service.handler.handleMessage(windowId, { type: 'config.registerSchema', id: `${windowId}-schema`, schema: PREVIEW_SETTINGS_SCHEMA } as never, ignore);
        service.handler.handleMessage(windowId, { type: 'config.subscribe' } as never, (message) => onValues(describeValues((message as typeof message & { values: Record<string, unknown> }).values)));
      }
      service.handler.handleMessage(windowId, { type: 'config.openSettings' } as never, ignore);
    },
    forget(windowId) {
      registered.delete(windowId);
      service.handler.onWindowDestroyed?.(windowId);
    },
  };
}
