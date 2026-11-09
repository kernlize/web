import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './load-source.mjs';

const {
  absorbThread,
  buildThreads,
  countUnread,
  directKey,
  isOwnMessage,
  lastSeen,
  mergeMessages,
  seenAfterArrival,
  senderName,
  threadKey,
  threadTitle,
  toChatMessage,
  toMillis,
} = loadSource('threads.ts');

const hex = (digit) => digit.repeat(64);
const ME = hex('a');
const ADA = hex('b');
const GRACE = hex('c');
const LINUS = hex('d');

const direct = (id, peer, extra = {}) => ({
  id,
  kind: 'direct',
  participants: [{ pubkey: ME }, peer],
  unread: 0,
  ...extra,
});

const message = (id, sender, at, extra = {}) => ({
  id,
  conversationId: 'c1',
  sender,
  at,
  content: id,
  status: sender === ME ? 'sent' : 'received',
  ...extra,
});

test('merges direct conversations with the same person into one thread', () => {
  const threads = buildThreads(
    [
      direct('private:1', { pubkey: ADA }, { updatedAt: 100 }),
      direct('legacy:9', { pubkey: ADA, label: 'Ada' }, { updatedAt: 300 }),
      direct('private:2', { pubkey: GRACE, label: 'Grace' }, { updatedAt: 200 }),
    ],
    ME,
  );
  assert.equal(threads.length, 2);
  const [ada, grace] = threads;
  assert.equal(ada.key, directKey([ADA]));
  assert.deepEqual(ada.conversationIds, ['private:1', 'legacy:9']);
  assert.deepEqual(ada.peers, [{ pubkey: ADA, label: 'Ada' }]);
  assert.equal(ada.updatedAt, 300_000);
  assert.equal(grace.key, directKey([GRACE]));
});

test('keeps the same thread whether or not the shell lists the owner', () => {
  const withOwner = direct('private:1', { pubkey: ADA });
  const withoutOwner = { id: 'legacy:1', kind: 'direct', participants: [{ pubkey: ADA }] };
  assert.equal(threadKey(withOwner, ME), threadKey(withoutOwner, ME));
  assert.equal(buildThreads([withOwner, withoutOwner], ME).length, 1);
});

test('never derives a thread from the conversation id of a direct conversation', () => {
  const key = threadKey(direct('private:secret-id', { pubkey: ADA }), ME);
  assert.doesNotMatch(key, /secret-id|private/);
});

test('keeps every group conversation as its own thread', () => {
  const group = (id, subject) => ({
    id,
    kind: 'group',
    participants: [{ pubkey: ME }, { pubkey: ADA }, { pubkey: GRACE }],
    subject,
  });
  const threads = buildThreads([group('g1', 'Hike'), group('g2', 'Hike'), direct('d1', { pubkey: ADA })], ME);
  assert.equal(threads.length, 3);
  assert.equal(threads.filter((thread) => thread.kind === 'group').length, 2);
  assert.deepEqual(threads.find((thread) => thread.conversationIds[0] === 'g1').peers.map((peer) => peer.pubkey), [ADA, GRACE]);
});

test('gives a note to self a thread with the owner as its only peer', () => {
  const [self] = buildThreads([{ id: 'self', kind: 'direct', participants: [{ pubkey: ME }] }], ME);
  assert.equal(self.key, directKey([ME]));
  assert.deepEqual(self.peers, [{ pubkey: ME }]);
});

test('sorts threads by most recent activity', () => {
  const threads = buildThreads(
    [
      direct('a', { pubkey: ADA }, { updatedAt: 10 }),
      direct('b', { pubkey: GRACE }, { updatedAt: 30 }),
      direct('c', { pubkey: LINUS }),
    ],
    ME,
  );
  assert.deepEqual(threads.map((thread) => thread.conversationIds[0]), ['b', 'a', 'c']);
});

test('absorbs a later conversation without duplicating ids or losing labels', () => {
  const [thread] = buildThreads([direct('a', { pubkey: ADA, label: 'Ada' }, { updatedAt: 50 })], ME);
  const [again] = buildThreads([direct('a', { pubkey: ADA }), direct('b', { pubkey: ADA }, { updatedAt: 20 })], ME);
  absorbThread(thread, again);
  assert.deepEqual(thread.conversationIds, ['a', 'b']);
  assert.equal(thread.peers[0].label, 'Ada');
  assert.equal(thread.updatedAt, 50_000);
});

test('titles a thread by label, then by shortened account id', () => {
  const [labelled] = buildThreads([direct('a', { pubkey: ADA, label: ' Ada ' })], ME);
  const [bare] = buildThreads([direct('b', { pubkey: GRACE })], ME);
  assert.equal(threadTitle(labelled), 'Ada');
  assert.equal(threadTitle(bare), 'cccccccc…cccc');
  assert.equal(senderName(labelled, ADA), 'Ada');
  assert.equal(senderName(labelled, LINUS), 'dddddddd…dddd');
});

