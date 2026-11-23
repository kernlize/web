import { describe, expect, it } from 'vitest';
import { createMessagingRegistry } from '@kernlize/messaging';
import { createPreviewPorts, type PortLike, type PreviewPortDeps } from './preview-port';

interface FakePort extends PortLike {
  readonly posted: unknown[];
}

function fakePort(): FakePort {
  const port: FakePort = {
    onmessage: null,
    posted: [],
    postMessage: (message) => void port.posted.push(message),
    start: () => undefined,
    close: () => undefined,
  };
  return port;
}

const deps = (report?: PreviewPortDeps['report']): PreviewPortDeps => ({
  messaging: createMessagingRegistry(),
  profiles: { settled: () => ({ found: false }) } as unknown as PreviewPortDeps['profiles'],
  pubkey: () => '00'.repeat(32),
  notify: () => undefined,
  ...(report ? { report } : {}),
});

const kind = (message: unknown): string | undefined => (message as { type?: string }).type;

describe('the preview theme, published over its ports', () => {
  it('tells the applets that hold the theme, and no one else', () => {
    const ports = createPreviewPorts(deps());
    const told = fakePort();
    const quiet = fakePort();
    ports.bind({ windowId: 'preview-1', port: told, domains: ['theme'], admit: () => true });
    ports.bind({ windowId: 'preview-2', port: quiet, domains: ['dm'], admit: () => true });
    ports.publishTheme({ colors: { background: '#141720', text: '#ebe6da', primary: '#efb449' } });
    expect(told.posted.map(kind)).toEqual(['theme.changed']);
    expect(quiet.posted).toEqual([]);
    ports.close();
  });

  it('answers a later theme.get with the colours it published', async () => {
    const ports = createPreviewPorts(deps());
    const port = fakePort();
    ports.bind({ windowId: 'preview-1', port, domains: ['theme'], admit: () => true });
    ports.publishTheme({ colors: { background: '#141720', text: '#ebe6da', primary: '#efb449' } });
    port.onmessage?.({ data: { type: 'theme.get', id: 'one' } });
    for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(port.posted.at(-1)).toMatchObject({ type: 'theme.get.result', id: 'one', theme: { colors: { background: '#141720' } } });
    ports.close();
  });

  it('stops telling an applet the moment its port closes', () => {
    const ports = createPreviewPorts(deps());
    const port = fakePort();
    const unbind = ports.bind({ windowId: 'preview-1', port, domains: ['theme'], admit: () => true });
    unbind();
    ports.publishTheme({ colors: { background: '#141720', text: '#ebe6da', primary: '#efb449' } });
    expect(port.posted).toEqual([]);
    ports.close();
  });

  it('reports what it pushes only when a host is listening', () => {
    const seen: string[] = [];
    const reported = createPreviewPorts(deps((_windowId, direction, message) => void seen.push(`${direction}:${kind(message)}`)));
    reported.bind({ windowId: 'preview-1', port: fakePort(), domains: ['theme'], admit: () => true });
    reported.publishTheme({ colors: { background: '#141720', text: '#ebe6da', primary: '#efb449' } });
    expect(seen).toEqual(['to-applet:theme.changed']);
    reported.close();
  });
});
