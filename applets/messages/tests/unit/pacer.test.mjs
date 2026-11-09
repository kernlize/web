import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './load-source.mjs';

const { createPacer } = loadSource('pacer.ts');

/** A clock the test moves by hand; wake-ups fire in order as time passes them. */
function fakeClock() {
  let now = 0;
  const timers = [];
  return {
    now: () => now,
    wake: (delayMs, run) => timers.push({ at: now + delayMs, run }),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        if (!timers[0] || timers[0].at > end) break;
        const timer = timers.shift();
        now = timer.at;
        timer.run();
      }
      now = end;
    },
  };
}

function setup(overrides = {}) {
  const clock = fakeClock();
  const pacer = createPacer({ limit: 4, windowMs: 1000, backgroundLimit: 1, slowLimit: 1, now: clock.now, wake: clock.wake, ...overrides });
  const started = [];
  const call = (name, lane = 'normal') =>
    pacer.schedule(lane, () => {
      started.push({ name, at: clock.now() });
      return name;
    });
  return { clock, pacer, started, call };
}

const names = (started) => started.map((entry) => entry.name);

function busiestWindow(started, windowMs) {
  return Math.max(0, ...started.map((entry) => started.filter((other) => other.at > entry.at - windowMs && other.at <= entry.at).length));
}

test('starts the first four at once and holds the rest for the next window', () => {
  const { clock, pacer, started, call } = setup();
  for (let index = 0; index < 10; index += 1) call(`c${index}`);
  assert.equal(started.length, 4);
  assert.equal(pacer.waiting(), 6);
  clock.advance(999);
  assert.equal(started.length, 4);
  clock.advance(1);
  assert.equal(started.length, 8);
  clock.advance(1000);
  assert.equal(started.length, 10);
  assert.equal(pacer.waiting(), 0);
  assert.deepEqual(names(started), ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']);
});

test('never starts more than four calls in any rolling second', () => {
  const { clock, started, call } = setup();
  let count = 0;
  const burst = (size) => {
    for (let index = 0; index < size; index += 1) call(`c${(count += 1)}`);
  };
  // Bursts and a steady drip, at offsets that straddle window edges.
  for (const [wait, size] of [[0, 3], [250, 2], [100, 6], [900, 1], [10, 5], [333, 4], [1700, 9], [1, 1]]) {
    clock.advance(wait);
    burst(size);
  }
  clock.advance(20_000);
  assert.equal(started.length, count, 'every call ran');
  assert.ok(busiestWindow(started, 1000) <= 4, `busiest second held ${busiestWindow(started, 1000)}`);
});

test('uses a freed slot as soon as the oldest call leaves the window', () => {
  const { clock, started, call } = setup();
  call('a');
  clock.advance(400);
  for (const name of ['b', 'c', 'd', 'e']) call(name);
  assert.deepEqual(names(started), ['a', 'b', 'c', 'd']);
  clock.advance(599);
  assert.equal(started.length, 4);
  clock.advance(1);
  assert.deepEqual(started.at(-1), { name: 'e', at: 1000 });
});

test('lets a send jump everything that is waiting', () => {
  const { clock, started, call } = setup();
  for (const name of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) call(name);
  call('preview', 'background');
  call('send', 'urgent');
  call('r7');
  clock.advance(1000);
  assert.deepEqual(names(started), ['r1', 'r2', 'r3', 'r4', 'send', 'r5', 'r6', 'r7']);
  clock.advance(5000);
  assert.equal(started.at(-1).name, 'preview');
});

test('runs background calls only when the shell has been left alone, one per second', () => {
  const { clock, started, call } = setup();
  call('status');
  for (const name of ['p1', 'p2', 'p3']) call(name, 'background');
  assert.deepEqual(names(started), ['status']);
  clock.advance(999);
  assert.deepEqual(names(started), ['status']);
  clock.advance(1);
  assert.deepEqual(names(started), ['status', 'p1']);
  clock.advance(500);
  call('open-thread');
  assert.equal(started.at(-1).name, 'open-thread', 'a normal call does not wait for the background');
  clock.advance(999);
  assert.equal(started.length, 3);
  clock.advance(1);
  assert.deepEqual(started.at(-1), { name: 'p2', at: 2500 });
  clock.advance(1000);
  assert.deepEqual(started.at(-1), { name: 'p3', at: 3500 });
});

test('starts a background call at once when nothing ran in the last second', () => {
  const { started, call } = setup();
  call('p1', 'background');
  call('p2', 'background');
  assert.deepEqual(names(started), ['p1']);
});

test('hands back what the call returns and what it throws', async () => {
  const { pacer } = setup();
  assert.equal(await pacer.schedule('normal', () => 7), 7);
  assert.equal(await pacer.schedule('normal', () => Promise.resolve('later')), 'later');
  await assert.rejects(pacer.schedule('normal', () => Promise.reject(new Error('refused'))), /refused/);
  await assert.rejects(
    pacer.schedule('normal', () => {
      throw new Error('missing domain');
    }),
    /missing domain/,
  );
});

test('keeps going after a call that throws', () => {
  const { clock, started, call, pacer } = setup({ limit: 1 });
  pacer.schedule('normal', () => {
    throw new Error('boom');
  }).catch(() => undefined);
  call('next');
  clock.advance(1000);
  assert.deepEqual(names(started), ['next']);
});

test('slows to one call a second after a drop, then returns to full pace', () => {
  const { clock, pacer, started, call } = setup();
  pacer.slowDown(3000);
  for (let index = 0; index < 9; index += 1) call(`c${index}`);
  assert.equal(started.length, 1);
  clock.advance(1000);
  assert.equal(started.length, 2);
  clock.advance(1000);
  assert.equal(started.length, 3);
  clock.advance(999);
  assert.equal(started.length, 3);
  clock.advance(1);
  assert.equal(started.length, 7, 'the slow period ended: a full window again');
  assert.deepEqual(started.slice(3).map((entry) => entry.at), [3000, 3000, 3000, 3000]);
  clock.advance(1000);
  assert.equal(started.length, 9);
  assert.ok(busiestWindow(started, 1000) <= 4);
});

test('resumes when the slow period ends even if no slot was due to free', () => {
  const { clock, pacer, started, call } = setup();
  call('a');
  pacer.slowDown(300);
  call('b');
  assert.deepEqual(names(started), ['a']);
  clock.advance(299);
  assert.deepEqual(names(started), ['a']);
  clock.advance(1);
  assert.deepEqual(started.at(-1), { name: 'b', at: 300 });
});

test('keeps the longer of two overlapping slow periods and still lets a send go first', () => {
  const { clock, pacer, started, call } = setup();
  pacer.slowDown(5000);
  pacer.slowDown(1000);
  call('read-1');
  call('read-2');
  call('send', 'urgent');
  clock.advance(1000);
  assert.deepEqual(names(started), ['read-1', 'send']);
  clock.advance(1000);
  assert.deepEqual(names(started), ['read-1', 'send', 'read-2']);
});
