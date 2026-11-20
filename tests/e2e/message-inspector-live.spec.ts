import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { fakeNetwork, signApplet } from './live-network';

/**
 * The live shell, the real core and kehto's bridge, against a network that exists only in this
 * browser. Each applet window's Inspect button opens what it sent and got back; a failed reply is
 * an error, what the guard held back is a warning, and the button counts them (D-058).
 */

const proofs = process.env.KERNL_PROOFS_DIR;
const MISSING = 'https://files.test/missing.txt';
const BIG = 'https://files.test/big.txt';

/** An applet that stores a value, fetches a file that is not there, and sends a burst the guard holds back. */
const CHATTY_APPLET = `<!doctype html><html><head><meta charset="utf-8"><title>Chatty</title></head><body><h1>Chatty</h1>
<button id="store" type="button">Store a value</button>
<button id="fetch" type="button">Fetch a missing file</button>
<button id="burst" type="button">Send a burst</button>
<button id="big" type="button">Fetch a big file</button>
<p id="out">idle</p>
<script>
const out = document.getElementById('out');
document.getElementById('store').addEventListener('click', async () => {
  await window.napplet.storage.setItem('greeting', 'hello');
  out.textContent = 'stored';
});
document.getElementById('fetch').addEventListener('click', async () => {
  try {
    await window.napplet.resource.bytes(${JSON.stringify(MISSING)});
    out.textContent = 'fetched';
  } catch (error) {
    out.textContent = 'fetch failed';
  }
});
document.getElementById('big').addEventListener('click', async () => {
  const blob = await window.napplet.resource.bytes(${JSON.stringify(BIG)});
  out.textContent = 'big ' + blob.size;
});
document.getElementById('burst').addEventListener('click', () => {
  for (let i = 0; i < 12; i += 1) window.napplet.storage.getItem('greeting').catch(() => undefined);
  out.textContent = 'burst sent';
});
</script></body></html>`;

async function runChattyApplet(page: Page): Promise<void> {
  const applet = signApplet({ servers: ['https://blobs.test/'], requires: [], optional: ['resource'], html: CHATTY_APPLET });
  await fakeNetwork(page, applet, { 'catalogue.test': 'holds' }, { 'blobs.test': 'has' });
  await page.route(MISSING, (route) => route.abort('connectionrefused'));
  await page.route(BIG, (route) => route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: 'x'.repeat(100_000) }));
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByLabel(/^Password/).fill('correct horse battery');
  await page.getByLabel('Repeat the password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create and sign in' }).click();
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('searchbox', { name: 'Find an applet' }).fill(applet.address(['wss://catalogue.test']));
  await page.getByRole('button', { name: 'Look up' }).click();
  const store = page.getByRole('region', { name: 'Applets window' });
  await store.getByRole('checkbox', { name: /web fetches/ }).check();
  await store.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'running');
}

const appletFrame = (page: Page) => page.frameLocator('iframe[data-window-id]');
const inspector = (page: Page) => page.getByRole('dialog', { name: 'Inspect Feed applet' });

async function proof(page: Page, name: string): Promise<void> {
  if (!proofs) return;
  await page.screenshot({ path: `${proofs}/${name}.png`, animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: `${proofs}/${name}-light.png`, animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
}

// Every socket but the one catalogue relay is refused, which each engine reports in its own words; the missing file's server refuses the connection.
test.use({ colorScheme: 'dark', viewport: { width: 1280, height: 800 }, expectedConsoleError: /WebSocket|ERR_CONNECTION|NS_ERROR|can.t establish a connection|ERR_CONNECTION_REFUSED|files\.test/i });

test('the inspector lists what the applet sent and got back, newest first', async ({ page }) => {
  await runChattyApplet(page);
  await appletFrame(page).getByRole('button', { name: 'Store a value' }).click();
  await expect(appletFrame(page).locator('#out')).toHaveText('stored');
  // Nothing has gone wrong: the button carries no count.
  await expect(page.getByTestId('inspect-count')).toHaveCount(0);

  await page.getByRole('button', { name: 'Inspect Feed applet' }).click();
  const log = inspector(page);
  await expect(log.locator('li code.type').first()).toHaveText('storage.set.result');
  await expect(log.locator('li code.type')).toContainText(['storage.set.result', 'storage.set', 'shell.init', 'shell.ready', 'napplet.hello']);
  await expect(log.locator('li[data-mark="error"]')).toHaveCount(0);

  const sent = log.locator('li').filter({ has: page.locator('code.type', { hasText: /^storage\.set$/ }) });
  await sent.locator('summary').click();
  await expect(sent.locator('pre')).toBeVisible();
  await expect(sent.locator('pre')).toContainText('"greeting"');
  await proof(page, '01-inspector');
});

test('a fetched file is kept as its start and its length, not every byte', async ({ page }) => {
  await runChattyApplet(page);
  await appletFrame(page).getByRole('button', { name: 'Fetch a big file' }).click();
  await expect(appletFrame(page).locator('#out')).toHaveText('big 100000');
  await page.getByRole('button', { name: 'Inspect Feed applet' }).click();
  const fetched = inspector(page).locator('li').filter({ has: page.locator('code.type', { hasText: /^resource\.bytes\.result$/ }) });
  await fetched.locator('summary').click();
  await expect(fetched.locator('pre')).toContainText(/"blob": "[A-Za-z0-9+/]{64}… \(\d+ characters\)"/);
  await page.keyboard.press('Escape');

  // At 720 wide or less every window fills the desktop; the title bar keeps Inspect.
  await page.setViewportSize({ width: 700, height: 800 });
  await expect(page.getByRole('button', { name: 'Inspect Feed applet' })).toBeVisible();
  await proof(page, '04-narrow');
});

test('a failed reply is an error and a held-back burst is a warning, counted on the button', async ({ page }) => {
  await runChattyApplet(page);
  await appletFrame(page).getByRole('button', { name: 'Fetch a missing file' }).click();
  await expect(appletFrame(page).locator('#out')).toHaveText('fetch failed');
  await appletFrame(page).getByRole('button', { name: 'Send a burst' }).click();
  await expect(appletFrame(page).locator('#out')).toHaveText('burst sent');

  const button = page.getByRole('button', { name: /^Inspect Feed applet, 1 error · \d+ warnings?$/ });
  await expect(button).toBeVisible();
  await proof(page, '02-inspect-count');

  await button.click();
  const log = inspector(page);
  await expect(log.getByTestId('traffic-summary')).toContainText('1 error');
  const failed = log.locator('li[data-mark="error"]');
  await expect(failed).toHaveCount(1);
  await expect(failed.locator('code.type')).toHaveText('resource.bytes.error');
  await expect(log.locator('li[data-mark="warning"]').first()).toContainText('a burst of messages');

  await log.getByLabel('Problems only').check();
  await expect(log.locator('li[data-mark="none"]')).toHaveCount(0);
  await proof(page, '03-problems-only');
});
