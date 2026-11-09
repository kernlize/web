import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './load-source.mjs';

const { wasDropped, withRetry } = loadSource('retry.ts');

const POLICY = { timeoutMs: 4000, retries: 2, backoffMs: 500 };
const settle = () => new Promise((resolve) => setImmediate(resolve));

function fakeTimers() {
  let now = 0;
  let pending = [];
  return {
    set(run, delayMs) {
      const timer = { at: now + delayMs, run };
      pending.push(timer);
      return timer;
    },
    clear(handle) {
      pending = pending.filter((timer) => timer !== handle);
    },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        pending.sort((a, b) => a.at - b.at);
        if (!pending[0] || pending[0].at > end) break;
        const timer = pending.shift();
        now = timer.at;
        timer.run();
        await settle();
      }
      now = end;
      await settle();
    },
    waiting: () => pending.length,
  };
}

/** A read whose every attempt the test answers by hand. */
function controlled(options = {}) {
  const timers = fakeTimers();
  const attempts = [];
  const discarded = [];
  const drops = { count: 0 };
  const attempt = (started) =>
    new Promise((resolve, reject) => {
      attempts.push({ resolve, reject });
      if (options.queued !== true) started();
      else attempts.at(-1).start = started;
    });
  const outcome = { state: 'pending' };
  withRetry(attempt, { policy: POLICY, timers, discard: (value) => discarded.push(value), dropped: () => (drops.count += 1) }).then(
    (value) => Object.assign(outcome, { state: 'resolved', value }),
    (error) => Object.assign(outcome, { state: 'rejected', error }),
  );
  return { timers, attempts, discarded, drops, outcome };
}

test('recognises a refused or dropped request, and nothing else', () => {
  assert.equal(wasDropped(new Error('firewall:rate-limited')), true);
  assert.equal(wasDropped(new Error('dm.status timed out')), true);
  assert.equal(wasDropped('firewall:burst'), true);
  assert.equal(wasDropped(new Error('not signed in')), false);
  assert.equal(wasDropped(new Error('denied:firewall:x')), false);
  assert.equal(wasDropped(undefined), false);
});

test('answers from the first attempt and leaves no timer behind', async () => {
  const { timers, attempts, drops, outcome } = controlled();
  attempts[0].resolve('ok');
  await settle();
  assert.deepEqual(outcome, { state: 'resolved', value: 'ok' });
  assert.equal(drops.count, 0);
  assert.equal(attempts.length, 1);
  assert.equal(timers.waiting(), 0);
});

test('asks again after four quiet seconds, twice, then gives up', async () => {
  const { timers, attempts, drops, outcome } = controlled();
  await timers.advance(3999);
  assert.equal(attempts.length, 1);
  await timers.advance(1 + 499);
  assert.equal(attempts.length, 1, 'the backoff comes first');
  await timers.advance(1);
  assert.equal(attempts.length, 2);
  await timers.advance(4000 + 999);
  assert.equal(attempts.length, 2, 'the second backoff is twice as long');
  await timers.advance(1);
  assert.equal(attempts.length, 3);
  await timers.advance(3999);
  assert.equal(outcome.state, 'pending');
  await timers.advance(1);
  assert.equal(outcome.state, 'rejected');
  assert.match(outcome.error.message, /timed out/);
  assert.equal(attempts.length, 3, 'never a fourth attempt');
  assert.equal(timers.waiting(), 0);
  assert.equal(drops.count, 3, 'every unanswered attempt is reported');
});

test('treats a guard refusal like a drop, without waiting out the timeout', async () => {
  const { timers, attempts, drops, outcome } = controlled();
  attempts[0].reject(new Error('firewall:rate-limited'));
  await settle();
  await timers.advance(499);
  assert.equal(attempts.length, 1);
  await timers.advance(1);
  assert.equal(attempts.length, 2);
  attempts[1].resolve('second time');
  await settle();
  assert.deepEqual(outcome, { state: 'resolved', value: 'second time' });
  assert.equal(drops.count, 1);
});

test('gives up after the last attempt is refused', async () => {
  const { timers, attempts, outcome } = controlled();
  attempts[0].reject(new Error('firewall:a'));
  await settle();
  await timers.advance(500);
  attempts[1].reject(new Error('firewall:b'));
  await settle();
  await timers.advance(1000);
  attempts[2].reject(new Error('firewall:c'));
  await settle();
  assert.equal(outcome.state, 'rejected');
  assert.equal(outcome.error.message, 'firewall:c');
});

test('does not repeat a read the shell really answered with an error', async () => {
  const { timers, attempts, drops, outcome } = controlled();
  attempts[0].reject(new Error('not signed in'));
  await settle();
  await timers.advance(60_000);
  assert.equal(attempts.length, 1);
  assert.equal(outcome.error.message, 'not signed in');
  assert.equal(drops.count, 0, 'a real answer is not a sign of a tight budget');
});

test('takes a slow answer from an earlier attempt and discards the loser', async () => {
  const { timers, attempts, discarded, outcome } = controlled();
  await timers.advance(4500);
  assert.equal(attempts.length, 2);
  attempts[0].resolve('slow but real');
  await settle();
  assert.deepEqual(outcome, { state: 'resolved', value: 'slow but real' });
  attempts[1].resolve('duplicate');
  await settle();
  assert.deepEqual(discarded, ['duplicate']);
  await timers.advance(60_000);
  assert.equal(attempts.length, 2, 'nothing more is asked once answered');
});

test('ignores the late failure of an attempt it already moved past', async () => {
  const { timers, attempts, outcome } = controlled();
  await timers.advance(4500);
  attempts[0].reject(new Error('dm.status timed out'));
  await settle();
  assert.equal(outcome.state, 'pending');
  assert.equal(attempts.length, 2);
  attempts[1].resolve('ok');
  await settle();
  assert.equal(outcome.value, 'ok');
});

test('counts the timeout from when the request leaves, not while it is queued', async () => {
  const { timers, attempts, outcome } = controlled({ queued: true });
  await timers.advance(30_000);
  assert.equal(attempts.length, 1, 'still waiting for its turn');
  attempts[0].start();
  await timers.advance(3999);
  assert.equal(attempts.length, 1);
  await timers.advance(501);
  assert.equal(attempts.length, 2);
  assert.equal(outcome.state, 'pending');
});
