import type { Browser, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { fakeNetwork, GENERAL_RELAYS, generalRelays, signApplet, type SignedApplet } from './live-network';
import { meetingApplet, sharedRelay, type SharedRelay } from './live-meeting';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';

/**
 * Two people, each in a live shell of their own, open the same applet, grant it direct
 * connections and allow the session when the shell asks. The shells introduce them through a relay
 * that exists only in this test; their devices then talk directly (D-042). Peer connections between
 * two headless pages need the browser's local host addresses, which only Chromium resolves here.
 */

async function person(browser: Browser, applet: SignedApplet, relay: SharedRelay, grant: boolean): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await fakeNetwork(page, applet, { 'catalogue.test': 'holds', ...generalRelays('empty') }, { 'blobs.test': 'has' });
  await relay.serve(page, GENERAL_RELAYS.map((host) => `wss://${host}/`));
  await page.goto(`${base}/app/`);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByLabel(/^Password/).fill('correct horse battery');
  await page.getByLabel('Repeat the password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create and sign in' }).click();
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('searchbox', { name: 'Find an applet' }).fill(applet.address(['wss://catalogue.test']));
  await page.getByRole('button', { name: 'Look up' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Feed applet' })).toBeVisible();
  if (grant) await dialog.getByRole('checkbox', { name: /direct connections/ }).check();
  await dialog.getByRole('button', { name: 'Run' }).click();
  return page;
}

const out = (page: Page) => page.frameLocator('iframe[data-window-id]').locator('#out');

test('two people in their own shells meet in a room and their applets talk directly', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'headless Firefox does not resolve the local addresses two pages connect over');
  test.setTimeout(90_000);
  const applet = signApplet({ servers: ['https://blobs.test'], requires: [], optional: ['webrtc'], html: meetingApplet('lobby-1234') });
  const relay = sharedRelay();
  const [ann, ben] = [await person(browser, applet, relay, true), await person(browser, applet, relay, true)];
  for (const page of [ann, ben]) {
    const question = page.getByRole('dialog', { name: 'Connect directly to other people' });
    await expect(question).toBeVisible();
    await expect(question.getByText('direct', { exact: true })).toBeVisible();
    await expect(question.getByText('Your network address, which can show roughly where you are')).toBeVisible();
    await expect(question.getByText('A new name for this window, not your identity')).toBeVisible();
    await question.getByRole('button', { name: 'Allow' }).click();
  }
  for (const page of [ann, ben]) {
    await expect(out(page)).toContainText('joined', { timeout: 30_000 });
    await expect(out(page)).toContainText('message {"hello":"from the other side"}', { timeout: 30_000 });
  }
  // The shells only introduced them: what the applets said never passed through the relay.
  expect(JSON.stringify(relay.published)).not.toContain('from the other side');
});

test('an applet without direct connections opens no session and nobody is asked', async ({ browser }) => {
  const applet = signApplet({ servers: ['https://blobs.test'], requires: [], optional: ['webrtc'], html: meetingApplet('lobby-1234') });
  const relay = sharedRelay();
  const page = await person(browser, applet, relay, false);
  await expect(out(page)).toContainText('failed', { timeout: 20_000 });
  await expect(page.getByRole('dialog', { name: 'Connect directly to other people' })).toHaveCount(0);
  expect(relay.published.filter((event) => event.kind === 25_050)).toEqual([]);
});

test('a person who says no opens nothing', async ({ browser }) => {
  const applet = signApplet({ servers: ['https://blobs.test'], requires: [], optional: ['webrtc'], html: meetingApplet('lobby-1234') });
  const relay = sharedRelay();
  const page = await person(browser, applet, relay, true);
  await page.getByRole('dialog', { name: 'Connect directly to other people' }).getByRole('button', { name: 'Deny' }).click();
  await expect(out(page)).toContainText('failed: policy denied', { timeout: 20_000 });
  expect(relay.published.filter((event) => event.kind === 25_050)).toEqual([]);
});
