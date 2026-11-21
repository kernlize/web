import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { fakeNetwork, signApplet } from './live-network';

/**
 * The live shell, the real core and kehto's bridge, against a network that exists only in this
 * browser (D-059). The launcher groups an applet's grants, switches the required ones on and fixes
 * them, puts an unsafe combination at the top for the person to allow or not, and remembers
 * grants unless the person says otherwise, a choice that itself is remembered.
 */

const proofs = process.env.KERNL_PROOFS_DIR;
const DOMAINS = ['dm', 'upload', 'relay', 'notify', 'identity'];

/** An applet that says which of its domains the shell gave it. */
const PROBE = `<!doctype html><html><head><meta charset="utf-8"><title>Probe</title></head><body><h1>Probe</h1><p id="out">starting</p><script>
document.getElementById('out').textContent = 'has ' + ${JSON.stringify(DOMAINS)}.filter((domain) => window.napplet && window.napplet[domain]).join(',');
</script></body></html>`;

async function signedIn(page: Page, requires: string[], optional: string[]): Promise<string> {
  const applet = signApplet({ servers: ['https://blobs.test/'], requires, optional, html: PROBE });
  await fakeNetwork(page, applet, { 'catalogue.test': 'holds' }, { 'blobs.test': 'has' });
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByLabel(/^Password/).fill('correct horse battery');
  await page.getByLabel('Repeat the password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create and sign in' }).click();
  return applet.address(['wss://catalogue.test']);
}

/** Open the store, look the applet up and stop at its review. */
async function review(page: Page, address: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('searchbox', { name: 'Find an applet' }).fill(address);
  await page.getByRole('button', { name: 'Look up' }).click();
  const store = page.getByRole('region', { name: 'Applets window' });
  await expect(store.locator('.grants')).toBeVisible();
  return store;
}

const group = (store: Locator, name: string): Locator => store.getByRole('group', { name });
const frame = (page: Page) => page.frameLocator('iframe[data-window-id]');

async function proof(page: Page, name: string): Promise<void> {
  if (!proofs) return;
  await page.screenshot({ path: `${proofs}/${name}-light.png`, animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: `${proofs}/${name}.png`, animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'light' });
}

// Every socket but the one catalogue relay is refused, which each engine reports in its own words.
test.use({ colorScheme: 'light', viewport: { width: 1280, height: 800 }, expectedConsoleError: /WebSocket|ERR_CONNECTION|NS_ERROR|can.t establish a connection/i });

test('required grants are on and fixed, optional ones are off and free, grouped without headings', async ({ page }) => {
  const address = await signedIn(page, ['identity', 'relay'], ['notify', 'theme']);
  const store = await review(page, address);

  const required = group(store, 'Required');
  await expect(required.getByRole('checkbox')).toHaveCount(2);
  for (const box of await required.getByRole('checkbox').all()) {
    await expect(box).toBeChecked();
    await expect(box).toBeDisabled();
  }
  const optional = group(store, 'Optional');
  const notify = optional.getByRole('checkbox', { name: /notifications/ });
  await expect(notify).not.toBeChecked();
  await expect(notify).toBeEnabled();
  await expect(group(store, 'Unsafe with messages')).toHaveCount(0);
  // Captions label the groups in the list's own flow: no heading of their own.
  await expect(store.getByRole('heading', { name: /required|optional|unsafe/i })).toHaveCount(0);
  await proof(page, '01-groups');

  await notify.check();
  await store.getByRole('button', { name: 'Run' }).click();
  await expect(frame(page).locator('#out')).toHaveText(/^has .*notify/);
  await expect(frame(page).locator('#out')).toHaveText(/identity/);
});

