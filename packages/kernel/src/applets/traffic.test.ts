import { describe, expect, it } from 'vitest';
import { appletMessageFailure, describeAppletMessage } from './traffic.js';

describe('describeAppletMessage', () => {
  it('reports a message that is not an envelope as type "unknown" with no error', () => {
    const report = describeAppletMessage('applet-1', 'from-applet', 'port', 'hello');
    expect(report.type).toBe('unknown');
    expect(report).not.toHaveProperty('error');
  });

  it('reports an envelope with no type as "unknown"', () => {
    expect(describeAppletMessage('applet-1', 'from-applet', 'port', { id: '1' }).type).toBe('unknown');
  });

  it('clips an applet-chosen error to its limit', () => {
    const report = describeAppletMessage('applet-1', 'from-applet', 'port', { type: 'x.error', error: 'e'.repeat(2000) });
    expect(report.error).toBe(`${'e'.repeat(512)}…`);
    expect(appletMessageFailure({ type: 'x.error', error: 'boom' })).toBe('boom');
  });
});
