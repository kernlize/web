import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { fakeNetwork, generalRelays, signApplet } from './live-network';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';

/**
 * The live shell, not the preview: the real core, relay pool, blob fetcher and verifier, against
 * a network that exists only in this browser. The preview specs cannot see a failure in any of
 * those, which is how an address that every other shell opened could fail here unnoticed.
 */

async function signInFresh(page: Page): Promise<void> {
  await page.goto(`${base}/app/`);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByLabel(/^Password/).fill('correct horse battery');
  await page.getByLabel('Repeat the password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create and sign in' }).click();
  await expect(page.getByRole('button', { name: 'Open an applet' })).toBeVisible();
}

async function lookUp(page: Page, typed: string): Promise<void> {
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByLabel('Applet address').fill(typed);
  await page.getByRole('button', { name: 'Look up' }).click();
}

test.describe('with one relay and one blob server down', () => {
  // Each engine reports the refused blob server in its own words.
  test.use({ expectedConsoleError: /ERR_CONNECTION_REFUSED|down\.blobs\.test.*CORS request did not succeed/ });

  test('the live shell looks an address up, shows what it asks for and runs it', async ({ page }) => {
    const applet = signApplet({ servers: ['https://down.blobs.test', 'https://blobs.test/'] });
    const network = await fakeNetwork(page, applet, { 'catalogue.test': 'holds', 'general.test': 'empty' }, { 'down.blobs.test': 'down', 'blobs.test': 'has' });
    await signInFresh(page);

    // Pasted the way addresses are shared: inside a link, hinting a dead relay, a relay without it and one with it.
    await lookUp(page, `https://applets.example/n/${applet.address(['wss://dead.test', 'wss://general.test', 'wss://catalogue.test'])}?ref=share`);

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Feed applet' })).toBeVisible();
    expect(network.dialled).toEqual(expect.arrayContaining(['dead.test', 'general.test', 'catalogue.test']));
    expect(network.blobRequests).toEqual([`https://down.blobs.test/${applet.hash}`, `https://blobs.test/${applet.hash}`]);
    // The address field never echoes the address back (D-006).
    await expect(dialog.getByLabel('Applet address')).toHaveCount(0);

    // Required and offered: on for the account at first run, off for posting until the person says so.
    await expect(dialog.getByRole('checkbox', { name: /your account/ })).toBeChecked();
    const posting = dialog.getByRole('checkbox', { name: /posting to your network/ });
    await expect(posting).toBeEnabled();
    await expect(posting).not.toBeChecked();
    // Asked for but not offered by this shell: listed, explained, and impossible to switch on.
    const settings = dialog.getByRole('checkbox', { name: /its settings/ });
    await expect(settings).toBeDisabled();
    await expect(settings).not.toBeChecked();
    await expect(dialog.getByText('not available in this shell')).toBeVisible();

    await posting.check();
    await dialog.getByRole('button', { name: 'Run' }).click();

    const frame = page.locator('iframe[data-window-id]');
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(await frame.getAttribute('src')).toBeNull();
    await expect(page.frameLocator('iframe[data-window-id]').getByRole('heading', { name: 'Feed applet' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // A second look-up of a running applet, from the recent list, still resolves.
    await page.getByRole('button', { name: 'Open an applet' }).click();
    await page.getByRole('dialog').getByRole('listitem').filter({ hasText: 'Feed applet' }).getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('dialog').getByRole('checkbox', { name: /posting to your network/ })).toBeChecked();
  });

  test('an applet whose file no server will give is found but not opened', async ({ page }) => {
    const applet = signApplet({ servers: ['https://down.blobs.test'] });
    await fakeNetwork(page, applet, { 'catalogue.test': 'holds' }, { 'down.blobs.test': 'down' });
    await signInFresh(page);
    await lookUp(page, applet.address(['wss://catalogue.test']));
    await expect(page.getByRole('alert')).toHaveText('The applet was found, but its file could not be downloaded right now. Try again later.');
  });
});

test('a relay that never answers does not stop an applet another relay has', async ({ page }) => {
  const applet = signApplet({ servers: ['https://blobs.test'] });
  await fakeNetwork(page, applet, { 'silent.test': 'silent', 'catalogue.test': 'holds' }, { 'blobs.test': 'has' });
  await signInFresh(page);
  await lookUp(page, applet.address(['wss://silent.test', 'wss://catalogue.test']));
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Feed applet' })).toBeVisible({ timeout: 8000 });
});

test('relays that answer without the applet say there is none at that address', async ({ page }) => {
  const applet = signApplet({ servers: ['https://blobs.test'] });
  // The shell's built-in catalogue and its general relays answer too, so every relay asked has said it holds nothing.
  await fakeNetwork(page, applet, { 'general.test': 'empty', 'relay.napplet.soy': 'empty', ...generalRelays('empty') }, { 'blobs.test': 'has' });
  await signInFresh(page);
  const address = applet.address(['wss://general.test']);
  await lookUp(page, address);
  await expect(page.getByRole('alert')).toHaveText('No applet was found at that address. Check it and try again.');
  // What was typed stays in the field so it can be corrected.
  await expect(page.getByLabel('Applet address')).toHaveValue(address);
});

test('an applet its own relays do not have is found on the general relays', async ({ page }) => {
  const applet = signApplet({ servers: ['https://blobs.test'] });
  const network = await fakeNetwork(page, applet, { 'catalogue.test': 'empty', 'relay.napplet.soy': 'empty', ...generalRelays('empty'), 'nos.lol': 'holds' }, { 'blobs.test': 'has' });
  await signInFresh(page);
  await lookUp(page, applet.address(['wss://catalogue.test']));
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Feed applet' })).toBeVisible();
  // The general relays are asked only after the address's own relays came up empty.
  expect(network.dialled.indexOf('nos.lol')).toBeGreaterThan(network.dialled.indexOf('catalogue.test'));
});

test('an applet is found on the general relays when its own relays hang up', async ({ page }) => {
  test.setTimeout(45_000);
  const applet = signApplet({ servers: ['https://blobs.test'] });
  await fakeNetwork(page, applet, { ...generalRelays('down'), 'relay.primal.net': 'holds' }, { 'blobs.test': 'has' });
  await signInFresh(page);
  await lookUp(page, applet.address(['wss://dead.test', 'wss://gone.test']));
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Feed applet' })).toBeVisible({ timeout: 20_000 });
});

test('no relay reachable is said as a connection problem, never as a mystery', async ({ page }) => {
  test.setTimeout(60_000);
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  const applet = signApplet({ servers: ['https://blobs.test'] });
  await fakeNetwork(page, applet, {}, { 'blobs.test': 'has' });
  await signInFresh(page);
  await lookUp(page, applet.address(['wss://dead.test', 'wss://gone.test']));
  await expect(page.getByRole('alert')).toHaveText('None of the servers that list applets could be reached. Check your connection and try again.', { timeout: 30_000 });
  // The shell had words for this, so nothing was left in the console as unexpected.
  expect(warnings.filter((text) => text.includes('unexpected reason'))).toEqual([]);
});

test('text that is not an address is refused before anything is dialled', async ({ page }) => {
  const applet = signApplet({ servers: ['https://blobs.test'] });
  const network = await fakeNetwork(page, applet, { 'catalogue.test': 'holds' }, { 'blobs.test': 'has' });
  await signInFresh(page);
  await lookUp(page, 'https://applets.example/about');
  await expect(page.getByRole('alert')).toHaveText('That does not look like an applet address.');
  expect(network.dialled).toEqual([]);
});
