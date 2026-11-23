import { expect } from 'vitest';
import { Then } from 'quickpickle';
import { DEFAULT_MEDIA_SETTINGS, type MediaConcurrency, type MediaSessionView } from '@kernlize/core';
import { isPlaying, mediaLine, mediaSettingGroups, mediaTime, mediaTitle, sessionOfPanel, videoPanel } from '../../src/shell/media-words';

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
