import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { HostMediaBridge, MediaAction, MediaPlayback, MediaPlaybackBackend, MediaPlaybackState } from '@kehto/services';
import { createKernlMedia, MEDIA_SETTINGS_KEY, type KernlMedia, type MediaSessionView, type MediaSettings } from '@kernlize/core';
import { settle } from './kernl.js';
import { MemoryStorage, scratch, type CoreWorld } from './world.js';

type Message = Record<string, unknown>;

interface MediaScratch {
  storage: MemoryStorage;
  media: KernlMedia;
  sessions: readonly MediaSessionView[];
  /** What each window was sent, by window id. */
  readonly received: Map<string, Message[]>;
  /** Napplet-owned sessions and what each can do, so the stand-in applet obeys the shell. */
  readonly own: Map<string, readonly MediaAction[]>;
}

const ALL: readonly MediaAction[] = ['play', 'pause', 'stop', 'seek', 'volume'];

const SILENT_BRIDGE: HostMediaBridge = { setMetadata() {}, setPlaybackState() {}, onAction: () => () => {} };

/** Plays nothing, but behaves as kehto's browser playback does: autoplay starts it, a command changes it and reports the reason. */
function fakePlayback(): MediaPlaybackBackend {
  return {
    open(_windowId, request, _signal, changed) {
      const url = request.source?.url ?? '';
      if (url.includes('broken')) return Promise.reject(new Error('unavailable'));
      let state: MediaPlaybackState = { status: request.autoplay ? 'playing' : 'paused' };
      const tagName = request.metadata?.mediaType === 'video' ? 'VIDEO' : 'AUDIO';
      const playback: MediaPlayback = {
        ...(url.includes('bare') ? {} : { element: { tagName } as HTMLMediaElement }),
        get state() {
          return state;
        },
        actions: ALL,
        command({ action, reason }) {
          const status = action === 'play' ? 'playing' : action === 'pause' ? 'paused' : action === 'stop' ? 'stopped' : state.status;
          state = reason === undefined ? { status } : { status, reason };
          changed(state, ALL);
        },
        destroy() {},
      };
      return Promise.resolve(playback);
    },
  };
}

function media(world: CoreWorld): MediaScratch {
  const value = scratch(world).media as MediaScratch | undefined;
  if (!value) throw new Error('create a media player first');
  return value;
}

function start(world: CoreWorld, storage: MemoryStorage, playback = true): void {
  const created = createKernlMedia({ storage, hostBridge: SILENT_BRIDGE, ...(playback ? { playback: fakePlayback() } : {}) });
  const value: MediaScratch = { storage, media: created, sessions: [], received: new Map(), own: new Map() };
  created.sessions$.subscribe((sessions) => {
    value.sessions = sessions;
  });
  scratch(world).media = value;
}

/** What `windowId` hears; an applet playing its own media does what the shell asks and says why. */
function sendTo(state: MediaScratch, windowId: string): (message: unknown) => void {
  return (message) => {
    const msg = message as Message;
    const list = state.received.get(windowId) ?? [];
    list.push(msg);
    state.received.set(windowId, list);
    const { type, sessionId, action, reason } = msg;
    if (type !== 'media.command' || !state.own.get(sessionId as string)?.includes(action as MediaAction)) return;
    const status = action === 'play' ? 'playing' : 'paused';
    deliver(state, windowId, { type: 'media.state', sessionId, status, reason });
  };
}

function deliver(state: MediaScratch, windowId: string, message: Message): void {
  state.media.handler.handleMessage(windowId, message as never, sendTo(state, windowId));
}

function session(world: CoreWorld, id: string): MediaSessionView {
  const found = media(world).sessions.find((item) => item.sessionId === id);
  if (!found) throw new Error(`no session ${id}`);
  return found;
}

async function play(world: CoreWorld, windowId: string, name: string, video = false): Promise<void> {
  const metadata = video ? { title: name, mediaType: 'video' } : { title: name };
  deliver(media(world), windowId, { type: 'media.session.create', id: `create-${name}`, owner: 'shell', sessionId: name, source: { url: `https://media.test/${name}` }, metadata, autoplay: true });
  await settle();
}

Given('a media player over empty storage', (world: CoreWorld) => start(world, new MemoryStorage()));

Given('a media player over storage holding media settings {string}', (world: CoreWorld, stored: string) => {
  const storage = new MemoryStorage();
  storage.setItem(MEDIA_SETTINGS_KEY, stored);
  start(world, storage);
});

Given('a media player with nothing to play with', (world: CoreWorld) => start(world, new MemoryStorage(), false));

When('the person sets media {string} to {string}', (world: CoreWorld, key: string, value: string) => {
  media(world).media.configure({ [key]: value } as Partial<MediaSettings>);
});

const settingsOf = (settings: MediaSettings): string => [settings.concurrency, settings.takeover, settings.video, settings.hidden, settings.autoplay].join(',');

