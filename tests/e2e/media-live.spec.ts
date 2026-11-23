import { readFileSync } from 'node:fs';
import type { FrameLocator, Locator, Page } from '@playwright/test';
import { expect, openSettings, test } from './fixtures';
import { fakeNetwork, generalRelays, installSignerExtension, signApplet } from './live-network';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';
const FIXTURES = new URL('./media-fixtures/', import.meta.url);
/** Where the proofs for the pull request are written. */
const PROOFS = 'test-results/media-proofs';

/**
 * The live shell plays real media for an applet: the applet names a source on a host that exists
 * only in this browser, the shell fetches and decodes it, lists it in its player, and enforces the
 * person's media settings, chosen in Settings (D-062). Each test leaves a screenshot of what it proved.
 */

const PLAYER_APPLET = `<!doctype html><html><head><meta charset="utf-8"><title>Player</title>
<style>body{font:14px system-ui;margin:12px}button{margin:2px}#state,#log{font-family:monospace;white-space:pre}</style></head><body>
<h1>Test player</h1>
<p><button id="tone">Play tone</button><button id="low">Play low tone</button><button id="clip">Play test card</button>
<button id="own">Play own radio</button><button id="broken">Play missing file</button></p>
<p id="result">ready</p><p id="state"></p><p id="log"></p><script>
const media = window.napplet.media;
const states = {};
const show = () => { document.getElementById('state').textContent = Object.entries(states).map(([k, v]) => k + ': ' + v).join('\\n'); };
const say = (text) => { document.getElementById('result').textContent = text; };
// Each transition the shell gave a reason for; later progress reports carry none.
const note = (text) => { document.getElementById('log').textContent += text + '\\n'; };
async function start(name, file, type) {
  try {
    const result = await media.createSession({ owner: 'shell', source: { url: 'https://media.test/' + file, mimeType: type }, metadata: { title: name, artist: 'Test signal', mediaType: type.startsWith('video') ? 'video' : 'audio' }, autoplay: true });
    if (result.error) return say('refused: ' + result.error);
    say('started ' + name);
    states[name] = 'created'; show();
    media.onState(result.sessionId, (state) => { states[name] = state.status; show(); if (state.reason) note(name + ': ' + state.status + ' (' + state.reason + ')'); });
    media.onEnded(result.sessionId, (ended) => { states[name] = 'ended (' + ended.reason + ')'; show(); note(name + ': ended (' + ended.reason + ')'); });
  } catch (error) { say('refused: ' + error.message); }
}
async function own() {
  const result = await media.createSession({ owner: 'napplet', sessionId: 'own-radio', metadata: { title: 'Own radio', artist: 'Played by the applet' }, capabilities: ['play', 'pause'] });
  const id = result.sessionId;
  media.onCommand(id, (action) => { states['Own radio'] = (action === 'play' ? 'playing' : 'paused') + ' (asked)'; show(); media.reportState(id, { status: action === 'play' ? 'playing' : 'paused' }); });
  media.onEnded(id, (ended) => { states['Own radio'] = 'ended (' + ended.reason + ')'; show(); });
  media.reportState(id, { status: 'playing' });
  states['Own radio'] = 'playing'; show();
}
document.getElementById('tone').onclick = () => start('Morning tone', 'tone.webm', 'audio/webm');
document.getElementById('low').onclick = () => start('Evening tone', 'tone-low.webm', 'audio/webm');
document.getElementById('clip').onclick = () => start('Test card', 'clip.webm', 'video/webm');
document.getElementById('own').onclick = () => own();
document.getElementById('broken').onclick = () => start('Missing', 'missing.webm', 'audio/webm');
</script></body></html>`;

const TYPES: Readonly<Record<string, string>> = { 'tone.webm': 'audio/webm', 'tone-low.webm': 'audio/webm', 'clip.webm': 'video/webm' };

async function serveMedia(page: Page): Promise<string[]> {
  const fetched: string[] = [];
  await page.route('https://media.test/**', (route) => {
    const file = new URL(route.request().url()).pathname.slice(1);
    fetched.push(file);
    const type = TYPES[file];
    if (!type) return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
    return route.fulfill({ status: 200, contentType: type, headers: { 'access-control-allow-origin': '*' }, body: readFileSync(new URL(file, FIXTURES)) });
  });
  return fetched;
}

