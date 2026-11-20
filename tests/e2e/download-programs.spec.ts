import type { Locator, Page } from '@playwright/test';
import { startFakeSabnzbd, type FakeSabnzbd } from '../../packages/bridges/features/steps/fake-sabnzbd';
import { expect, openSettings, test } from './fixtures';
import { fakeNetwork, generalRelays, signApplet } from './live-network';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';

test.use({ viewport: { width: 1280, height: 900 } });

/**
 * Settings holds the person's connections to the programs they download with, any number of each
 * (D-050, D-053). The form checks an address before it saves, is never handed a kept secret
 * (D-052), and says in a line why a connection cannot be used. The preview runs the real address check and asks no program; the live shell
 * asks a real one, here a downloader that answers on this machine the way SABnzbd does.
 */

async function previewPrograms(page: Page): Promise<Locator> {
  await page.goto(`${base}/app/?preview=1`);
  await page.getByRole('button', { name: 'Try the preview' }).click();
  return (await openSettings(page, 'Downloads')).getByRole('tabpanel', { name: 'Downloads' });
}

interface Typed {
  readonly program?: string;
  readonly label?: string;
  readonly url: string;
  readonly username?: string;
  readonly password?: string;
  readonly apiKey?: string;
}

const GROUPS = { peers: 'Peer sharing', archives: 'News archives', sharing: 'Shared libraries' } as const;
type GroupId = keyof typeof GROUPS;

/** A saved connection's row, by its label. Its form is inside, shown once the row is opened. */
const row = (section: Locator, label: string): Locator => section.locator(`details[data-label="${label}"]`);
const rows = (section: Locator, group: GroupId): Locator => section.locator(`[data-group="${group}"] details[data-connection]`);
const field = (form: Locator, name: string): Locator => form.getByRole('textbox', { name, exact: true });

async function opened(entry: Locator): Promise<Locator> {
  if ((await entry.getAttribute('open')) === null) await entry.locator('summary').click();
  return entry;
}

/** The group's add form, opened. */
async function addForm(section: Locator, group: GroupId): Promise<Locator> {
  await opened(section.locator(`[data-group="${group}"] details.add`));
  return section.getByRole('form', { name: `Add a connection to ${GROUPS[group]}` });
}

async function fill(form: Locator, typed: Typed): Promise<void> {
  if (typed.program) await form.getByRole('combobox', { name: 'Program' }).selectOption({ label: typed.program });
  if (typed.label !== undefined) await field(form, 'Name').fill(typed.label);
  await field(form, 'Address').fill(typed.url);
  for (const [name, value] of [['Username', typed.username], ['Password', typed.password], ['Key', typed.apiKey]] as const) if (value !== undefined) await field(form, name).fill(value);
}

async function add(section: Locator, group: GroupId, typed: Typed): Promise<Locator> {
  const form = await addForm(section, group);
  await fill(form, typed);
  await form.getByRole('button', { name: 'Save' }).click();
  return form;
}

