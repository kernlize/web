import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './load-source.mjs';

const { decodeBech32, isHexAccountId, parseAccountId, parseOpenRequest, shortAccountId } =
  loadSource('account-id.ts');

// The pair published in NIP-19 as its worked example.
const HEX = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';
const BECH32 = 'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6';

test('accepts the canonical hex form and normalises case and whitespace', () => {
  assert.equal(parseAccountId(HEX), HEX);
  assert.equal(parseAccountId(`  ${HEX.toUpperCase()}\n`), HEX);
  assert.equal(isHexAccountId(HEX), true);
  assert.equal(isHexAccountId(HEX.toUpperCase()), false);
});

test('decodes the bech32 form to the same hex id', () => {
  assert.equal(parseAccountId(BECH32), HEX);
  assert.equal(parseAccountId(BECH32.toUpperCase()), HEX);
  assert.equal(parseAccountId(`nostr:${BECH32}`), HEX);
  const decoded = decodeBech32(BECH32);
  assert.equal(decoded.prefix, 'npub');
  assert.equal(decoded.bytes.length, 32);
});

test('refuses anything that is not an account id', () => {
  const flipped = `${BECH32.slice(0, -1)}7`;
  const mixedCase = `${BECH32.slice(0, 20).toUpperCase()}${BECH32.slice(20)}`;
  const secretPrefix = 'nsec180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6';
  for (const input of ['', 'alice', HEX.slice(1), `${HEX}0`, HEX.replace('3', 'g'), flipped, mixedCase, secretPrefix, 'npub1']) {
    assert.equal(parseAccountId(input), null, input);
  }
});

test('shortens an id to its head and tail', () => {
  assert.equal(shortAccountId(HEX), '3bf0c63f…459d');
  assert.equal(shortAccountId('abc'), 'abc');
});

test('validates an open request from another applet as untrusted input', () => {
  assert.equal(parseOpenRequest({ pubkey: HEX }), HEX);
  assert.equal(parseOpenRequest({ pubkey: HEX.toUpperCase() }), HEX);
  for (const payload of [null, undefined, HEX, 7, [], {}, { pubkey: 7 }, { pubkey: HEX.slice(2) }, { pubkey: 'alice' }]) {
    assert.equal(parseOpenRequest(payload), null);
  }
});

// The same key with one server, and with none, in the form that carries servers.
const WITH_SERVER = 'nprofile1qyxhwumn8ghj7u3w0qhxxmmdqqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8ge3tmru';
const NO_SERVER = 'nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8g2lcy6q';
const { parseRecipient } = loadSource('account-id.ts');

test('reads the form that carries servers, and keeps it for the shell to look there', () => {
  assert.deepEqual(parseRecipient(WITH_SERVER), { pubkey: HEX, address: WITH_SERVER });
  assert.deepEqual(parseRecipient(`nostr:${WITH_SERVER.toUpperCase()}`), { pubkey: HEX, address: WITH_SERVER });
  assert.equal(parseAccountId(WITH_SERVER), HEX);
  assert.deepEqual(parseRecipient(NO_SERVER), { pubkey: HEX });
  assert.deepEqual(parseRecipient(BECH32), { pubkey: HEX });
  assert.equal(parseRecipient(`${NO_SERVER.slice(0, -1)}7`), null);
  assert.deepEqual(parseOpenRequest({ pubkey: BECH32 }), HEX);
  assert.deepEqual(parseOpenRequest({ pubkey: WITH_SERVER }), HEX);
});
