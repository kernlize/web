import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { fakeNetwork, signApplet } from './live-network';

/**
 * The live shell, the real core and kehto's bridge, against a network that exists only in this
 * browser. Reloading an applet from its window mounts a fresh frame from the verified bytes under a
 * new window id; the window stays where it was, and nothing is revoked for a second load.
 */

const proofs = process.env.KERNL_PROOFS_DIR;

/** An applet that counts clicks, so a fresh start shows, and can break NIP-5D on request. */
const COUNTING_APPLET = `<!doctype html><html><head><meta charset="utf-8"><title>Counter</title></head><body><h1>Counter</h1>
<button id="add" type="button">Add one</button>
<button id="post" type="button">Post to the parent</button>
<p id="count">0</p>
<script>
let count = 0;
document.getElementById('add').addEventListener('click', () => { count += 1; document.getElementById('count').textContent = String(count); });
document.getElementById('post').addEventListener('click', () => window.parent.postMessage({ type: 'debug.log' }, '*'));
window.napplet.storage.getItem('k').then(() => { document.body.dataset.bound = 'yes'; });
</script></body></html>`;

async function runCounter(page: Page): Promise<string> {
  const applet = signApplet({ servers: ['https://blobs.test/'], requires: [], optional: [], html: COUNTING_APPLET });
  await fakeNetwork(page, applet, { 'catalogue.test': 'holds' }, { 'blobs.test': 'has' });
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByLabel(/^Password/).fill('correct horse battery');
  await page.getByLabel('Repeat the password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create and sign in' }).click();
  await page.getByRole('button', { name: 'Open an applet' }).click();
  const address = applet.address(['wss://catalogue.test']);
  await page.getByRole('searchbox', { name: 'Find an applet' }).fill(address);
  await page.getByRole('button', { name: 'Look up' }).click();
  await page.getByRole('region', { name: 'Applets window' }).getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'running');
  return address;
}

const frame = (page: Page) => page.frameLocator('iframe[data-window-id]');
const appletWindow = (page: Page) => page.locator('section.window').filter({ has: page.getByText('Feed applet', { exact: true }) });

