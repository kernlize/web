/*
  Four-frame check for the built applet, driven through the STUB shell in
  stub-shell.js (see the warning at the top of that file). It loads
  dist/index.html exactly as built into a sandbox="allow-scripts" srcdoc
  iframe that fills the viewport, walks the main flows, fails on overflow or
  on a word people should never see, and writes PNGs to tests/screenshots/.

  Run `pnpm build` first, then `pnpm test:frames`.
*/
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(dirname(here));
const shots = join(root, 'tests', 'screenshots');

const FRAMES = [
  { width: 200, height: 160 },
  { width: 320, height: 560 },
  { width: 900, height: 600 },
  { width: 2400, height: 1200 },
];
const THEMES = ['dark', 'light'];
const FORBIDDEN = /nostr|nip-?\d|napplet|relay|pubkey|npub|nsec|marmot|\bmls\b|invalid:|unavailable:|denied:|firewall|private:|legacy:/i;
const HOST = `<!doctype html><html><head><style>
  html, body { margin: 0; height: 100%; background: #7f7f7f; }
  iframe { display: block; width: 100vw; height: 100vh; border: 0; }
</style></head><body><iframe sandbox="allow-scripts" title="Messages on the stub shell"></iframe></body></html>`;

const artifact = await readFile(join(root, 'dist', 'index.html'), 'utf8');
const stub = await readFile(join(here, 'stub-shell.js'), 'utf8');

function srcdoc(config) {
  const prelude = `<script>window.__HARNESS__ = ${JSON.stringify(config)};</script><script>${stub}</script>`;
  assert.match(artifact, /<head>/, 'the artifact has a <head> to inject the stub into');
  return artifact.replace('<head>', `<head>${prelude}`);
}

async function load(browser, frame, config) {
  const context = await browser.newContext({
    viewport: frame,
    colorScheme: config.colorScheme ?? 'light',
  });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  await page.setContent(HOST);
  await page.evaluate((html) => {
    document.querySelector('iframe').srcdoc = html;
  }, srcdoc(config));
  const app = page.frameLocator('iframe');
  await app.locator('#frame:not([data-phase="loading"])').waitFor();
  const inner = page.frames().find((candidate) => candidate !== page.mainFrame());
  // The theme is asked for after the list, so it lands a moment later.
  if (config.theme !== 'none') {
    await inner.waitForFunction(() => document.documentElement.style.getPropertyValue('--bg') !== '');
  }
  return { page, app, inner, problems, config, close: () => context.close() };
}

/** Everything a person can read or have read to them, in one string. */
function readableText(inner) {
  return inner.evaluate(() => {
    const visible = (element) => element.getClientRects().length > 0;
    const spoken = [...document.querySelectorAll('[aria-label], [title], [placeholder]')]
      .filter(visible)
      .flatMap((element) => ['aria-label', 'title', 'placeholder'].map((name) => element.getAttribute(name) ?? ''));
    return [document.body.innerText, ...spoken].join('\n');
  });
}

/**
 * What the stub's guard saw: nothing dropped, and never more than four
 * requests in any rolling second. Skipped when the run starves the budget on
 * purpose.
 */
async function checkPacing(session, label) {
  const { calls, dropped } = await session.inner.evaluate(() => ({ calls: window.__stub.calls, dropped: window.__stub.dropped }));
  const busiest = Math.max(0, ...calls.map((call) => calls.filter((other) => other.at > call.at - 1000 && other.at <= call.at).length));
  assert.ok(busiest <= 4, `${label}: ${busiest} requests in one second`);
  if (session.config.budget === undefined) assert.deepEqual(dropped, [], `${label}: requests over the shell's budget`);
  return calls;
}

