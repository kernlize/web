import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './load-source.mjs';

const { failedSendNote, failureReason, isUnansweredSend, sendFailureText } = loadSource('send-errors.ts');

const FORBIDDEN = /invalid:|unavailable:|denied:|firewall|nostr|nip-?\d|napplet|relay|pubkey|npub|nsec|marmot|\bmls\b/i;

test('maps each known reason to plain words', () => {
  assert.equal(sendFailureText('invalid:recipient'), 'That does not look like an account id.');
  assert.equal(
    sendFailureText('unavailable:no-default-provider'),
    "Turn on a provider in the shell's settings first.",
  );
  assert.equal(
    sendFailureText('unavailable:recipient-not-ready'),
    'This person cannot be reached that way yet.',
  );
  assert.equal(sendFailureText('denied:user'), 'Not sent.');
  assert.equal(sendFailureText('denied:policy:rate-limit'), 'Not sent.');
});

test('falls back to one sentence for everything else', () => {
  for (const reason of ['', 'send failed', 'unavailable', 'unavailable:something-new', 'undenied:x', 'boom', 'firewall:rate-limited']) {
    assert.equal(sendFailureText(reason), 'That did not work. Try again.', reason);
  }
});

test('never lets a raw reason or protocol word through', () => {
  const reasons = [
    'invalid:recipient',
    'unavailable:no-default-provider',
    'unavailable:recipient-not-ready',
    'denied:user',
    'relay wss://example closed: nip17 pubkey rejected',
    'firewall:rate-limited',
  ];
  for (const reason of reasons) {
    assert.doesNotMatch(failedSendNote(sendFailureText(reason)), FORBIDDEN, reason);
  }
});

test('reads the reason out of whatever was thrown', () => {
  assert.equal(failureReason(new Error('denied:user')), 'denied:user');
  assert.equal(failureReason('invalid:recipient'), 'invalid:recipient');
  assert.equal(failureReason({ code: 1 }), '');
  assert.equal(failureReason(undefined), '');
});

test('treats an unanswered request as still pending, not refused', () => {
  assert.equal(isUnansweredSend('dm.send timed out'), true);
  assert.equal(isUnansweredSend('denied:user'), false);
  assert.equal(isUnansweredSend('timed out waiting, then denied:user'), false);
});

test('labels a refused bubble once', () => {
  assert.equal(failedSendNote('Not sent.'), 'Not sent.');
  assert.equal(failedSendNote('That did not work. Try again.'), 'Not sent. That did not work. Try again.');
});
