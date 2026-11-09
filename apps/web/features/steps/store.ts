import { expect } from 'vitest';
import { Then } from 'quickpickle';
import { explainLaunchError } from '../../src/shell/launch-errors.ts';
import { acceptsWords, looksLikeAddress, missingDomains, rememberWords, requestWords, roleWords, toggleTopic, topicBubbles } from '../../src/shell/store.ts';

const list = (text: string): string[] => (text === '' ? [] : text.split(',').map((part) => part.trim()));

Then('{string} is an applet address', (_world: unknown, text: string) => {
  expect(looksLikeAddress(text)).toBe(true);
});

Then('{string} is not an applet address', (_world: unknown, text: string) => {
  expect(looksLikeAddress(text)).toBe(false);
});

Then('the topic bubbles for popular {string} with {string} selected are {string}', (_world: unknown, popular: string, selected: string, expected: string) => {
  const counts = list(popular).map((entry) => {
    const [topic = '', count = '0'] = entry.split(':');
    return { topic, count: Number(count) };
  });
  const bubbles = topicBubbles(counts, list(selected)).map(({ topic, count, on }) => `${topic}:${count}:${on ? 'on' : 'off'}`);
  expect(bubbles).toEqual(list(expected));
});

Then('toggling {string} into {string} selects {string}', (_world: unknown, topic: string, selected: string, expected: string) => {
  expect(toggleTopic(list(selected), topic)).toEqual(list(expected));
});

Then('toggling {string} out of {string} selects {string}', (_world: unknown, topic: string, selected: string, expected: string) => {
  expect(toggleTopic(list(selected), topic)).toEqual(list(expected));
});

Then('an applet requiring {string} on a shell offering {string} needs {string}', (_world: unknown, requires: string, offered: string, expected: string) => {
  expect(missingDomains({ requires: list(requires) }, list(offered))).toEqual(list(expected));
});

interface Request {
  source: string;
  action: string;
  archetype: string;
}

const lastRequest: { value?: Request } = {};

Then('the request from {string} to {string} a {string} reads {string}', (_world: unknown, source: string, action: string, archetype: string, words: string) => {
  lastRequest.value = { source, action, archetype };
  expect(requestWords(lastRequest.value)).toBe(words);
});

Then('remembering it reads {string}', (_world: unknown, words: string) => {
  expect(rememberWords(lastRequest.value as Request)).toBe(words);
});

Then('the role {string} reads {string}', (_world: unknown, archetype: string, words: string) => {
  expect(roleWords(archetype)).toBe(words);
});

Then('accepting {string} reads {string}', (_world: unknown, conventions: string, words: string) => {
  expect(acceptsWords(list(conventions))).toBe(words);
});

Then('the launch error for {string} reads {string}', (_world: unknown, reason: string, words: string) => {
  expect(explainLaunchError(reason)).toBe(words);
});

Then('the launch error for a thrown {string} reads {string}', (_world: unknown, reason: string, words: string) => {
  expect(explainLaunchError(new Error(reason))).toBe(words);
});
