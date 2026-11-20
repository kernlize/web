import type { Locator, Page } from '@playwright/test';
import { startFakeSabnzbd, type FakeSabnzbd } from '../../packages/bridges/features/steps/fake-sabnzbd';
import { expect, openSettings, test } from './fixtures';
import { fakeNetwork, generalRelays, signApplet } from './live-network';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';

test.use({ viewport: { width: 1280, height: 900 } });

/**
 * Settings holds the programs the person downloads with (D-050). The form checks an address
 * before it saves, is never handed a kept secret (D-052), and says in a line why a connection
 * cannot be used. The preview runs the real address check and asks no program; the live shell
 * asks a real one, here a downloader that answers on this machine the way SABnzbd does.
 */

async function previewPrograms(page: Page): Promise<Locator> {
  await page.goto(`${base}/app/?preview=1`);
  await page.getByRole('button', { name: 'Try the preview' }).click();
  return (await openSettings(page, 'Downloads')).getByRole('tabpanel', { name: 'Downloads' });
}

/** A program's row: its name and where things stand. Its form is inside, shown once the row is opened. */
const row = (section: Locator, program: string): Locator => section.locator(`details[data-program="${program.toLowerCase()}"]`);

async function card(section: Locator, program: string): Promise<Locator> {
  const entry = row(section, program);
  if ((await entry.getAttribute('open')) === null) await entry.locator('summary').click();
  return entry;
}

test('the five programs are listed by what they do, none set up', async ({ page }) => {
  const section = await previewPrograms(page);
  await expect(section.getByRole('heading', { name: 'Download programs' })).toBeVisible();
  for (const group of ['From peers', 'From archives', 'Shared libraries']) await expect(section.getByRole('heading', { name: group, exact: true })).toBeVisible();
  for (const program of ['Transmission', 'uTorrent', 'NZBGet', 'SABnzbd', 'slskd']) {
    await expect(row(section, program).getByText('Not set up')).toBeVisible();
    await expect(row(section, program).getByRole('form')).toBeHidden();
    await expect((await card(section, program)).getByRole('button', { name: 'Save' })).toBeDisabled();
  }
  await expect(row(section, 'SABnzbd').getByRole('textbox')).toHaveCount(2);
  await expect(row(section, 'slskd').getByRole('textbox')).toHaveCount(4);
});

test('a saved sign-in is kept, its password never shown again and never written with the settings', async ({ page }) => {
  const section = await previewPrograms(page);
  const transmission = await card(section, 'Transmission');
  await transmission.getByRole('textbox', { name: 'Address' }).fill('localhost:9091');
  await transmission.getByRole('textbox', { name: 'Name' }).fill('ann');
  await transmission.getByRole('textbox', { name: 'Password' }).fill('hunter2-secret');
  await transmission.getByRole('button', { name: 'Save' }).click();
  await expect(transmission.getByRole('status')).toHaveText('Saved.');
  await expect(transmission.getByText('Connected · preview')).toBeVisible();
  await expect(transmission.getByRole('textbox', { name: 'Address' })).toHaveValue('https://localhost:9091');
  await expect(transmission.getByRole('textbox', { name: 'Password' })).toHaveValue('');
  await expect(transmission.getByRole('textbox', { name: 'Password' })).toHaveAttribute('placeholder', 'Saved');

  const stored = await page.evaluate(() => Object.entries({ ...localStorage }));
  const settings = stored.find(([key]) => key.endsWith('kernl:download-programs:v1'));
  expect(settings?.[1]).toContain('"hasPassword":true');
  expect(settings?.[1]).not.toContain('hunter2-secret');
  expect(stored.filter(([, value]) => value.includes('hunter2-secret')).map(([key]) => key.replace(/^.*kernl:secrets/, 'kernl:secrets'))).toEqual(['kernl:secrets:v1:download:transmission:password']);

  // A second program for the same job brings the choice between them; removing one takes it away.
  const utorrent = await card(section, 'uTorrent');
  await utorrent.getByRole('textbox', { name: 'Address' }).fill('http://localhost:8080');
  await utorrent.getByRole('button', { name: 'Save' }).click();
  await expect(utorrent.getByText('On this device, so nothing leaves it.')).toBeVisible();
  const choice = section.getByRole('group', { name: 'Applets use' });
  await expect(choice.getByRole('radio', { name: 'Transmission' })).toBeChecked();
  await choice.getByRole('radio', { name: 'uTorrent' }).check();
  await utorrent.getByRole('button', { name: 'Remove uTorrent' }).click();
  await expect(choice).toHaveCount(0);
  await expect(utorrent.getByText('Not set up')).toBeVisible();
  await transmission.getByRole('button', { name: 'Remove Transmission' }).click();
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('hunter2-secret');
});

