import { expect, test } from './fixtures';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';

/**
 * Applets that are published on the public network and open in other shells. Opening them here
 * depends on servers nobody in this repository runs, so this file is skipped unless
 * KERNL_PUBLIC_NETWORK=1: it is the check to run before and after publishing the site, not a
 * gate that can fail a commit because a relay was down.
 */
const PUBLISHED = [
  {
    title: 'Napplet Feed',
    address: 'naddr1qvzqqqyf8ypzqfngzhsvjggdlgeycm96x4emzjlwf8dyyzdfg4hefp89zpkdgz99qythwumn8ghj7un9d3shjtnwv9c8qmr9wsh8xmmeqy28wumn8ghj7un9d3shjtnyv9kh2uewd9hsqzrwv9cz6en9v4jq7m0q7y',
    needs: /posting to your network/,
  },
];

test.describe('applets published on the public network', () => {
  test.skip(process.env.KERNL_PUBLIC_NETWORK !== '1', 'set KERNL_PUBLIC_NETWORK=1 to dial the public network');
  // A public relay may refuse a connection; the lookup must survive that, and the browser's own complaint is not a shell error.
  test.use({ expectedConsoleError: /WebSocket connection to|Failed to load resource|ERR_|establish a connection to the server at wss:|CORS request did not succeed/ });

  for (const applet of PUBLISHED) {
    test(`${applet.title} is found, verified and runs`, async ({ page }) => {
      await page.goto(`${base}/app/`);
      await page.getByRole('button', { name: 'Create' }).click();
      await page.getByLabel(/^Password/).fill('correct horse battery');
      await page.getByLabel('Repeat the password').fill('correct horse battery');
      await page.getByRole('button', { name: 'Create and sign in' }).click();

      await page.getByRole('button', { name: 'Open an applet' }).click();
      await page.getByRole('searchbox', { name: 'Find an applet' }).fill(applet.address);
      await page.getByRole('button', { name: 'Look up' }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: applet.title })).toBeVisible({ timeout: 30_000 });
      await dialog.getByRole('checkbox', { name: applet.needs }).check();
      await dialog.getByRole('button', { name: 'Run' }).click();

      await expect(page.locator('section.window')).toHaveAttribute('data-status', 'running');
      // The applet got what it requires: it reports on its feed instead of on a missing capability.
      const body = page.frameLocator('iframe[data-window-id]').locator('body');
      await expect(body).toContainText(/contacts/, { timeout: 30_000 });
      await expect(body).not.toContainText(/Starting/, { timeout: 30_000 });
      await expect(body).not.toContainText(/Missing required|No identity connected|unavailable/i);
    });
  }
});