test('required messages with required uploads show an unsafe combination at the top, off until the person allows it', async ({ page }) => {
  const address = await signedIn(page, ['dm', 'upload', 'relay'], ['notify']);
  const store = await review(page, address);

  const unsafe = group(store, 'Unsafe with messages');
  const top = store.locator('[data-group]').first();
  await expect(top).toHaveAttribute('data-group', 'unsafe');
  await expect(unsafe.getByRole('checkbox')).toHaveCount(2);
  const uploads = unsafe.getByRole('checkbox', { name: /uploads/ });
  await expect(uploads).not.toBeChecked();
  await expect(uploads).toBeEnabled();
  // Messages are required, so on and fixed.
  const messages = group(store, 'Required').getByRole('checkbox', { name: /messages/ });
  await expect(messages).toBeChecked();
  await expect(messages).toBeDisabled();
  await proof(page, '02-unsafe-group');

  // Left alone, the applet runs without them: it can read messages and nothing can carry them away.
  await store.getByRole('button', { name: 'Run' }).click();
  await expect(frame(page).locator('#out')).toHaveText(/^has .*dm/);
  await expect(frame(page).locator('#out')).not.toHaveText(/upload|relay/);
  await page.getByRole('button', { name: 'Close Feed applet' }).click();

  // Allowing one is the person's override, for that one domain.
  const again = await review(page, address);
  await expect(group(again, 'Unsafe with messages').getByRole('checkbox', { name: /uploads/ })).not.toBeChecked();
  await group(again, 'Unsafe with messages').getByRole('checkbox', { name: /uploads/ }).check();
  await proof(page, '03-unsafe-allowed');
  await again.getByRole('button', { name: 'Run' }).click();
  await expect(frame(page).locator('#out')).toHaveText(/dm.*upload|upload.*dm/);
  await expect(frame(page).locator('#out')).not.toHaveText(/relay/);

  // The running window's grants say so, and taking the override back stops it.
  await page.getByRole('button', { name: 'Grants for Feed applet' }).click();
  const panel = page.getByRole('dialog', { name: 'Grants for Feed applet' });
  const kept = panel.getByRole('group', { name: 'Unsafe with messages' }).getByRole('checkbox', { name: /uploads/ });
  await expect(kept).toBeChecked();
  await proof(page, '04-grants-panel');
  await kept.uncheck();
  await page.keyboard.press('Escape');
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'revoked');
});

test('remember grants starts on, keeps the choice either way, and unchecked grants last only for the run', async ({ page }) => {
  const address = await signedIn(page, ['identity'], ['notify']);
  const store = await review(page, address);
  const remember = store.getByRole('checkbox', { name: 'Remember grants' });
  await expect(remember).toBeChecked();

  // Off: the grant is in force for this run, and nothing about it is kept.
  await remember.uncheck();
  await store.getByRole('checkbox', { name: /notifications/ }).check();
  await proof(page, '05-remember-off');
  await store.getByRole('button', { name: 'Run' }).click();
  await expect(frame(page).locator('#out')).toHaveText(/notify/);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('"notify"');
  await page.getByRole('button', { name: 'Close Feed applet' }).click();

  // The next review starts from what was kept, which is nothing, and the choice stayed off.
  const next = await review(page, address);
  await expect(next.getByRole('checkbox', { name: 'Remember grants' })).not.toBeChecked();
  await expect(next.getByRole('checkbox', { name: /notifications/ })).not.toBeChecked();

  // On again, and it stays on: the grant is kept, and the next review shows it.
  await next.getByRole('checkbox', { name: 'Remember grants' }).check();
  await next.getByRole('checkbox', { name: /notifications/ }).check();
  await next.getByRole('button', { name: 'Run' }).click();
  await expect(frame(page).locator('#out')).toHaveText(/notify/);
  await page.getByRole('button', { name: 'Close Feed applet' }).click();
  const last = await review(page, address);
  await expect(last.getByRole('checkbox', { name: 'Remember grants' })).toBeChecked();
  await expect(last.getByRole('checkbox', { name: /notifications/ })).toBeChecked();
});

test('a grant for now survives reloading the applet, and ends with its last window', async ({ page }) => {
  const address = await signedIn(page, ['identity'], ['notify']);
  const store = await review(page, address);
  await store.getByRole('checkbox', { name: 'Remember grants' }).uncheck();
  await store.getByRole('checkbox', { name: /notifications/ }).check();
  await store.getByRole('button', { name: 'Run' }).click();
  await expect(frame(page).locator('#out')).toHaveText(/notify/);

  // Starting again plans the new window before the old one closes; nothing is lost between them.
  const first = await page.locator('iframe[data-window-id]').getAttribute('data-window-id');
  await page.getByRole('button', { name: 'Reload Feed applet' }).click();
  await expect(page.locator('iframe[data-window-id]')).not.toHaveAttribute('data-window-id', first ?? '');
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'running');
  await expect(frame(page).locator('#out')).toHaveText(/notify/);
  await expect(page.getByText('Feed applet was stopped')).toHaveCount(0);

  await page.getByRole('button', { name: 'Close Feed applet' }).click();
  const next = await review(page, address);
  await expect(next.getByRole('checkbox', { name: /notifications/ })).not.toBeChecked();
});

test('the groups and the remember checkbox fit a phone', async ({ page }) => {
  const address = await signedIn(page, ['dm', 'upload'], ['notify']);
  await page.setViewportSize({ width: 390, height: 800 });
  const store = await review(page, address);
  await expect(group(store, 'Unsafe with messages')).toBeVisible();
  await expect(store.getByRole('checkbox', { name: 'Remember grants' })).toBeInViewport({ ratio: 1 });
  await expect(store.getByRole('button', { name: 'Run' })).toBeInViewport({ ratio: 1 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await proof(page, '06-phone');
});
