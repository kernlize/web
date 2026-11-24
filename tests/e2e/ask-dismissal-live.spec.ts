import { expect, test } from './fixtures';
import { fakeNetwork, signApplet } from './live-network';

/**
 * The live shell, the real core and kehto's bridge, against a network that exists only in this
 * browser. A question an applet raised leaves the screen when the shell stops that applet: the
 * dialog's queue dismisses its window's asks with their refusal (#74).
 */

const proofs = process.env.KERNL_PROOFS_DIR;

/** An applet that asks to change the profile, then floods the shell a few seconds later, while the question is still open. */
const ASKING_APPLET = `<!doctype html><html><head><meta charset="utf-8"><title>Asker</title></head><body><h1>Asker</h1>
<button id="ask" type="button">Change the profile, then flood</button>
<script>
document.getElementById('ask').addEventListener('click', () => {
  window.napplet.relay.publish({ kind: 0, content: '{"name":"asker"}', tags: [], created_at: Math.floor(Date.now() / 1000) }).catch(() => undefined);
  setTimeout(() => {
    for (let i = 0; i < 320; i += 1) window.napplet.storage.getItem('k').catch(() => undefined);
  }, 6000);
});
</script></body></html>`;

// Every socket but the one catalogue relay is refused, which each engine reports in its own words.
test.use({ colorScheme: 'dark', viewport: { width: 1280, height: 800 }, expectedConsoleError: /WebSocket|ERR_CONNECTION|NS_ERROR|can.t establish a connection/i });

test('a question the applet raised leaves the screen when the shell stops the applet', async ({ page }) => {
  const applet = signApplet({ servers: ['https://blobs.test/'], requires: ['relay'], optional: [], html: ASKING_APPLET });
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

  await page.frameLocator('iframe[data-window-id]').getByRole('button', { name: 'Change the profile, then flood' }).click();
  const question = page.getByRole('dialog', { name: 'Update your profile' });
  await expect(question).toBeVisible({ timeout: 10_000 });
  if (proofs) await page.screenshot({ path: `${proofs}/ask-open.png`, animations: 'disabled' });

  await expect(page.locator('section.window[data-status="revoked"]')).toBeVisible({ timeout: 15_000 });
  await expect(question).toHaveCount(0);
  if (proofs) await page.screenshot({ path: `${proofs}/ask-dismissed.png`, animations: 'disabled' });
});