test('the three groups each offer to add a connection, and none is set up', async ({ page }) => {
  const section = await previewPrograms(page);
  await expect(section.getByRole('heading', { name: 'Connected programs' })).toBeVisible();
  for (const [group, title] of Object.entries(GROUPS) as [GroupId, string][]) {
    await expect(section.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(rows(section, group)).toHaveCount(0);
    await expect((await addForm(section, group)).getByRole('button', { name: 'Save' })).toBeDisabled();
  }
  const archives = await addForm(section, 'archives');
  await archives.getByRole('combobox', { name: 'Program' }).selectOption({ label: 'SABnzbd' });
  await expect(archives.getByRole('textbox')).toHaveCount(3);
  await expect((await addForm(section, 'sharing')).getByRole('combobox')).toHaveCount(0);
  await expect((await addForm(section, 'sharing')).getByRole('textbox')).toHaveCount(5);
  await expect(section.getByRole('radiogroup')).toHaveCount(0);
});

test('two Transmissions and a uTorrent are three rows, and kernl sends new downloads to the one chosen', async ({ page }) => {
  const section = await previewPrograms(page);
  await add(section, 'peers', { url: 'localhost:9091', username: 'ann', password: 'hunter2-secret' });
  const first = row(section, 'Transmission');
  await expect(first.getByRole('status')).toHaveText('Saved.');
  await expect(first.getByText('Connected · preview')).toBeVisible();
  const firstForm = first.getByRole('form', { name: 'Transmission' });
  await expect(field(firstForm, 'Name')).toHaveValue('Transmission');
  await expect(field(firstForm, 'Address')).toHaveValue('https://localhost:9091');
  await expect(field(firstForm, 'Password')).toHaveValue('');
  await expect(field(firstForm, 'Password')).toHaveAttribute('placeholder', 'Saved');
  await expect(section.getByRole('radiogroup')).toHaveCount(0);

  await add(section, 'peers', { url: 'http://localhost:9092' });
  await expect(row(section, 'Transmission 2').getByText('On this device, so nothing leaves it.')).toBeVisible();
  await add(section, 'peers', { program: 'uTorrent', url: 'http://localhost:8080' });
  await expect(rows(section, 'peers')).toHaveCount(3);
  await expect(row(section, 'uTorrent').locator('summary')).toContainText('Connected · preview');

  const stored = await page.evaluate(() => Object.entries({ ...localStorage }));
  const settings = stored.find(([key]) => key.endsWith('kernl:download-programs:v1'));
  expect(settings?.[1]).toContain('"hasPassword":true');
  expect(settings?.[1]).not.toContain('hunter2-secret');
  const id = await first.getAttribute('data-connection');
  expect(stored.filter(([, value]) => value.includes('hunter2-secret')).map(([key]) => key.replace(/^.*kernl:secrets/, 'kernl:secrets'))).toEqual([`kernl:secrets:v1:download:${id}:password`]);

  // A label is the person's to change; the row shows the program beside a label that is not its name.
  const second = await opened(row(section, 'Transmission 2'));
  await field(second.getByRole('form', { name: 'Transmission 2' }), 'Name').fill('Attic');
  await second.getByRole('button', { name: 'Save' }).click();
  await expect(row(section, 'Attic').locator('summary')).toContainText('Attic · Transmission');

  const choice = section.getByRole('radiogroup', { name: 'New torrents go to' });
  await expect(choice.getByRole('radio', { name: 'Transmission', exact: true })).toBeChecked();
  await choice.getByRole('radio', { name: 'Attic' }).check();
  await page.getByRole('button', { name: 'Close Settings' }).click();
  const again = (await openSettings(page, 'Downloads')).getByRole('tabpanel', { name: 'Downloads' });
  const kept = again.getByRole('radiogroup', { name: 'New torrents go to' });
  await expect(kept.getByRole('radio', { name: 'Attic' })).toBeChecked();

  // Removing the default sends new downloads to the next one; with one left there is nothing to choose.
  await (await opened(row(again, 'Attic'))).getByRole('button', { name: 'Remove Attic' }).click();
  await expect(kept.getByRole('radio', { name: 'uTorrent' })).toBeChecked();
  await (await opened(row(again, 'uTorrent'))).getByRole('button', { name: 'Remove uTorrent' }).click();
  await expect(kept).toHaveCount(0);
  await (await opened(row(again, 'Transmission'))).getByRole('button', { name: 'Remove Transmission' }).click();
  await expect(rows(again, 'peers')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('hunter2-secret');
});

test('an address that cannot be used is refused in a line, and nothing is saved', async ({ page }) => {
  const section = await previewPrograms(page);
  const form = await addForm(section, 'archives');
  for (const [address, words] of [
    ['ftp://nas.example', 'The address must start with http:// or https://.'],
    ['http://ann:pw@nas.example:6789', 'Put the name and password in their own fields.'],
    ['http://', 'Enter an address, such as localhost:9091.'],
  ] as const) {
    await add(section, 'archives', { url: address });
    await expect(form.getByRole('alert')).toHaveText(words);
    await expect(rows(section, 'archives')).toHaveCount(0);
  }
  await add(section, 'archives', { label: 'x'.repeat(60), url: 'http://nas.example:6789' });
  await expect(row(section, 'x'.repeat(60))).toHaveCount(1);
  // Loaded without encryption, a plain address on another machine is allowed, and its cost is said.
  await expect(row(section, 'x'.repeat(60)).getByText('Not encrypted: the password can be read on your network.')).toBeVisible();
});

/** The live shell, signed in with a throwaway identity, with Settings open at Downloads. */
async function livePrograms(page: Page, downloaders: readonly FakeSabnzbd[]): Promise<Locator> {
  // SABnzbd's API answers any origin; the stand-in is given the same header so the page may read its answers.
  for (const downloader of downloaders) {
    await page.route(`${downloader.url}/**`, async (route) => {
      const response = await route.fetch().catch(() => undefined);
      if (!response) return route.abort('connectionrefused');
      await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
    });
  }
  await fakeNetwork(page, signApplet({ servers: ['https://blobs.test'] }), generalRelays('holds'), { 'blobs.test': 'has' });
  await page.goto(`${base}/app/`);
  await page.getByRole('button', { name: 'Just look around' }).click();
  return (await openSettings(page, 'Downloads')).getByRole('tabpanel', { name: 'Downloads' });
}

test.describe('against downloaders that answer on this machine', () => {
  let downloader: FakeSabnzbd;
  let other: FakeSabnzbd;
  test.beforeEach(async () => {
    [downloader, other] = await Promise.all([startFakeSabnzbd(), startFakeSabnzbd()]);
    downloader.apiKey = 'k-1234567890';
    other.apiKey = 'k-0987654321';
  });
  test.afterEach(() => Promise.all([downloader.close(), other.close()]));
  // Asking a plain address over https first, a refused key and a closed port each leave the browser's own line in the console.
  test.use({ expectedConsoleError: /Failed to load resource|ERR_|NetworkError|net::/ });

  test('the live shell works out the scheme, asks the program and saves what answered', async ({ page }) => {
    const section = await livePrograms(page, [downloader]);
    await add(section, 'archives', { program: 'SABnzbd', url: new URL(downloader.url).host, apiKey: 'k-1234567890' });
    const sabnzbd = row(section, 'SABnzbd');
    await expect(sabnzbd.getByRole('status')).toHaveText('Saved.', { timeout: 20_000 });
    await expect(sabnzbd.getByText('Connected · 5.1.3')).toBeVisible();
    await expect(field(sabnzbd, 'Address')).toHaveValue(downloader.url.replace(/\/$/, ''));
    await expect(sabnzbd.getByText('On this device, so nothing leaves it.')).toBeVisible();
    expect(downloader.requests.length).toBeGreaterThan(0);
  });

  test('two SABnzbd servers are two connections, each asked and each connected', async ({ page }) => {
    const section = await livePrograms(page, [downloader, other]);
    await add(section, 'archives', { program: 'SABnzbd', url: downloader.url, apiKey: 'k-1234567890' });
    await expect(row(section, 'SABnzbd').getByRole('status')).toHaveText('Saved.', { timeout: 20_000 });
    await add(section, 'archives', { program: 'SABnzbd', url: other.url, apiKey: 'k-0987654321' });
    await expect(row(section, 'SABnzbd 2').getByRole('status')).toHaveText('Saved.', { timeout: 20_000 });
    for (const label of ['SABnzbd', 'SABnzbd 2']) await expect(row(section, label).locator('summary')).toContainText('Connected · 5.1.3');
    await expect(section.getByRole('radiogroup')).toHaveCount(0);
    expect([downloader.requests.length > 0, other.requests.length > 0]).toEqual([true, true]);
  });

  test('a wrong key is told apart from no answer, and neither is saved', async ({ page }) => {
    const section = await livePrograms(page, [downloader]);
    const form = await add(section, 'archives', { program: 'SABnzbd', url: downloader.url, apiKey: 'not-the-key' });
    await expect(form.getByRole('alert')).toHaveText('The program refused that sign-in.', { timeout: 20_000 });
    await expect(rows(section, 'archives')).toHaveCount(0);

    await downloader.close();
    await field(form, 'Key').fill('k-1234567890');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('alert')).toHaveText('No answer. Check the address, the sign-in, and that the program accepts this page.', { timeout: 20_000 });
    await expect(rows(section, 'archives')).toHaveCount(0);
  });
});
