import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './load-source.mjs';

const { unwrapDmResult } = loadSource('dm-result.ts');
const { wasDropped } = loadSource('retry.ts');
const { failedSendNote, failureReason, sendFailureText } = loadSource('send-errors.ts');

const thrownBy = (result) => {
  try {
    unwrapDmResult(result);
  } catch (error) {
    return error;
  }
  return null;
};

test('passes a real answer through untouched', () => {
  const status = { available: true, ownerPubkey: 'a'.repeat(64), implementations: [], capabilities: [] };
  assert.equal(unwrapDmResult(status), status);
  const sent = { ok: true, message: { id: 'm', content: 'the word error in a message is not an error' } };
  assert.equal(unwrapDmResult(sent), sent);
  assert.deepEqual(unwrapDmResult({ conversations: [] }), { conversations: [] });
  assert.deepEqual(unwrapDmResult({ ok: false }), { ok: false });
});

test('turns an error record into a rejection carrying the exact reason', () => {
  for (const reason of [
    'denied:cancelled',
    'invalid:recipient',
    'unavailable:no-default-provider',
    'unavailable:recipient-not-ready',
    'firewall:rate-limited',
    'not signed in',
  ]) {
    const error = thrownBy({ error: reason });
    assert.ok(error instanceof Error, reason);
    assert.equal(error.message, reason);
  }
  assert.equal(thrownBy({ error: 'denied:cancelled', ok: undefined, message: undefined }).message, 'denied:cancelled');
});

test('does not mistake other shapes for an error record', () => {
  for (const result of [undefined, null, 'firewall:x', 7, [], { error: undefined }, { error: '' }, { error: 7 }, { error: { code: 1 } }]) {
    assert.equal(thrownBy(result), null);
  }
});

test('gives a send the person declined in the shell exactly "Not sent."', () => {
  const reason = failureReason(thrownBy({ error: 'denied:cancelled' }));
  assert.equal(failedSendNote(sendFailureText(reason)), 'Not sent.');
  const provider = failureReason(thrownBy({ error: 'unavailable:no-default-provider' }));
  assert.equal(failedSendNote(sendFailureText(provider)), "Not sent. Turn on a provider in the shell's settings first.");
});

test('marks a guard refusal that arrived as a record for retrying, and nothing else', () => {
  assert.equal(wasDropped(thrownBy({ error: 'firewall:rate-limited' })), true);
  assert.equal(wasDropped(thrownBy({ error: 'denied:cancelled' })), false);
  assert.equal(wasDropped(thrownBy({ error: 'not signed in' })), false);
});
