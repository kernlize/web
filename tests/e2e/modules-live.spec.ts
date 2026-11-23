import { expect, test } from './fixtures';
import { fakeNetwork, signApplet } from './live-network';

/**
 * kernl.run composes the live shell from kernl's own modules (D-062). The theme module answers the
 * `theme` domain: an applet that asks for the theme is told the shell's colours over the real
 * core, kehto's bridge and a network that exists only in this browser.
 */

const THEMED_APPLET = `<!doctype html><html><head><meta charset="utf-8"><title>Themed</title></head><body><h1>Themed</h1>
<p id="out">waiting</p>
<script>
const out = document.getElementById('out');
(async () => {
  try {
    const theme = await window.napplet.theme.get();
    out.textContent = 'background ' + theme.colors.background;
  } catch (error) {
    out.textContent = 'no theme';
  }
})();
</script></body></html>`;

test.use({ colorScheme: 'dark', viewport: { width: 1280, height: 800 }, expectedConsoleError: /WebSocket|ERR_CONNECTION|NS_ERROR|can.t establish a connection/i });

test('an applet that asks for the theme is told the live shell\'s colours', async ({ page }) => {
  const applet = signApplet({ servers: ['https://blobs.test/'], requires: [], optional: ['theme'], html: THEMED_APPLET });
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
  await expect(page.frameLocator('iframe[data-window-id]').locator('#out')).toHaveText(/^background (#|rgb)/);
});

const SETTINGS_APPLET = `<!doctype html><html><head><meta charset="utf-8"><title>Tunable</title></head><body><h1>Tunable</h1>
<button id="open" type="button">Open settings</button>
<p id="out">waiting</p>
<script>
const out = document.getElementById('out');
document.getElementById('open').addEventListener('click', async () => {
  try {
    await window.napplet.config.registerSchema({ type: 'object', properties: { level: { type: 'number', title: 'Level', minimum: 1, maximum: 9 } } });
    await window.napplet.config.openSettings();
    out.textContent = 'opened';
  } catch (error) {
    out.textContent = 'no settings';
  }
});
</script></body></html>`;

test('an applet opens its settings, drawn by the live shell through the settings module', async ({ page }) => {
  const applet = signApplet({ servers: ['https://blobs.test/'], requires: ['config'], html: SETTINGS_APPLET });
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
  await page.frameLocator('iframe[data-window-id]').getByRole('button', { name: 'Open settings' }).click();
  await expect(page.getByRole('dialog', { name: /settings$/ })).toBeVisible();
  await expect(page.getByRole('dialog', { name: /settings$/ }).getByLabel('Level')).toBeVisible();
});
