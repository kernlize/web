import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './load-source.mjs';

const { buildListRows, buildLogRows, lastActivity } = loadSource('view-model.ts');
const { initials, snippet, tileHue, dayLabel, listTimeLabel } = loadSource('format.ts');

const hex = (digit) => digit.repeat(64);
const ME = hex('a');
const ADA = hex('b');
const GRACE = hex('c');
const NOON = new Date(2026, 5, 15, 12, 0, 0).getTime();
const HOUR = 3_600_000;

const message = (id, sender, at, content = id) => ({
  id,
  conversationId: 'c',
  sender,
  at,
  content,
  status: sender === ME ? 'sent' : 'received',
});

const entry = (key, peers, messages, extra = {}) => ({
  thread: { key, kind: 'direct', conversationIds: ['c'], peers, updatedAt: 0, ...extra.thread },
  messages,
  pending: extra.pending ?? [],
  history: 'ready',
});

const context = (extra = {}) => ({
  owner: ME,
  seen: { baseline: 0, threads: {} },
  openKey: null,
  filter: '',
  now: NOON,
  ...extra,
});

test('lists threads newest first with unread counts and a preview', () => {
  const ada = entry('direct:ada', [{ pubkey: ADA, label: 'Ada Lovelace' }], [
    message('1', ADA, NOON - 3 * HOUR, 'first'),
    message('2', ME, NOON - 2 * HOUR, 'my   reply\nhere'),
  ]);
  const grace = entry('direct:grace', [{ pubkey: GRACE }], [message('3', GRACE, NOON - HOUR, 'ping')]);
  const rows = buildListRows([ada, grace], context({ seen: { baseline: NOON - 4 * HOUR, threads: {} } }));
  assert.deepEqual(rows.map((row) => row.key), ['direct:grace', 'direct:ada']);
  assert.equal(rows[0].unread, 1);
  assert.equal(rows[0].preview, 'ping');
  assert.equal(rows[0].title, 'cccccccc…cccc');
  assert.equal(rows[1].unread, 1);
  assert.equal(rows[1].preview, 'You: my reply here');
  assert.equal(rows[1].initials, 'AL');
});

test('clears the unread count once a thread has been seen', () => {
  const ada = entry('direct:ada', [{ pubkey: ADA }], [message('1', ADA, NOON - HOUR)]);
  const seen = { baseline: 0, threads: { 'direct:ada': NOON } };
  assert.equal(buildListRows([ada], context({ seen }))[0].unread, 0);
});

test('marks the open thread and narrows by the search text', () => {
  const ada = entry('direct:ada', [{ pubkey: ADA, label: 'Ada' }], []);
  const grace = entry('direct:grace', [{ pubkey: GRACE, label: 'Grace' }], []);
  const rows = buildListRows([ada, grace], context({ openKey: 'direct:grace' }));
  assert.deepEqual(rows.map((row) => row.current), [false, true]);
  assert.deepEqual(buildListRows([ada, grace], context({ filter: ' gra ' })).map((row) => row.title), ['Grace']);
});

test('names the sender in a group preview', () => {
  const group = entry('group:g', [{ pubkey: ADA, label: 'Ada' }, { pubkey: GRACE }], [message('1', ADA, NOON, 'hello all')], {
    thread: { kind: 'group', subject: 'Hike' },
  });
  assert.equal(buildListRows([group], context())[0].preview, 'Ada: hello all');
});

test('counts a waiting send as the latest activity', () => {
  const pending = [{ clientId: 'p1', content: 'on my way', at: NOON, state: 'sending', stalled: false, problem: '' }];
  const ada = entry('direct:ada', [{ pubkey: ADA }], [message('1', ADA, NOON - HOUR)], { pending });
  assert.equal(lastActivity(ada), NOON);
  assert.equal(buildListRows([ada], context())[0].preview, 'You: on my way');
});