async function checkFrame(session, label) {
  const { inner, problems } = session;
  await checkPacing(session, label);
  const layout = await inner.evaluate(() => {
    const clipped = [...document.querySelectorAll('button, input, textarea')]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => ({ id: element.id || element.className, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.left < -0.5 || box.top < -0.5 || box.right > innerWidth + 0.5 || box.bottom > innerHeight + 0.5)
      .map(({ id }) => id);
    const root = document.documentElement;
    return {
      clipped: clipped.filter((id) => !/thread-item|text-button/.test(id)),
      overflowX: root.scrollWidth > innerWidth,
      overflowY: root.scrollHeight > innerHeight,
      background: getComputedStyle(document.body).backgroundColor,
    };
  });
  assert.deepEqual(layout.clipped, [], `${label}: controls outside the frame`);
  assert.equal(layout.overflowX, false, `${label}: horizontal overflow`);
  assert.equal(layout.overflowY, false, `${label}: document scrolls instead of a region`);
  assert.doesNotMatch(await readableText(inner), FORBIDDEN, `${label}: forbidden wording`);
  assert.deepEqual(problems, [], `${label}: page errors`);
  return layout;
}

async function shoot(session, name) {
  const layout = await checkFrame(session, name);
  await session.page.screenshot({ path: join(shots, `${name}.png`) });
  return layout;
}

const sizeName = (frame) => `${frame.width}x${frame.height}`;

async function mainFlow(browser, frame, theme) {
  const session = await load(browser, frame, { scenario: 'seeded', theme });
  const { app, inner } = session;
  const name = `${sizeName(frame)}-${theme}`;
  const single = frame.width < 480;
  const items = app.locator('.thread-item');

  // The stub pushes one message on a conversation id it never listed; the
  // applet has to ask who is in it and fold it into that person's thread.
  const badgeOf = (title) => app.locator('.thread-item', { hasText: title }).locator('.badge');
  await badgeOf('3bf0c63f…459d').waitFor({ state: 'attached' });
  assert.equal(await items.count(), 3, 'five conversation ids, three threads');
  await inner.waitForFunction(() => window.__stub.notices.length > 0);
  const [notice] = await inner.evaluate(() => window.__stub.notices);
  assert.deepEqual(notice, { title: '3bf0c63f…459d', body: 'Are you around this week?' });
  // Previews and unread counts arrive one thread at a time, in the background.
  await inner.waitForFunction(() => document.querySelectorAll('.thread-preview').length === 3);
  assert.equal(await badgeOf('Weekend hike').innerText(), '2');
  const colours = await shoot(session, `${name}-list`);
  const expected = theme === 'dark' ? 'rgb(16, 17, 20)' : 'rgb(251, 251, 250)';
  assert.equal(colours.background, expected, 'the shell theme paints the page background');

  await app.getByRole('button', { name: 'Ada Lovelace', exact: true }).click();
  const log = app.getByRole('log');
  await log.getByText('Around six.').waitFor();
  await log.getByText('Did you get the notes from Tuesday?').waitFor({ state: 'attached' });
  assert.ok((await log.locator('.day').count()) >= 3, 'history from both conversations, grouped by day');
  assert.equal(await app.locator('#listPane').isVisible(), !single, 'list beside the thread only from 480px');
  await shoot(session, `${name}-thread`);

  const input = app.getByRole('textbox', { name: 'Message' });
  await input.fill('See you at six then.');
  await app.getByRole('button', { name: 'Send' }).click();
  await log.getByText('sending…').waitFor();
  await log.getByText('Sounds good. See you then.').waitFor();
  assert.equal(await log.getByText('sending…').count(), 0, 'the bubble settles once the shell answers');
  assert.deepEqual(
    (await log.locator('.msg .text').allInnerTexts()).slice(-2),
    ['See you at six then.', 'Sounds good. See you then.'],
    'a reply in the same second stays under the message it answers',
  );
  assert.equal(await app.getByRole('button', { name: 'Ada Lovelace', exact: true }).count(), single ? 0 : 1);
  const [request] = await inner.evaluate(() => window.__stub.sends);
  assert.equal(request.conversationId, undefined, 'a direct send names no conversation');
  assert.equal(request.recipients.length, 1);
  assert.ok(request.clientMessageId);

  await input.fill('This one is refused [[refuse]]');
  await input.press('Enter');
  await log.getByText('Not sent.').waitFor();
  await assert.doesNotReject(log.getByRole('button', { name: 'Retry' }).waitFor());
  await shoot(session, `${name}-after-send`);
  await session.close();
}

async function stateShots(browser) {
  const frame = FRAMES[1];
  for (const scenario of ['unavailable', 'signed-out', 'empty']) {
    const session = await load(browser, frame, { scenario, theme: 'dark' });
    const newMessage = session.app.getByRole('button', { name: 'New message', exact: true });
    assert.equal(await newMessage.count(), scenario === 'empty' ? 1 : 0, `${scenario}: one way to start a message`);
    await shoot(session, `${sizeName(frame)}-dark-state-${scenario}`);
    await session.close();
  }

  const session = await load(browser, frame, { scenario: 'seeded', theme: 'light' });
  const { app, inner } = session;
  await app.locator('.thread-item').first().waitFor();
  await inner.evaluate(() => window.__stub.runAction('messages.new'));
  const to = app.getByRole('textbox', { name: 'To' });
  await to.fill('not an account');
  await to.press('Enter');
  await app.getByText('That does not look like an account id.').waitFor();
  await shoot(session, `${sizeName(frame)}-light-new-message`);
  await to.fill(await inner.evaluate(() => window.__stub.stranger));
  await to.press('Enter');
  await app.getByText('No messages yet.').waitFor();
  assert.equal(await app.getByRole('textbox', { name: 'Message' }).evaluate((el) => el === document.activeElement), true);
  await session.close();
}

async function behaviour(browser) {
  const session = await load(browser, FRAMES[2], { scenario: 'seeded', theme: 'dark' });
  const { app, inner } = session;
  const input = app.getByRole('textbox', { name: 'Message' });
  const log = app.getByRole('log');
  // Names other tests find things by.
  assert.equal(await app.getByRole('searchbox', { name: 'Search conversations' }).count(), 1);
  assert.equal(await app.getByRole('button', { name: 'New message', exact: true }).count(), 1);
  const unnamed = app.getByRole('button', { name: '3bf0c63f…459d', exact: true });
  await app.locator('.thread-item', { hasText: '3bf0c63f…459d' }).locator('.badge').waitFor({ state: 'attached' });
  assert.equal(await unnamed.getAttribute('aria-describedby').then((id) => app.locator(`#${id}`).textContent()), '1 unread');

  // The first second is the shell's tightest: the list and nothing else.
  await inner.waitForFunction(() => window.__stub.actions.size === 3);
  const calls = await checkPacing(session, 'startup');
  assert.deepEqual(calls.slice(0, 5).map((call) => call.name), [
    'dm.status',
    'storage.getItem',
    'dm.conversations',
    'dm.subscribe',
    'theme.get',
  ]);
  assert.ok(calls[4].at >= calls[0].at + 1000, 'the theme waits for the second second');
  assert.equal(calls.filter((call) => call.at < calls[0].at + 1000).length <= 4, true);
  assert.equal(calls.some((call) => call.name === 'identity.getPublicKey'), false, 'the status named the owner');

  assert.deepEqual(await inner.evaluate(() => [...window.__stub.actions.keys()]), [
    'messages.new',
    'messages.next',
    'messages.previous',
  ]);
  await inner.evaluate(() => window.__stub.runAction('messages.next'));
  await app.locator('.thread-item[aria-current="true"]').waitFor();
  assert.equal(await app.locator('.thread-item').first().getAttribute('aria-current'), 'true');
  assert.equal(await unnamed.getAttribute('aria-describedby'), null, 'opening marks it seen');

  await app.getByRole('button', { name: 'Weekend hike', exact: true }).click();
  await log.getByText('Grace Hopper').first().waitFor();
  await input.fill('a draft for the group');
  await app.getByRole('button', { name: 'Ada Lovelace', exact: true }).click();
  await log.getByText('Around six.').waitFor();
  assert.equal(await input.inputValue(), '');
  await app.getByRole('button', { name: 'Weekend hike', exact: true }).click();
  assert.equal(await input.inputValue(), 'a draft for the group', 'drafts are kept per thread');
  await input.press('Enter');
  await log.getByText('a draft for the group').waitFor();
  const groupSend = (await inner.evaluate(() => window.__stub.sends)).at(-1);
  assert.deepEqual(groupSend, { conversationId: 'private:group-hike', recipients: [], content: 'a draft for the group' });

  // A shell that is still asking the person a question: nothing times out and
  // the composer keeps working.
  await input.fill('held back [[hold]]');
  await input.press('Enter');
  await input.fill('second thought');
  await input.press('Enter');
  await log.getByText('second thought').waitFor();
  await session.page.waitForTimeout(1500);
  assert.equal(await log.getByText('sending…').count(), 1);
  assert.equal(await log.getByText('Not sent.').count(), 0);
  await shoot(session, `${sizeName(FRAMES[2])}-dark-group-pending`);

  // The binding gave up waiting but the shell sent it anyway: the bubble must
  // not turn into a refusal, and the echo must settle it without a duplicate.
  await input.fill('slow answer [[late]]');
  await input.press('Enter');
  await session.page.waitForTimeout(500);
  assert.equal(await log.getByText('Not sent.').count(), 0);
  assert.equal(await log.getByText('sending…').count(), 2);
  await app.locator('.msg.sent', { hasText: 'slow answer' }).waitFor();
  assert.equal(await log.getByText('slow answer [[late]]').count(), 1);
  assert.equal(await log.getByText('sending…').count(), 1);

  // Declined in the shell, answered as a resolved error record: one request,
  // the plain two words, and nothing sent again by itself.
  await input.fill('never mind [[cancel]]');
  await input.press('Enter');
  const declined = app.locator('.msg.failed', { hasText: 'never mind' });
  await declined.waitFor();
  assert.equal(await declined.locator('.problem-text').innerText(), 'Not sent.');
  await session.page.waitForTimeout(1500);
  const cancelled = (await inner.evaluate(() => window.__stub.sends)).filter((request) => request.content.includes('[[cancel]]'));
  assert.equal(cancelled.length, 1, 'a refused send is never repeated');

  await inner.evaluate(() => window.__stub.setTheme('light'));
  const background = await inner.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  assert.equal(background, 'rgb(251, 251, 250)', 'a theme change repaints the whole surface');
  await checkFrame(session, 'behaviour');
  await session.close();
}

/** Open a thread and send before its history has even been asked for. */
async function sendAtOnce(browser) {
  const session = await load(browser, FRAMES[1], { scenario: 'seeded', theme: 'dark' });
  const { app } = session;
  await app.getByRole('button', { name: 'Ada Lovelace', exact: true }).click();
  const input = app.getByRole('textbox', { name: 'Message' });
  await input.fill('Right away.');
  await app.getByRole('button', { name: 'Send' }).click();
  const log = app.getByRole('log', { name: 'Messages' });
  await log.getByText('Sounds good. See you then.').waitFor();
  await log.getByText('Around six.').waitFor();
  assert.equal(await log.getByText('sending…').count(), 0);
  assert.equal(await app.getByText('Could not load this conversation.').count(), 0);
  await checkFrame(session, 'send at once');
  await session.close();
}

/**
 * A shell with a quarter of the budget (an unfocused window), dropping or
 * refusing the excess: reads are asked again and the list still arrives.
 */
async function starvedBudget(browser) {
  for (const guard of ['drop', 'refuse', 'refuse-record']) {
    const session = await load(browser, FRAMES[1], { scenario: 'seeded', theme: 'dark', budget: 2, guard });
    const { app, inner } = session;
    await app.locator('.thread-item').first().waitFor();
    assert.equal(await app.locator('.thread-item').count() >= 3, true, `${guard}: the list survived`);
    assert.ok((await inner.evaluate(() => window.__stub.dropped.length)) > 0, `${guard}: the budget was exceeded`);
    await app.getByRole('button', { name: 'Ada Lovelace', exact: true }).click();
    await app.getByRole('log', { name: 'Messages' }).getByText('Around six.').waitFor();
    await checkPacing(session, `starved (${guard})`);
    await session.close();
  }
}

async function fallbackShots(browser) {
  // No theme, storage, notices, shortcuts or account lookup: the local palette
  // follows the system preference and the applet still does its one job.
  const omit = ['identity', 'storage', 'notify', 'keys'];
  for (const colorScheme of ['dark', 'light']) {
    const session = await load(browser, FRAMES[2], { scenario: 'seeded', theme: 'none', omit, colorScheme });
    await session.app.getByRole('button', { name: 'Ada Lovelace', exact: true }).click();
    await session.app.getByRole('log').getByText('Around six.').waitFor();
    await shoot(session, `${sizeName(FRAMES[2])}-no-theme-${colorScheme}`);
    await session.close();
  }
}

await mkdir(shots, { recursive: true });
const browser = await chromium.launch();
try {
  for (const frame of FRAMES) {
    for (const theme of THEMES) await mainFlow(browser, frame, theme);
  }
  await stateShots(browser);
  await behaviour(browser);
  await sendAtOnce(browser);
  await starvedBudget(browser);
  await fallbackShots(browser);
} finally {
  await browser.close();
}
console.log(`frames ok: screenshots in ${shots}`);
