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
const BURST_SIZE = 12;
const STRICT_BURST_ALLOWANCE = 8;

/** An applet that stores a value, fetches a missing file, and sends a burst of storage reads. */
const CHATTY_APPLET = `<!doctype html><html><head><meta charset="utf-8"><title>Chatty</title></head><body><h1>Chatty</h1>
<button id="store" type="button">Store a value</button>
<button id="fetch" type="button">Fetch a missing file</button>
<button id="burst" type="button">Send a burst</button>
<button id="read" type="button">Read another key</button>
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
  for (let i = 0; i < ${BURST_SIZE}; i += 1) window.napplet.storage.getItem('greeting').catch(() => undefined);
  out.textContent = 'burst sent';
});
document.getElementById('read').addEventListener('click', async () => {
  await window.napplet.storage.getItem('other-key');
  out.textContent = 'read finished';
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
const trafficRow = (page: Page, type: string) => inspector(page).getByRole('listitem').filter({ has: page.locator('code.type').and(page.getByText(type, { exact: true })) });

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

  const sent = trafficRow(page, 'storage.set');
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
  const fetched = trafficRow(page, 'resource.bytes.result');
  await fetched.locator('summary').click();
  await expect(fetched.locator('pre')).toContainText(/"blob": "[A-Za-z0-9+/]{64}… \(\d+ characters\)"/);
  await page.keyboard.press('Escape');

  // At 720 wide or less every window fills the desktop; the title bar keeps Inspect.
  await page.setViewportSize({ width: 700, height: 800 });
  await expect(page.getByRole('button', { name: 'Inspect Feed applet' })).toBeVisible();
  await proof(page, '04-narrow');
});

test('a request and reply burst folds without hiding the error or guard warnings', async ({ page }) => {
  const startedAt = Date.now();
  await page.clock.setFixedTime(startedAt);
  await runChattyApplet(page);
  await appletFrame(page).getByRole('button', { name: 'Fetch a missing file' }).click();
  await expect(appletFrame(page).locator('#out')).toHaveText('fetch failed');
  const openInspect = page.getByRole('button', { name: /^Inspect Feed applet, 1 error$/ });
  await openInspect.click();
  const log = inspector(page);
  const summary = log.getByTestId('traffic-summary');
  await expect(summary).toHaveText(/^\d+ messages · 1 error$/);
  const before = Number((await summary.innerText()).split(' ')[0]);
  await log.getByRole('button', { name: 'Close Inspect Feed applet' }).click();

  // Give the strict bucket a full second to refill, then stop Date.now() advancing during the burst.
  const burstAt = startedAt + 1000;
  await page.clock.setFixedTime(burstAt);
  await appletFrame(page).getByRole('button', { name: 'Send a burst' }).click();
  await expect(appletFrame(page).locator('#out')).toHaveText('burst sent');

  const warnings = BURST_SIZE - STRICT_BURST_ALLOWANCE;
  const button = page.getByRole('button', { name: `Inspect Feed applet, 1 error · ${warnings} warnings`, exact: true });
  await button.click();
  // Storage reads are control traffic: all twelve still get replies, even past the burst allowance.
  await expect(summary).toHaveText(`${before + 2 * BURST_SIZE} messages · 1 error · ${warnings} warnings`);
  const failed = log.locator('li[data-mark="error"]');
  await expect(failed).toHaveCount(1);
  await expect(failed.locator('code.type')).toHaveText('resource.bytes.error');
  const warningRows = log.locator('li[data-mark="warning"]');
  await expect(warningRows).toHaveCount(warnings);
  await expect(warningRows.first()).toContainText('a burst of messages');

  await log.getByLabel('Problems only').check();
  await expect(log.locator('li[data-mark="none"]')).toHaveCount(0);
  await proof(page, '03-problems-only');

  await log.getByLabel('Problems only').uncheck();
  const requests = trafficRow(page, 'storage.get');
  const replies = trafficRow(page, 'storage.get.result');
  await expect(requests).toHaveCount(1);
  await expect(requests.locator('.repeats')).toHaveText(`×${BURST_SIZE}`);
  await expect(replies).toHaveCount(1);
  await expect(replies.locator('.repeats')).toHaveText(`×${BURST_SIZE}`);
  await proof(page, '05-repeats');

  await requests.locator('summary').click();
  await expect(requests.locator('pre')).toContainText('"greeting"');
  await page.clock.setFixedTime(burstAt + 1000);
  // The applet can still send messages while the inspector covers its buttons.
  await appletFrame(page).locator('#read').evaluate((button: HTMLButtonElement) => button.click());
  await expect(appletFrame(page).locator('#out')).toHaveText('read finished');
  await expect(requests.locator('.repeats')).toHaveText(`×${BURST_SIZE + 1}`);
  await expect(requests.locator('pre')).toContainText('"greeting"');
  await requests.locator('summary').click();
  await expect(requests.locator('pre')).toHaveCount(0);
  await requests.locator('summary').click();
  await expect(requests.locator('pre')).toContainText('"other-key"');

  await log.getByRole('button', { name: 'Close Inspect Feed applet' }).click();
  await proof(page, '02-inspect-count');
});
