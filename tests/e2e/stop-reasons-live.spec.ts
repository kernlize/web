import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { fakeNetwork, signApplet } from './live-network';

/**
 * The live shell, the real core and kehto's bridge, against a network that exists only in this
 * browser. An applet that kehto or the guard stops says what happened in one plain line; the code,
 * kehto's own detail and any limit crossed sit behind Details.
 */

const proofs = process.env.KERNL_PROOFS_DIR;

/** An applet with one button that breaks NIP-5D by posting to the parent window, and one that floods its storage. */
const MISBEHAVING_APPLET = `<!doctype html><html><head><meta charset="utf-8"><title>Noisy</title></head><body><h1>Noisy</h1>
<button id="post" type="button">Post to the parent</button>
<button id="flood" type="button">Flood storage</button>
<script>
document.getElementById('post').addEventListener('click', () => window.parent.postMessage({ type: 'debug.log' }, '*'));
document.getElementById('flood').addEventListener('click', () => {
  for (let i = 0; i < 320; i += 1) window.napplet.storage.getItem('k').catch(() => undefined);
});
</script></body></html>`;

async function runNoisyApplet(page: Page): Promise<void> {
  const applet = signApplet({ servers: ['https://blobs.test/'], requires: [], optional: [], html: MISBEHAVING_APPLET });
  await fakeNetwork(page, applet, { 'catalogue.test': 'holds' }, { 'blobs.test': 'has' });
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByLabel(/^Password/).fill('correct horse battery');
  await page.getByLabel('Repeat the password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create and sign in' }).click();
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('searchbox', { name: 'Find an applet' }).fill(applet.address(['wss://catalogue.test']));
  await page.getByRole('button', { name: 'Look up' }).click();
  await page.getByRole('region', { name: 'Applets window' }).getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'running');
}

const appletFrame = (page: Page) => page.frameLocator('iframe[data-window-id]');
const stopped = (page: Page) => page.locator('section.window[data-status="revoked"]');

async function proof(page: Page, name: string): Promise<void> {
  if (!proofs) return;
  await page.screenshot({ path: `${proofs}/${name}.png`, animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: `${proofs}/${name}-light.png`, animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
}

// Every socket but the one catalogue relay is refused, which each engine reports in its own words.
test.use({ colorScheme: 'dark', viewport: { width: 1280, height: 800 }, expectedConsoleError: /WebSocket|ERR_CONNECTION|NS_ERROR|can.t establish a connection/i });

test('an applet that posts to the parent window is stopped with plain words, and kehto\'s detail behind Details', async ({ page }) => {
  await runNoisyApplet(page);
  await appletFrame(page).getByRole('button', { name: 'Post to the parent' }).click();

  const window = stopped(page);
  await expect(window).toBeVisible();
  await expect(window.getByTestId('stop-words')).toHaveText('It sent a message outside its channel.');
  await expect(window.getByText('window-message')).toBeHidden();
  await expect(page.locator('iframe[data-window-id]')).toHaveCount(0);
  await expect(page.getByText('Feed applet was stopped')).toBeVisible();
  await proof(page, '01-window-message');

  await window.getByText('Details').click();
  await expect(window.locator('dd')).toContainText([
    'The applet',
    'Open it again. If it repeats, the applet has a bug.',
    'window-message',
    'A window-level message other than the single napplet.hello arrived from the frame',
  ]);
  await proof(page, '02-window-message-details');
});

test('an applet that floods the shell is stopped with the limit it crossed', async ({ page }) => {
  await runNoisyApplet(page);
  await appletFrame(page).getByRole('button', { name: 'Flood storage' }).click();

  const window = stopped(page);
  await expect(window.getByTestId('stop-words')).toHaveText('It sent too many messages.');
  await window.getByText('Details').click();
  await expect(window.locator('dd')).toContainText(['The applet', '300 messages in 10 s · strict', 'Open it again, or loosen the guard profile.', 'quarantine']);
  await proof(page, '03-quarantine-details');
});