test('titles a group by subject, else by its members', () => {
  const participants = [ME, ADA, GRACE, LINUS, hex('e')].map((pubkey) => ({ pubkey }));
  participants[1].label = 'Ada';
  const [named] = buildThreads([{ id: 'g', kind: 'group', participants, subject: 'Hike' }], ME);
  const [unnamed] = buildThreads([{ id: 'g', kind: 'group', participants }], ME);
  assert.equal(threadTitle(named), 'Hike');
  assert.equal(threadTitle(unnamed), 'Ada, cccccccc…cccc, dddddddd…dddd +1');
});

test('merges history by time and drops duplicates by id', () => {
  const first = [message('m1', ADA, 1000), message('m3', ME, 3000)];
  const second = [message('m2', ADA, 2000, { conversationId: 'c2' }), message('m3', ME, 3000), message('m0', ADA, 500)];
  const merged = mergeMessages(first, second);
  assert.deepEqual(merged.map((item) => item.id), ['m0', 'm1', 'm2', 'm3']);
  assert.deepEqual(mergeMessages(merged, merged).map((item) => item.id), ['m0', 'm1', 'm2', 'm3']);
});

test('lets a newer copy of a message replace the stored one', () => {
  const merged = mergeMessages([message('m1', ME, 1000)], [message('m1', ME, 1000, { status: 'delivered' })]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'delivered');
});

test('keeps arrival order for messages that share a timestamp', () => {
  const sent = message('zz-sent', ME, 1000);
  const reply = message('aa-reply', ADA, 1000);
  assert.deepEqual(mergeMessages([sent], [reply]).map((item) => item.id), ['zz-sent', 'aa-reply']);
  assert.deepEqual(mergeMessages(mergeMessages([sent], [reply]), [sent]).map((item) => item.id), ['zz-sent', 'aa-reply']);
  assert.deepEqual(mergeMessages([], [message('late', ADA, 2000), sent, reply]).map((item) => item.id), ['zz-sent', 'aa-reply', 'late']);
});

test('counts only messages from others that are newer than last seen', () => {
  const messages = [message('m1', ADA, 1000), message('m2', ME, 2000), message('m3', ADA, 3000), message('m4', ADA, 4000)];
  assert.equal(countUnread(messages, ME, 0), 3);
  assert.equal(countUnread(messages, ME, 1000), 2);
  assert.equal(countUnread(messages, ME, 3000), 1);
  assert.equal(countUnread(messages, ME, 4000), 0);
  assert.equal(countUnread([], ME, 0), 0);
});

test('treats a thread never opened as seen up to the first-run baseline', () => {
  const seen = { baseline: 5000, threads: { opened: 9000 } };
  assert.equal(lastSeen(seen, 'opened'), 9000);
  assert.equal(lastSeen(seen, 'never-opened'), 5000);
  const before = [message('old', ADA, 4000)];
  const after = [...before, message('new', ADA, 6000)];
  assert.equal(countUnread(before, ME, lastSeen(seen, 'never-opened')), 0);
  assert.equal(countUnread(after, ME, lastSeen(seen, 'never-opened')), 1);
});

test('counts a live arrival stamped just before the last look as new', () => {
  const seenAt = 10_900;
  assert.equal(seenAfterArrival(seenAt, 10_000), 9_999, 'same second, rounded down by the shell');
  assert.equal(seenAfterArrival(seenAt, 10_900), 10_899);
  assert.equal(seenAfterArrival(seenAt, 11_000), seenAt, 'already newer: nothing to move');
  assert.equal(seenAfterArrival(seenAt, 9_900), seenAt, 'older than the rounding: replayed history stays seen');
  const arrival = message('live', ADA, 10_000);
  assert.equal(countUnread([arrival], ME, seenAt), 0);
  assert.equal(countUnread([arrival], ME, seenAfterArrival(seenAt, arrival.at)), 1);
});

test('tells own messages by the owner, or by delivery state without one', () => {
  assert.equal(isOwnMessage(message('m', ME, 1), ME), true);
  assert.equal(isOwnMessage(message('m', ADA, 1), ME), false);
  assert.equal(isOwnMessage(message('m', ADA, 1, { status: 'sent' }), ''), true);
  assert.equal(isOwnMessage(message('m', ME, 1, { status: 'received' }), ''), false);
});

test('reads shell timestamps in seconds or milliseconds', () => {
  assert.equal(toMillis(1_790_337_600), 1_790_337_600_000);
  assert.equal(toMillis(1_790_337_600_000), 1_790_337_600_000);
  const converted = toChatMessage({
    id: 'm',
    conversationId: 'c',
    senderPubkey: ADA,
    createdAt: 1_790_337_600,
    content: 'hi',
    status: 'received',
  });
  assert.deepEqual(converted, {
    id: 'm',
    conversationId: 'c',
    sender: ADA,
    at: 1_790_337_600_000,
    content: 'hi',
    status: 'received',
  });
});
