import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { fakeNetwork, generalRelays, installSignerExtension, signApplet } from './live-network';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';

/**
 * The live shell runs an applet that registers a keyboard shortcut, against a relay and a blob
 * server that exist only in this browser. The applet names no domain in its manifest and the person
 * grants it nothing: shortcuts are part of the baseline. The shell binds the key, tells the applet
 * which key it got, runs the action from the applet and from the shell's own chrome, and still
 * answers its own shortcut while the applet has focus (D-054).
 */

const SHORTCUT_APPLET = `<!doctype html><html><head><meta charset="utf-8"><title>Keys</title></head><body><h1>Keys</h1>
<p id="bound">waiting</p><p id="taken">waiting</p><p id="fired">0</p><button id="drop">Drop</button><script>
(async () => {
  const keys = window.napplet.keys;
  const show = (id, text) => { document.getElementById(id).textContent = text; };
  let fired = 0;
  keys.onAction('demo.ping', () => show('fired', String(++fired)));
  document.getElementById('drop').addEventListener('click', () => keys.unregisterAction('demo.ping'));
  try {
    const ping = await keys.registerAction({ id: 'demo.ping', label: 'Ping', defaultKey: 'Ctrl+K' });
    show('bound', 'bound ' + (ping.binding || 'nothing'));
    const launcher = await keys.registerAction({ id: 'demo.launcher', label: 'Steal the launcher', defaultKey: 'Alt+/' });
    show('taken', 'taken ' + (launcher.binding || 'nothing'));
  } catch (error) {
    show('bound', 'failed: ' + error.message);
  }
})();
</script></body></html>`;

async function open(page: Page) {
  const applet = signApplet({ servers: ['https://blobs.test'], requires: [], optional: [], html: SHORTCUT_APPLET });
  await fakeNetwork(page, applet, { 'catalogue.test': 'holds', ...generalRelays('empty') }, { 'blobs.test': 'has' });
  await installSignerExtension(page);
  await page.goto(`${base}/app/`);
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('searchbox', { name: 'Find an applet' }).fill(applet.address(['wss://catalogue.test']));
  await page.getByRole('button', { name: 'Look up' }).click();
  const dialog = page.getByRole('region', { name: 'Applets window' });
  await expect(dialog.getByRole('heading', { name: 'Feed applet' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Run' }).click();
  return page.frameLocator('iframe[data-window-id]');
}

test('an applet granted nothing gets the key it asked for, and its action runs', async ({ page }) => {
  const frame = await open(page);
  await expect(frame.locator('#bound')).toHaveText('bound Ctrl+K', { timeout: 20_000 });
  // The shell keeps its own shortcut: the applet's request for it is answered, unbound.
  await expect(frame.locator('#taken')).toHaveText('taken nothing');

  // Pressed inside the applet: the frame knows its bindings and runs the action itself.
  await frame.locator('h1').click();
  await page.keyboard.press('Control+k');
  await expect(frame.locator('#fired')).toHaveText('1');

  // Pressed on the shell's chrome while the applet's window is the focused one: the shell sends the action.
  await page.getByRole('region', { name: 'Feed applet window' }).locator('.title').click();
  await page.keyboard.press('Control+k');
  await expect(frame.locator('#fired')).toHaveText('2');

  // A dropped action no longer runs, from either side.
  await frame.locator('#drop').click();
  await frame.locator('h1').click();
  await page.keyboard.press('Control+k');
  await page.getByRole('region', { name: 'Feed applet window' }).locator('.title').click();
  await page.keyboard.press('Control+k');
  // The shell's own key still gets through, so the two presses above were heard and did nothing.
  await page.keyboard.press('Alt+/');
  await expect(page.getByRole('searchbox', { name: 'Find an applet' })).toBeVisible();
  await expect(frame.locator('#fired')).toHaveText('2');
});

test('a key held down inside an applet does not get it stopped', async ({ page }) => {
  const frame = await open(page);
  await expect(frame.locator('#bound')).toHaveText('bound Ctrl+K', { timeout: 20_000 });
  await frame.locator('h1').click();
  // Every call after the first is the key's repeat: more than the guard lets any applet send in ten seconds.
  for (let i = 0; i < 400; i += 1) await page.keyboard.down('ArrowUp');
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('Control+k');
  await expect(frame.locator('#fired')).toHaveText('1');
  await expect(page.getByRole('region', { name: 'Feed applet window' })).toHaveAttribute('data-status', 'running');
});

test("a key typed into the shell's own field is not an applet's shortcut", async ({ page }) => {
  const frame = await open(page);
  await expect(frame.locator('#bound')).toHaveText('bound Ctrl+K', { timeout: 20_000 });
  await page.getByRole('region', { name: 'Feed applet window' }).locator('.title').click();
  await page.getByRole('button', { name: /^Grants for/ }).click();
  const panel = page.getByRole('dialog', { name: /^Grants for/ });
  await panel.getByRole('checkbox').first().focus();
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await page.getByRole('region', { name: 'Feed applet window' }).locator('.title').click();
  await page.keyboard.press('Control+k');
  await expect(frame.locator('#fired')).toHaveText('1');
});

test("the shell's own shortcut works while an applet has focus", async ({ page }) => {
  const frame = await open(page);
  await expect(frame.locator('#bound')).toHaveText('bound Ctrl+K', { timeout: 20_000 });
  await frame.locator('h1').click();
  await expect(page.getByRole('searchbox', { name: 'Find an applet' })).toHaveCount(0);
  await page.keyboard.press('Alt+/');
  await expect(page.getByRole('searchbox', { name: 'Find an applet' })).toBeVisible();
});