Then('the media settings are {string}, {string}, {string}, {string} and {string}', (world: CoreWorld, a: string, b: string, c: string, d: string, e: string) => {
  expect(settingsOf(media(world).media.settings())).toBe([a, b, c, d, e].join(','));
});

Then('a media player over the same storage has settings {string}, {string}, {string}, {string} and {string}', (world: CoreWorld, a: string, b: string, c: string, d: string, e: string) => {
  const again = createKernlMedia({ storage: media(world).storage, hostBridge: SILENT_BRIDGE });
  expect(settingsOf(again.settings())).toBe([a, b, c, d, e].join(','));
  again.destroy();
});

When('window {string} plays {string}', (world: CoreWorld, windowId: string, name: string) => play(world, windowId, name));

When('window {string} plays {string} as video', (world: CoreWorld, windowId: string, name: string) => play(world, windowId, name, true));

When('window {string} asks to play {string}', (world: CoreWorld, windowId: string, name: string) => play(world, windowId, name));

When('window {string} plays its own {string} that can {string}', async (world: CoreWorld, windowId: string, name: string, actions: string) => {
  const state = media(world);
  const can = actions.split(',') as MediaAction[];
  state.own.set(name, can);
  deliver(state, windowId, { type: 'media.session.create', id: `create-${name}`, owner: 'napplet', sessionId: name, metadata: { title: name }, capabilities: can });
  await settle();
  deliver(state, windowId, { type: 'media.state', sessionId: name, status: 'playing' });
  await settle();
});

When('window {string} starts its own {string} without saying how it plays', async (world: CoreWorld, windowId: string, name: string) => {
  deliver(media(world), windowId, { type: 'media.session.create', id: `create-${name}`, owner: 'napplet', sessionId: name, metadata: { title: name } });
  await settle();
});

When('the person presses {string} on {string}', async (world: CoreWorld, action: string, name: string) => {
  media(world).media.command(name, { action: action as MediaAction });
  await settle();
});

When('the person ends {string}', async (world: CoreWorld, name: string) => {
  media(world).media.end(name);
  await settle();
});

When('window {string} is hidden', async (world: CoreWorld, windowId: string) => {
  media(world).media.setWindowVisible(windowId, false);
  await settle();
});

When('window {string} is shown', async (world: CoreWorld, windowId: string) => {
  media(world).media.setWindowVisible(windowId, true);
  await settle();
});

When('the applet in window {string} is closed', async (world: CoreWorld, windowId: string) => {
  media(world).media.handler.onWindowDestroyed?.(windowId);
  await settle();
});

When('the media player is shut down', (world: CoreWorld) => media(world).media.destroy());

Then('session {string} is {string}', (world: CoreWorld, name: string, status: string) => {
  expect(session(world, name).state?.status).toBe(status);
});

Then('session {string} is {string} because {string}', (world: CoreWorld, name: string, status: string, reason: string) => {
  expect(session(world, name).state).toMatchObject({ status, reason });
});

Then('the current session is {string}', (world: CoreWorld, name: string) => {
  expect(media(world).sessions.filter((item) => item.current).map((item) => item.sessionId)).toEqual([name]);
});

Then('the media sessions are {string}', (world: CoreWorld, names: string) => {
  expect(media(world).sessions.map((item) => item.sessionId).join(',')).toBe(names);
});

Then('window {string} was told session {string} ended because {string}', (world: CoreWorld, windowId: string, name: string, reason: string) => {
  expect(media(world).received.get(windowId)).toContainEqual({ type: 'media.session.ended', sessionId: name, reason });
});

Then('window {string} was asked to {string} session {string} because {string}', (world: CoreWorld, windowId: string, action: string, name: string, reason: string) => {
  expect(media(world).received.get(windowId)).toContainEqual({ type: 'media.command', sessionId: name, action, reason });
});

Then('window {string} was refused with {string}', (world: CoreWorld, windowId: string, error: string) => {
  expect(media(world).received.get(windowId)?.find((message) => message.type === 'media.session.create.result')).toMatchObject({ error });
});

Then('session {string} is a video', (world: CoreWorld, name: string) => {
  expect(session(world, name).video).toBe(true);
});

Then('session {string} has an element to show', (world: CoreWorld, name: string) => {
  expect(media(world).media.element(name)).toBeDefined();
});

Then('session {string} is listed from window {string} with title {string}', (world: CoreWorld, name: string, windowId: string, title: string) => {
  expect(session(world, name)).toMatchObject({ windowId, metadata: { title } });
});

Then('the media sessions stop being reported', (world: CoreWorld) => {
  let done = false;
  media(world).media.sessions$.subscribe({ complete: () => (done = true) });
  expect(done).toBe(true);
});

Then('session {string} is not a video', (world: CoreWorld, name: string) => {
  expect(session(world, name).video).toBe(false);
});

Then('window {string} was not asked to {string} session {string}', (world: CoreWorld, windowId: string, action: string, name: string) => {
  expect(media(world).received.get(windowId)).not.toContainEqual(expect.objectContaining({ type: 'media.command', sessionId: name, action }));
});