test('groups a thread by day and joins runs from the same person', () => {
  const yesterday = NOON - 24 * HOUR;
  const ada = entry('direct:ada', [{ pubkey: ADA, label: 'Ada' }], [
    message('1', ADA, yesterday),
    message('2', ADA, yesterday + 60_000),
    message('3', ME, NOON - HOUR),
    message('4', ADA, NOON - HOUR + 60_000),
  ]);
  const rows = buildLogRows(ada, ME, NOON);
  assert.deepEqual(rows.map((row) => row.kind), ['day', 'message', 'message', 'day', 'message', 'message']);
  assert.deepEqual([rows[0].label, rows[3].label], ['Yesterday', 'Today']);
  assert.deepEqual(rows.filter((row) => row.kind === 'message').map((row) => [row.own, row.joined]), [
    [false, false],
    [false, true],
    [true, false],
    [false, false],
  ]);
});

test('shows who wrote each run in a group, never in a direct thread', () => {
  const messages = [message('1', ADA, NOON - 3000), message('2', ADA, NOON - 2000), message('3', GRACE, NOON - 1000)];
  const peers = [{ pubkey: ADA, label: 'Ada' }, { pubkey: GRACE }];
  const group = entry('group:g', peers, messages, { thread: { kind: 'group' } });
  const names = (rows) => rows.filter((row) => row.kind === 'message').map((row) => row.sender);
  assert.deepEqual(names(buildLogRows(group, ME, NOON)), ['Ada', '', 'cccccccc…cccc']);
  assert.deepEqual(names(buildLogRows(entry('direct:ada', peers, messages), ME, NOON)), ['', '', '']);
});

test('places waiting and refused sends in the timeline with their state', () => {
  const pending = [
    { clientId: 'p1', content: 'held', at: NOON - 500, state: 'sending', stalled: false, problem: '' },
    { clientId: 'p2', content: 'refused', at: NOON - 400, state: 'failed', stalled: false, problem: 'Not sent.' },
    { clientId: 'p3', content: 'broken', at: NOON - 300, state: 'failed', stalled: false, problem: 'That did not work. Try again.' },
  ];
  const ada = entry('direct:ada', [{ pubkey: ADA }], [message('1', ADA, NOON - 1000), message('2', ADA, NOON)], { pending });
  const rows = buildLogRows(ada, ME, NOON).filter((row) => row.kind === 'message');
  assert.deepEqual(rows.map((row) => row.key), ['m:1', 'p:p1', 'p:p2', 'p:p3', 'm:2']);
  assert.deepEqual(rows.map((row) => row.state), ['sent', 'sending', 'failed', 'failed', 'sent']);
  assert.deepEqual(rows.map((row) => row.note), [
    '',
    'sending…',
    'Not sent.',
    'Not sent. That did not work. Try again.',
    '',
  ]);
  assert.equal(rows[1].own, true);
  assert.equal(rows[1].clientId, 'p1');
  assert.deepEqual(rows.map((row) => row.actionable), [false, false, true, true, false]);
});

test('lets the person act on a send the binding stopped waiting for', () => {
  const pending = [{ clientId: 'p1', content: 'slow', at: NOON, state: 'sending', stalled: true, problem: '' }];
  const [, row] = buildLogRows(entry('direct:ada', [{ pubkey: ADA }], [], { pending }), ME, NOON);
  assert.equal(row.state, 'sending');
  assert.equal(row.note, 'sending…');
  assert.equal(row.actionable, true);
});

test('derives initials, a stable hue and a one-line snippet', () => {
  assert.equal(initials('Ada Lovelace'), 'AL');
  assert.equal(initials('grace'), 'GR');
  assert.equal(initials('3bf0c63f…459d'), '34');
  assert.equal(initials(''), '?');
  assert.equal(tileHue(ADA), tileHue(ADA));
  assert.notEqual(tileHue(ADA), tileHue(GRACE));
  assert.ok(tileHue(ADA) >= 0 && tileHue(ADA) < 360);
  assert.equal(snippet('  a\n\n b  ', 80), 'a b');
  assert.equal(snippet('x'.repeat(100), 80).length, 80);
  assert.ok(snippet('x'.repeat(100), 80).endsWith('…'));
});

test('labels days relative to today', () => {
  assert.equal(dayLabel(NOON - HOUR, NOON), 'Today');
  assert.equal(dayLabel(NOON - 13 * HOUR, NOON), 'Yesterday');
  assert.notEqual(dayLabel(NOON - 72 * HOUR, NOON), 'Yesterday');
  assert.equal(listTimeLabel(0, NOON), '');
  assert.equal(listTimeLabel(NOON - 13 * HOUR, NOON), 'Yesterday');
});
