import { expect } from 'vitest';
import { Then, When } from 'quickpickle';
import { preview, type PreviewWorld } from './kernl.ts';

When('the preview kernl media is set to wait for play', (world: PreviewWorld) => {
  preview(world).kernl.media.configure({ autoplay: 'block' });
});

When('an applet in the preview presses Play on {string}', (world: PreviewWorld, sessionId: string) => {
  preview(world).kernl.media.handler.handleMessage('preview-window', { type: 'media.command', sessionId, action: 'play' }, () => undefined);
});

Then('the preview kernl lists no media', (world: PreviewWorld) => {
  let count = -1;
  preview(world).kernl.media.sessions$.subscribe((sessions) => (count = sessions.length)).unsubscribe();
  expect(count).toBe(0);
});

Then('the preview kernl media waits for play', (world: PreviewWorld) => {
  expect(preview(world).kernl.media.settings().autoplay).toBe('block');
});
