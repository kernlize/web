import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { DEFAULT_MEDIA_SETTINGS, type MediaConcurrency, type MediaSessionView } from '@kernlize/core';
import { fullscreenLabel, isPlaying, mediaLine, mediaSettingGroups, mediaTime, mediaTitle, sessionOfPanel, toggleFullscreen, videoPanel, type FullscreenDocument } from '../../src/shell/media-words';

type State = MediaSessionView['state'];

Then('the player shows {string} seconds as {string}', (_world: unknown, seconds: string, shown: string) => {
  expect(mediaTime(Number(seconds))).toBe(shown);
});

Then('the player shows no time as {string}', (_world: unknown, shown: string) => {
  expect(mediaTime(undefined)).toBe(shown);
});

Then('a(n) {word} session titled {string} is called {string}', (_world: unknown, kind: string, title: string, called: string) => {
  const metadata = title === '' ? {} : { title };
  expect(mediaTitle({ metadata, video: kind === 'video' })).toBe(called);
});

Then('a video session titled with only spaces is called {string}', (_world: unknown, called: string) => {
  expect(mediaTitle({ metadata: { title: '   ' }, video: true })).toBe(called);
});

Then('a {string} session by {string} from {string} reads {string}', (_world: unknown, status: string, artist: string, applet: string, line: string) => {
  expect(mediaLine({ metadata: { artist }, state: { status } as State }, applet)).toBe(line);
});

Then('a session with no state from {string} reads {string}', (_world: unknown, applet: string, line: string) => {
  expect(mediaLine({}, applet)).toBe(line);
});

Then('a {string} session shows the pause button', (_world: unknown, status: string) => {
  expect(isPlaying({ state: { status } as State })).toBe(true);
});

Then('a {string} session shows the play button', (_world: unknown, status: string) => {
  expect(isPlaying({ state: { status } as State })).toBe(false);
});

Then('the video window for {string} is {string}', (_world: unknown, sessionId: string, panel: string) => {
  expect(videoPanel(sessionId)).toBe(panel);
});

Then('the window {string} shows session {string}', (_world: unknown, panel: string, sessionId: string) => {
  expect(sessionOfPanel(panel)).toBe(sessionId);
});

Then('the window {string} shows no session', (_world: unknown, panel: string) => {
  expect(sessionOfPanel(panel)).toBeUndefined();
});

Then('with {string} at once the media settings ask {string}', (_world: unknown, concurrency: string, labels: string) => {
  const groups = mediaSettingGroups({ ...DEFAULT_MEDIA_SETTINGS, concurrency: concurrency as MediaConcurrency });
  expect(groups.map((group) => group.label).join(',')).toBe(labels);
});

Then('the full-screen button reads {string} outside full screen', (_world: unknown, label: string) => {
  expect(fullscreenLabel(false)).toBe(label);
});

Then('the full-screen button reads {string} in full screen', (_world: unknown, label: string) => {
  expect(fullscreenLabel(true)).toBe(label);
});

type Box = Pick<Element, 'requestFullscreen'>;

interface FullscreenWorld {
  page?: { fullscreenElement: Box | null; exitFullscreen(): Promise<void> };
  box?: Box;
}

function fakeFullscreen(world: FullscreenWorld, allowed: boolean): void {
  const page: NonNullable<FullscreenWorld['page']> = {
    fullscreenElement: null,
    exitFullscreen: async () => {
      page.fullscreenElement = null;
    },
  };
  const box: Box = {
    requestFullscreen: async () => {
      if (!allowed) throw new TypeError('Permissions check failed');
      page.fullscreenElement = box;
    },
  };
  world.page = page;
  world.box = box;
}

Given('a video box the shell can show full screen', (world: FullscreenWorld) => fakeFullscreen(world, true));

Given('a video box the browser will not show full screen', (world: FullscreenWorld) => fakeFullscreen(world, false));

When('the person presses full screen on it', async (world: FullscreenWorld) => {
  await toggleFullscreen(world.box as Box, world.page as FullscreenDocument);
});

Then('the video box fills the screen', (world: FullscreenWorld) => {
  expect(world.page?.fullscreenElement).toBe(world.box);
});

Then('nothing fills the screen', (world: FullscreenWorld) => {
  expect(world.page?.fullscreenElement).toBeNull();
});

Then('a {string} session from {string} played on after it closed reads {string}', (_world: unknown, status: string, applet: string, line: string) => {
  expect(mediaLine({ state: { status } as State, detached: true }, applet)).toBe(line);
});
