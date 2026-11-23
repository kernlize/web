import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { MediaSettings } from '@kernlize/core';
import { k, settle } from './kernl.js';
import type { CoreWorld } from './world.js';

Given("the person sets the shell's media {string} to {string}", (world: CoreWorld, key: string, value: string) => {
  k(world).kernl.media.configure({ [key]: value } as Partial<MediaSettings>);
});

When('the applet starts playing its own {string} over its port', async (world: CoreWorld, name: string) => {
  const port = k(world).channel?.port1;
  port?.postMessage({ type: 'media.session.create', id: `create-${name}`, owner: 'napplet', sessionId: name, metadata: { title: name }, capabilities: ['play', 'pause'] });
  for (let i = 0; i < 10 && !k(world).received.some((entry) => entry.type === 'media.session.create.result'); i += 1) await settle();
  port?.postMessage({ type: 'media.state', sessionId: name, status: 'playing' });
  await settle();
});

When('the mounted window is hidden', async (world: CoreWorld) => {
  k(world).handle?.setVisibility({ visible: false, focused: false });
  await settle();
});

Then('the shell lists media {string}', (world: CoreWorld, names: string) => {
  let listed = '';
  k(world).kernl.media.sessions$.subscribe((sessions) => (listed = sessions.map((session) => session.sessionId).join(','))).unsubscribe();
  expect(listed).toBe(names);
});

When('the applet asks the shell to play {string} over its port', async (world: CoreWorld, url: string) => {
  k(world).channel?.port1.postMessage({ type: 'media.session.create', id: 'create-shell', owner: 'shell', source: { url }, autoplay: true });
  for (let i = 0; i < 20 && !k(world).received.some((entry) => entry.type === 'media.session.create.result'); i += 1) await settle();
});