test('an address that cannot be used is refused in a line, and nothing is saved', async ({ page }) => {
  const section = await previewPrograms(page);
  const nzbget = await card(section, 'NZBGet');
  for (const [address, words] of [
    ['ftp://nas.example', 'The address must start with http:// or https://.'],
    ['http://ann:pw@nas.example:6789', 'Put the name and password in their own fields.'],
    ['http://', 'Enter an address, such as localhost:9091.'],
  ] as const) {
    await nzbget.getByRole('textbox', { name: 'Address' }).fill(address);
    await nzbget.getByRole('button', { name: 'Save' }).click();
    await expect(nzbget.getByRole('alert')).toHaveText(words);
    await expect(nzbget.getByText('Not set up')).toBeVisible();
  }
  // Loaded without encryption, a plain address on another machine is allowed, and its cost is said.
  await nzbget.getByRole('textbox', { name: 'Address' }).fill('http://nas.example:6789');
  await nzbget.getByRole('button', { name: 'Save' }).click();
  await expect(nzbget.getByText('Not encrypted: the password can be read on your network.')).toBeVisible();
});

/** The live shell, signed in with a throwaway identity, with Settings open at Downloads. */
async function livePrograms(page: Page, downloader: FakeSabnzbd): Promise<Locator> {
  // SABnzbd's API answers any origin; the stand-in is given the same header so the page may read its answers.
  await page.route(`${downloader.url}/**`, async (route) => {
    const response = await route.fetch().catch(() => undefined);
    if (!response) return route.abort('connectionrefused');
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
  });
  await fakeNetwork(page, signApplet({ servers: ['https://blobs.test'] }), generalRelays('holds'), { 'blobs.test': 'has' });
  await page.goto(`${base}/app/`);
  await page.getByRole('button', { name: 'Just look around' }).click();
  return (await openSettings(page, 'Downloads')).getByRole('tabpanel', { name: 'Downloads' });
}

test.describe('against a downloader that answers on this machine', () => {
  let downloader: FakeSabnzbd;
  test.beforeEach(async () => {
    downloader = await startFakeSabnzbd();
    downloader.apiKey = 'k-1234567890';
  });
  test.afterEach(() => downloader.close());
  // Asking a plain address over https first, a refused key and a closed port each leave the browser's own line in the console.
  test.use({ expectedConsoleError: /Failed to load resource|ERR_|NetworkError|net::/ });

  test('the live shell works out the scheme, asks the program and saves what answered', async ({ page }) => {
    const sabnzbd = await card(await livePrograms(page, downloader), 'SABnzbd');
    await sabnzbd.getByRole('textbox', { name: 'Address' }).fill(new URL(downloader.url).host);
    await sabnzbd.getByRole('textbox', { name: 'Key' }).fill('k-1234567890');
    await sabnzbd.getByRole('button', { name: 'Save' }).click();
    await expect(sabnzbd.getByRole('status')).toHaveText('Saved.', { timeout: 20_000 });
    await expect(sabnzbd.getByText('Connected · 5.1.3')).toBeVisible();
    await expect(sabnzbd.getByRole('textbox', { name: 'Address' })).toHaveValue(downloader.url.replace(/\/$/, ''));
    await expect(sabnzbd.getByText('On this device, so nothing leaves it.')).toBeVisible();
    expect(downloader.requests.length).toBeGreaterThan(0);
  });

  test('a wrong key is told apart from no answer, and neither is saved', async ({ page }) => {
    const sabnzbd = await card(await livePrograms(page, downloader), 'SABnzbd');
    await sabnzbd.getByRole('textbox', { name: 'Address' }).fill(downloader.url);
    await sabnzbd.getByRole('textbox', { name: 'Key' }).fill('not-the-key');
    await sabnzbd.getByRole('button', { name: 'Save' }).click();
    await expect(sabnzbd.getByRole('alert')).toHaveText('The program refused that sign-in.', { timeout: 20_000 });
    await expect(sabnzbd.getByText('Not set up')).toBeVisible();

    await downloader.close();
    await sabnzbd.getByRole('textbox', { name: 'Key' }).fill('k-1234567890');
    await sabnzbd.getByRole('button', { name: 'Save' }).click();
    await expect(sabnzbd.getByRole('alert')).toHaveText('No answer. Check the address, the sign-in, and that the program accepts this page.', { timeout: 20_000 });
    await expect(sabnzbd.getByText('Not set up')).toBeVisible();
  });
});