async function proof(page: Page, name: string): Promise<void> {
  if (!proofs) return;
  await page.screenshot({ path: `${proofs}/${name}.png`, animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: `${proofs}/${name}-light.png`, animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
}

// Every socket but the one catalogue relay is refused, which each engine reports in its own words.
test.use({ colorScheme: 'dark', viewport: { width: 1280, height: 800 }, expectedConsoleError: /WebSocket|ERR_CONNECTION|NS_ERROR|can.t establish a connection/i });

test('reloading a running applet starts it fresh in a new frame, where its window was', async ({ page }) => {
  await runCounter(page);
  const window = appletWindow(page);
  await window.locator('.title-bar').dragTo(page.locator('body'), { targetPosition: { x: 520, y: 140 } });
  await frame(page).getByRole('button', { name: 'Add one' }).click();
  await frame(page).getByRole('button', { name: 'Add one' }).click();
  await expect(frame(page).locator('#count')).toHaveText('2');
  const before = { box: await window.boundingBox(), id: await page.locator('iframe[data-window-id]').getAttribute('data-window-id') };
  await proof(page, '01-running-with-reload');

  await page.getByRole('button', { name: 'Reload Feed applet' }).click();
  await expect(page.locator('iframe[data-window-id]')).not.toHaveAttribute('data-window-id', before.id ?? '');
  await expect(window).toHaveAttribute('data-status', 'running');
  await expect(frame(page).locator('body')).toHaveAttribute('data-bound', 'yes');
  await expect(frame(page).locator('#count')).toHaveText('0');
  await expect(page.locator('iframe[data-window-id]')).toHaveCount(1);
  expect(await window.boundingBox()).toEqual(before.box);
  // A fresh frame, not a second load of the old one: nothing was revoked.
  await expect(page.getByText('Feed applet was stopped')).toHaveCount(0);
  await proof(page, '02-reloaded');

  // At 720 wide or less every window fills the desktop; the title bar still has room for Reload.
  await page.setViewportSize({ width: 700, height: 800 });
  await expect(page.getByRole('button', { name: 'Reload Feed applet' })).toBeVisible();
  await proof(page, '04-narrow');
  // On a phone every button in the bar still fits, Close included.
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.getByRole('button', { name: 'Close Feed applet' })).toBeInViewport({ ratio: 1 });
  await proof(page, '05-phone');
});

test('a stopped applet can be reloaded from its stopped window', async ({ page }) => {
  await runCounter(page);
  await frame(page).getByRole('button', { name: 'Post to the parent' }).click();
  const window = appletWindow(page);
  await expect(window).toHaveAttribute('data-status', 'revoked');
  await expect(window.getByTestId('stop-words')).toHaveText('It sent a message outside its channel.');
  await proof(page, '03-stopped-with-reload');

  await window.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(window).toHaveAttribute('data-status', 'running');
  await expect(window.getByTestId('stop-words')).toHaveCount(0);
  await expect(frame(page).locator('body')).toHaveAttribute('data-bound', 'yes');
  await expect(frame(page).getByRole('heading', { name: 'Counter' })).toBeVisible();
});

test('a blocked applet offers no reload, only closing', async ({ page }) => {
  await runCounter(page);
  await page.getByRole('button', { name: 'Grants for Feed applet' }).click();
  await page.getByRole('button', { name: 'Block applet' }).click();
  await page.keyboard.press('Escape');
  const window = appletWindow(page);
  await expect(window).toHaveAttribute('data-status', 'revoked');
  await expect(window.getByRole('button', { name: 'Reload', exact: true })).toHaveCount(0);
  await expect(window.getByRole('button', { name: 'Close window' })).toBeVisible();
});

test('reloading one applet leaves another one running untouched', async ({ page }) => {
  const address = await runCounter(page);
  // The same applet again, in a second window after the first.
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('searchbox', { name: 'Find an applet' }).fill(address);
  await page.getByRole('button', { name: 'Look up' }).click();
  await page.getByRole('region', { name: 'Applets window' }).getByRole('button', { name: 'Run' }).click();
  const frames = page.locator('iframe[data-window-id]');
  await expect(frames).toHaveCount(2);
  const [first, second] = await frames.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-window-id') ?? ''));
  const other = page.frameLocator(`iframe[data-window-id="${second}"]`);
  await expect(other.locator('body')).toHaveAttribute('data-bound', 'yes');
  await other.getByRole('button', { name: 'Add one' }).click();
  await expect(other.locator('#count')).toHaveText('1');

  const windows = page.locator('section.window').filter({ has: page.getByText('Feed applet', { exact: true }) });
  await windows.nth(0).getByRole('button', { name: 'Reload Feed applet' }).click();
  await expect(frames).toHaveCount(2);
  await expect(page.locator(`iframe[data-window-id="${first}"]`)).toHaveCount(0);
  await expect(other.locator('#count')).toHaveText('1');

  // Stopped, then reloaded from its stopped window: the other applet still never notices.
  await page.frameLocator(`iframe[data-window-id]:not([data-window-id="${second}"])`).getByRole('button', { name: 'Post to the parent' }).click();
  await expect(windows.nth(0)).toHaveAttribute('data-status', 'revoked');
  await windows.nth(0).getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(windows.nth(0)).toHaveAttribute('data-status', 'running');
  await expect(frames).toHaveCount(2);
  await expect(page.locator(`iframe[data-window-id="${second}"]`)).toHaveCount(1);
  await expect(windows.nth(1)).toHaveAttribute('data-status', 'running');
  await expect(other.locator('#count')).toHaveText('1');
  await expect(page.getByText('Feed applet was stopped')).toHaveCount(1);
});