async function signIn(page: Page, requires: string[] = ['media', 'resource']): Promise<ReturnType<typeof signApplet>> {
  const applet = signApplet({ servers: ['https://blobs.test'], requires, optional: [], html: PLAYER_APPLET });
  await fakeNetwork(page, applet, { 'catalogue.test': 'holds', ...generalRelays('empty') }, { 'blobs.test': 'has' });
  await installSignerExtension(page);
  await page.goto(`${base}/app/`);
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  return applet;
}

/** Run the player applet; the shell is signed in already. */
async function runApplet(page: Page, applet: ReturnType<typeof signApplet>): Promise<FrameLocator> {
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('searchbox', { name: 'Find an applet' }).fill(applet.address(['wss://catalogue.test']));
  await page.getByRole('button', { name: 'Look up' }).click();
  const dialog = page.getByRole('region', { name: 'Applets window' });
  await expect(dialog.getByRole('heading', { name: 'Feed applet' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Run' }).click();
  const frame = page.frameLocator('iframe[data-window-id]').last();
  await expect(frame.locator('h1')).toHaveText('Test player', { timeout: 20_000 });
  return frame;
}

async function open(page: Page): Promise<FrameLocator> {
  await serveMedia(page);
  return runApplet(page, await signIn(page));
}

/** Choose a media setting the way a person does: in the Media section of Settings. */
async function choose(page: Page, group: string, choice: string, phone = false): Promise<void> {
  const settings = phone ? await openSettingsOnPhone(page) : await openSettings(page, 'Media');
  await settings.getByRole('group', { name: group }).getByRole('radio', { name: choice }).check();
  // Escape, not the Close button: a video window may just have opened over Settings, and Escape closes Settings, never a video.
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
}

/** On a phone the bar's items are in its menu. */
async function openSettingsOnPhone(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /^Menu/ }).click();
  await page.getByRole('navigation', { name: 'Shell menu' }).getByRole('button', { name: /^Settings$/ }).click();
  const settings = page.getByRole('region', { name: 'Settings window' });
  await settings.getByRole('tab', { name: 'Media' }).click();
  return settings;
}

const player = (page: Page): Locator => page.getByRole('region', { name: 'Media player' });
const row = (page: Page, title: string): Locator => player(page).getByRole('group', { name: title, exact: true });

async function proof(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${PROOFS}/${name}.png` });
}

/** The shell decodes the session for real: its element's clock moves. */
async function advances(page: Page, selector: string): Promise<void> {
  const at = () => page.locator(selector).first().evaluate((element: HTMLMediaElement) => element.currentTime);
  const first = await at();
  await expect.poll(at, { timeout: 5_000 }).toBeGreaterThan(first);
}

test('an applet asks the shell to play a sound: the player lists it with its applet and controls', async ({ page }) => {
  const frame = await open(page);
  await frame.locator('#tone').click();
  await expect(frame.locator('#state')).toContainText('Morning tone: playing');
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'playing');
  await expect(row(page, 'Morning tone')).toContainText('Test signal · Feed applet · Playing');
  // The shell decodes it: the position it reports moves on.
  await expect(row(page, 'Morning tone').locator('.time').first()).not.toHaveText('0:00', { timeout: 5_000 });
  await proof(page, '01-audio-playing');

  await row(page, 'Morning tone').getByRole('button', { name: 'Pause Morning tone' }).click();
  await expect(frame.locator('#log')).toContainText('Morning tone: paused (user)');
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'paused');
  await proof(page, '02-audio-paused-from-the-player');
});

test('one at a time: the newer sound takes over and the older is paused, ready to take back', async ({ page }) => {
  const frame = await open(page);
  await frame.locator('#tone').click();
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'playing');
  await proof(page, '03-takeover-before');

  await frame.locator('#low').click();
  await expect(row(page, 'Evening tone')).toHaveAttribute('data-status', 'playing');
  await expect(frame.locator('#log')).toContainText('Morning tone: paused (focus-lost)');
  await player(page).getByText('1 more').click();
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'paused');
  await proof(page, '04-takeover-after-older-paused');

  // Playing the older one again takes the output back.
  await row(page, 'Morning tone').getByRole('button', { name: 'Play Morning tone' }).click();
  await expect(frame.locator('#log')).toContainText('Evening tone: paused (focus-lost)');
  await expect(frame.locator('#state')).toContainText('Morning tone: playing');
});

test('one at a time, ending the older: the earlier session is ended for good', async ({ page }) => {
  const frame = await open(page);
  await choose(page, 'When another starts', 'End the earlier one');
  await frame.locator('#tone').click();
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'playing');
  await frame.locator('#low').click();
  await expect(frame.locator('#state')).toContainText('Morning tone: ended (preempted)');
  await expect(player(page)).toHaveAttribute('data-count', '1');
  await expect(player(page).getByText('more')).toHaveCount(0);
  await proof(page, '05-takeover-ends-older');
});

test('several at once: every session plays and has its own controls', async ({ page }) => {
  const frame = await open(page);
  await choose(page, 'Playing at once', 'Several at once');
  await frame.locator('#tone').click();
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'playing');
  await frame.locator('#low').click();
  await expect(row(page, 'Evening tone')).toHaveAttribute('data-status', 'playing');
  await frame.locator('#own').click();
  await expect(row(page, 'Own radio')).toHaveAttribute('data-status', 'playing');
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'playing');
  await expect(player(page)).toHaveAttribute('data-playing', '3');
  await proof(page, '06-several-at-once');

  // Each row controls its own session only.
  await row(page, 'Evening tone').getByRole('button', { name: 'Pause Evening tone' }).click();
  await expect(row(page, 'Evening tone')).toHaveAttribute('data-status', 'paused');
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'playing');
});

test('a video opens in a window of its own by default, and closing the window ends it', async ({ page }) => {
  const frame = await open(page);
  await frame.locator('#clip').click();
  const video = page.getByRole('region', { name: 'Test card window' });
  await expect(video.locator('video')).toBeVisible();
  await advances(page, '[aria-label="Test card window"] video');
  await expect(row(page, 'Test card').getByRole('button', { name: 'Show' })).toBeVisible();
  await proof(page, '07-video-in-a-window');

  await video.getByRole('button', { name: 'Close Test card' }).click();
  await expect(frame.locator('#state')).toContainText('Test card: ended (user)');
  await expect(player(page)).toHaveCount(0);
});

test('switching where videos go moves a playing video without stopping it', async ({ page }) => {
  const frame = await open(page);
  await frame.locator('#clip').click();
  await expect(page.getByRole('region', { name: 'Test card window' }).locator('video')).toBeVisible();
  await choose(page, 'Videos', 'In the player');
  await expect(page.getByRole('region', { name: 'Test card window' })).toHaveCount(0);
  await expect(row(page, 'Test card')).toHaveAttribute('data-status', 'playing');
  await advances(page, '[aria-label="Media player"] video');
  await choose(page, 'Videos', 'In their own window');
  await expect(page.getByRole('region', { name: 'Test card window' }).locator('video')).toBeVisible();
  await advances(page, '[aria-label="Test card window"] video');
  await expect(frame.locator('#log')).not.toContainText('Test card: ended');
});

test("Escape leaves a video's window alone", async ({ page }) => {
  const frame = await open(page);
  await frame.locator('#clip').click();
  const video = page.getByRole('region', { name: 'Test card window' });
  await expect(video.locator('video')).toBeVisible();
  await video.getByRole('toolbar', { name: 'Test card window controls' }).getByText('Test card').click();
  await page.keyboard.press('Escape');
  await expect(video).toBeVisible();
  await expect(row(page, 'Test card')).toHaveAttribute('data-status', 'playing');
});

test('a video window takes its place in a tiled layout', async ({ page }) => {
  const frame = await open(page);
  await page.getByRole('button', { name: /^Layout: floating\./ }).click();
  await frame.locator('#clip').click();
  await expect(page.getByRole('region', { name: 'Test card window' }).locator('video')).toBeVisible();
  await advances(page, '[aria-label="Test card window"] video');
  await proof(page, '20-video-window-tiled');
});

test('an applet granted media but not web fetches cannot have the shell fetch for it', async ({ page }) => {
  const fetched = await serveMedia(page);
  const frame = await runApplet(page, await signIn(page, ['media']));
  await frame.locator('#tone').click();
  // The shell fetches the source the applet named under the applet's own grants.
  await expect(frame.locator('#result')).toHaveText(/^refused: /);
  expect(fetched).toEqual([]);
  await expect(player(page)).toHaveCount(0);
  await frame.locator('#own').click();
  await expect(row(page, 'Own radio')).toHaveAttribute('data-status', 'playing');
});

/** What fills the screen now: whether it holds a playing video, and the shell's controls for it. */
async function filling(page: Page): Promise<{ video: boolean; controls: boolean } | null> {
  return page.evaluate(() => {
    const box = document.fullscreenElement;
    return box ? { video: box.querySelector('video') !== null, controls: box.querySelector('[aria-label^="Pause"]') !== null } : null;
  });
}

test('a video in its own window fills the screen from the shell, with the shell\'s controls, and leaves again', async ({ page }) => {
  const frame = await open(page);
  await frame.locator('#clip').click();
  const video = page.getByRole('region', { name: 'Test card window' });
  await expect(video.locator('video')).toBeVisible();
  await video.getByRole('button', { name: 'Full screen: Test card' }).click();
  await expect.poll(() => filling(page)).toEqual({ video: true, controls: true });
  await advances(page, 'video');
  expect(await page.evaluate(() => document.fullscreenElement?.querySelector('video')?.getBoundingClientRect().height)).toBeGreaterThan(400);
  await expect(video.getByRole('button', { name: 'Exit full screen: Test card' })).toBeVisible();
  await proof(page, '22-full-screen-from-its-window');
  await video.getByRole('button', { name: 'Exit full screen: Test card' }).click();
  await expect.poll(() => filling(page)).toBeNull();
  await expect(video.locator('video')).toBeVisible();
  await expect(row(page, 'Test card')).toHaveAttribute('data-status', 'playing');
});

test('a video docked in the player fills the screen from the shell, and goes back to its row', async ({ page }) => {
  const frame = await open(page);
  await choose(page, 'Videos', 'In the player');
  await frame.locator('#clip').click();
  await expect(row(page, 'Test card').locator('video')).toBeVisible();
  await row(page, 'Test card').getByRole('button', { name: 'Full screen: Test card' }).click();
  await expect.poll(() => filling(page)).toEqual({ video: true, controls: true });
  await advances(page, 'video');
  // The picture fills what the controls leave: it is not squeezed away.
  expect(await page.evaluate(() => document.fullscreenElement?.querySelector('video')?.getBoundingClientRect().height)).toBeGreaterThan(400);
  await proof(page, '23-full-screen-from-the-player');
  await row(page, 'Test card').getByRole('button', { name: 'Exit full screen: Test card' }).click();
  await expect.poll(() => filling(page)).toBeNull();
  await expect(row(page, 'Test card').locator('video')).toBeVisible();
  await expect(row(page, 'Test card')).toHaveAttribute('data-status', 'playing');
});

test('only the shell offers full screen: a sound has none, and neither does a brief row', async ({ page }) => {
  const frame = await open(page);
  await choose(page, 'Videos', 'In the player');
  await frame.locator('#clip').click();
  await expect(row(page, 'Test card').locator('video')).toBeVisible();
  await frame.locator('#tone').click();
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'playing');
  await expect(row(page, 'Morning tone').getByRole('button', { name: /Full screen/ })).toHaveCount(0);
  await player(page).getByText('1 more').click();
  await expect(row(page, 'Test card').getByRole('button', { name: /Full screen/ })).toHaveCount(0);
});

test('a video can be docked in the player instead', async ({ page }) => {
  const frame = await open(page);
  await choose(page, 'Videos', 'In the player');
  await frame.locator('#clip').click();
  await expect(row(page, 'Test card').locator('video')).toBeVisible();
  await advances(page, '[aria-label="Media player"] video');
  await expect(page.getByRole('region', { name: 'Test card window' })).toHaveCount(0);
  await proof(page, '08-video-docked-in-the-player');
});

test('the person can make sessions wait for play', async ({ page }) => {
  const frame = await open(page);
  await choose(page, 'Starting on its own', 'Wait for play');
  await frame.locator('#tone').click();
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'paused');
  await expect(row(page, 'Morning tone').getByRole('button', { name: 'Play Morning tone' })).toBeVisible();
  await proof(page, '09-autoplay-waits-for-play');
  await row(page, 'Morning tone').getByRole('button', { name: 'Play Morning tone' }).click();
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'playing');
});

test('a hidden window pauses when the person chose that, and picks up when shown', async ({ page }) => {
  const frame = await open(page);
  await choose(page, 'Hidden windows', 'Pause until shown');
  await frame.locator('#tone').click();
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'playing');
  await page.getByRole('button', { name: 'Minimise Feed applet' }).click();
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'paused');
  await proof(page, '10-hidden-window-paused');
  await page.getByRole('list', { name: 'Minimised windows' }).getByRole('button', { name: 'Feed applet' }).click();
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'playing');
  await expect(frame.locator('#log')).toContainText('Morning tone: playing (focus-gained)');
});

test("a hidden window keeps playing by default", async ({ page }) => {
  const frame = await open(page);
  await frame.locator('#tone').click();
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'playing');
  await page.getByRole('button', { name: 'Minimise Feed applet' }).click();
  await page.waitForTimeout(500);
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'playing');
  await proof(page, '11-hidden-window-keeps-playing');
});

test("an applet's own media is still steered while its window is hidden", async ({ page }) => {
  const frame = await open(page);
  await frame.locator('#own').click();
  await expect(row(page, 'Own radio')).toHaveAttribute('data-status', 'playing');
  await page.getByRole('button', { name: 'Minimise Feed applet' }).click();
  // The applet's answer comes from a hidden window; the guard lets reports on a session through.
  await row(page, 'Own radio').getByRole('button', { name: 'Pause Own radio' }).click();
  await expect(row(page, 'Own radio')).toHaveAttribute('data-status', 'paused');
});

test("media an applet plays itself is listed, and asked to pause when another takes over", async ({ page }) => {
  const frame = await open(page);
  await frame.locator('#own').click();
  await expect(row(page, 'Own radio')).toHaveAttribute('data-status', 'playing');
  await expect(row(page, 'Own radio')).toContainText('Played by the applet · Feed applet');
  await proof(page, '12-applet-played-media-listed');
  await frame.locator('#tone').click();
  await expect(frame.locator('#state')).toContainText('Own radio: paused (asked)');
  await player(page).getByText('1 more').click();
  await expect(row(page, 'Own radio')).toHaveAttribute('data-status', 'paused');
  await proof(page, '13-applet-played-media-paused-by-takeover');
});

test.describe('a missing source', () => {
  // The source host answers 404 on purpose; the browser reports that load, and nothing else is excused.
  test.use({ expectedConsoleError: /status of 404/ });

  test('a source the shell cannot fetch is refused and nothing is listed', async ({ page }) => {
  const frame = await open(page);
  await frame.locator('#broken').click();
  await expect(frame.locator('#result')).toHaveText(/^refused: /);
  await expect(player(page)).toHaveCount(0);
  await proof(page, '14-source-refused');
  });
});

test("with Stop, closing the applet ends what it played and closes its video's window", async ({ page }) => {
  const frame = await open(page);
  await choose(page, 'When its applet closes', 'Stop');
  await frame.locator('#tone').click();
  await frame.locator('#clip').click();
  await expect(page.getByRole('region', { name: 'Test card window' })).toBeVisible();
  // The video's window opened over the applet's title bar; it is set aside to reach the applet's Close.
  await page.getByRole('button', { name: 'Minimise Test card' }).click();
  await page.getByRole('button', { name: 'Close Feed applet' }).click();
  await expect(player(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Test card window' })).toHaveCount(0);
  await proof(page, '15-applet-closed-media-gone');
});

test('by default, what the shell plays keeps playing after its applet closes, until the person ends it', async ({ page }) => {
  const frame = await open(page);
  await choose(page, 'Playing at once', 'Several at once');
  await frame.locator('#tone').click();
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'playing');
  await frame.locator('#own').click();
  await expect(row(page, 'Own radio')).toHaveAttribute('data-status', 'playing');
  await frame.locator('#clip').click();
  const video = page.getByRole('region', { name: 'Test card window' });
  await expect(video.locator('video')).toBeVisible();
  await page.getByRole('button', { name: 'Minimise Test card' }).click();
  await page.getByRole('button', { name: 'Close Feed applet' }).click();
  await expect(page.getByRole('region', { name: 'Feed applet window' })).toHaveCount(0);
  // The applet's own radio played in its frame and went with it; what the shell played is kept, detached from the applet.
  await expect(row(page, 'Own radio')).toHaveCount(0);
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'playing');
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-detached', 'true');
  await expect(row(page, 'Morning tone')).toContainText('Test signal · Feed applet (closed) · Playing');
  await row(page, 'Test card').getByRole('button', { name: 'Show' }).click();
  await expect(video.locator('video')).toBeVisible();
  await advances(page, '[aria-label="Test card window"] video');
  await proof(page, '24-applet-closed-media-keeps-playing');

  await row(page, 'Morning tone').getByRole('button', { name: 'Pause Morning tone' }).click();
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'paused');
  await row(page, 'Morning tone').getByRole('button', { name: 'End Morning tone' }).click();
  await expect(row(page, 'Morning tone')).toHaveCount(0);
  await video.getByRole('button', { name: 'Close Test card' }).click();
  await expect(player(page)).toHaveCount(0);
});

test('with Pause, what the shell plays is kept paused when its applet closes, ready to play on', async ({ page }) => {
  const frame = await open(page);
  await choose(page, 'When its applet closes', 'Pause');
  await frame.locator('#tone').click();
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'playing');
  await page.getByRole('button', { name: 'Close Feed applet' }).click();
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'paused');
  await expect(row(page, 'Morning tone')).toContainText('Feed applet (closed)');
  await proof(page, '25-applet-closed-media-paused');
  await row(page, 'Morning tone').getByRole('button', { name: 'Play Morning tone' }).click();
  await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'playing');
});

test('the Media section of Settings offers every choice, and keeps it', async ({ page }) => {
  await signIn(page);
  const settings = await openSettings(page, 'Media');
  for (const group of ['Playing at once', 'When another starts', 'Videos', 'Hidden windows', 'Starting on its own', 'When its applet closes']) {
    await expect(settings.getByRole('group', { name: group })).toBeVisible();
  }
  await expect(settings.getByRole('radio', { name: 'One at a time (default)' })).toBeChecked();
  await proof(page, '16-settings-defaults');
  await settings.getByRole('radio', { name: 'Several at once' }).check();
  // What happens to an earlier session only matters while one plays at a time.
  await expect(settings.getByRole('group', { name: 'When another starts' })).toHaveCount(0);
  await settings.getByRole('radio', { name: 'In the player' }).check();
  await proof(page, '17-settings-several-docked');
  await page.reload();
  const again = await openSettings(page, 'Media');
  await expect(again.getByRole('radio', { name: 'Several at once' })).toBeChecked();
  await expect(again.getByRole('radio', { name: 'In the player' })).toBeChecked();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('on a phone a video opens in its own window by default', async ({ page }) => {
    const frame = await open(page);
    await frame.locator('#clip').click();
    const video = page.getByRole('region', { name: 'Test card window' });
    await expect(video.locator('video')).toBeVisible();
    await advances(page, '[aria-label="Test card window"] video');
    await proof(page, '21-phone-video-window');
  });

  test('the player fits a phone, with a docked video above its controls', async ({ page }) => {
    await serveMedia(page);
    const applet = await signIn(page);
    await choose(page, 'Videos', 'In the player', true);
    const frame = await runApplet(page, applet);
    await frame.locator('#clip').click();
    await expect(row(page, 'Test card').locator('video')).toBeVisible();
    await expect(row(page, 'Test card').getByRole('slider', { name: 'Volume of Test card' })).toBeHidden();
    await proof(page, '18-phone-docked-video');
  });
});

test.describe('in the dark theme', () => {
  test.use({ colorScheme: 'dark' });

  test('the player reads in the dark theme, a docked video above the earlier session', async ({ page }) => {
    const frame = await open(page);
    await choose(page, 'Videos', 'In the player');
    await frame.locator('#tone').click();
    await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'playing');
    await frame.locator('#clip').click();
    await expect(row(page, 'Test card').locator('video')).toBeVisible();
    await player(page).getByText('1 more').click();
    await expect(row(page, 'Morning tone')).toHaveAttribute('data-status', 'paused');
    await proof(page, '19-dark-docked-video-and-earlier-session');
  });
});
