import type { Locator, Page } from '@playwright/test';
import { expect, openSettings, SETTINGS_SECTIONS, test } from './fixtures';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';

test.use({ viewport: { width: 1280, height: 800 } });

async function preview(page: Page): Promise<void> {
  await page.goto(`${base}/app/?preview=1`);
  await page.getByRole('button', { name: 'Try the preview' }).click();
}

const tab = (settings: Locator, name: string): Locator => settings.getByRole('tab', { name });
const section = (settings: Locator, name: string): Locator => settings.getByRole('tabpanel', { name });

/** Nothing drawn in the window reaches past its edges, and its body does not scroll sideways. */
async function fitsItsWindow(settings: Locator, where: string): Promise<void> {
  const past = await settings.evaluate((win) => {
    const edge = win.getBoundingClientRect();
    const content = win.querySelector<HTMLElement>('.content')!;
    const wide = [...content.querySelectorAll<HTMLElement>('*')]
      .filter((element) => element.getClientRects().length > 0)
      .filter((element) => element.getBoundingClientRect().right > edge.right + 1 || element.getBoundingClientRect().left < edge.left - 1)
      .map((element) => element.className || element.tagName);
    return { sideways: content.scrollWidth - content.clientWidth, wide: wide.slice(0, 5) };
  });
  expect(past.sideways, `${where}: the section scrolls sideways`).toBeLessThanOrEqual(0);
  expect(past.wide, `${where}: drawn past the window's edge`).toEqual([]);
}

test('Settings is a window: listed in the bar, minimised and brought back, tiled beside an applet, closed with Escape', async ({ page }) => {
  await preview(page);
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Pulse' }).getByRole('button', { name: 'Open' }).click();
  await page.getByRole('button', { name: 'Run' }).click();
  const applet = page.getByRole('region', { name: 'Pulse window' });
  await expect(applet).toHaveAttribute('data-status', 'running');

  const settings = await openSettings(page);
  await expect(settings).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Workspace')).toContainText('2 windows');
  await expect(tab(settings, 'General')).toBeFocused();
  const desk = (await page.locator('.desk').boundingBox())!;
  const floating = (await settings.boundingBox())!;
  expect(floating.y + floating.height).toBeLessThanOrEqual(desk.y + desk.height + 1);

  // Tiled, the two windows share the desktop without covering each other.
  await page.getByRole('button', { name: /^Layout:/ }).click();
  await expect(page.getByRole('button', { name: /^Layout:/ })).toHaveAccessibleName(/^Layout: tiled/);
  const left = (await applet.boundingBox())!;
  const right = (await settings.boundingBox())!;
  expect(left.x + left.width).toBeLessThanOrEqual(right.x);
  expect(Math.round(right.x + right.width)).toBe(Math.round(desk.x + desk.width));
  expect(Math.round(right.height)).toBe(Math.round(desk.height));
  await fitsItsWindow(settings, 'tiled beside an applet');

  await settings.getByRole('button', { name: 'Minimise Settings' }).click();
  await expect(settings).toBeHidden();
  await page.getByRole('list', { name: 'Minimised windows' }).getByRole('button', { name: 'Settings' }).click();
  await expect(settings).toBeVisible();

  await tab(settings, 'General').focus();
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(applet).toBeVisible();
});

test('sections switch by click and by keyboard, one showing at a time, and what was typed in one survives a look at another', async ({ page }) => {
  await preview(page);
  const settings = await openSettings(page);
  const tabs = settings.getByRole('tablist', { name: 'Settings sections' });
  await expect(tabs).toHaveAttribute('aria-orientation', 'vertical');
  await expect(tabs.getByRole('tab')).toHaveText([...SETTINGS_SECTIONS]);
  await expect(tab(settings, 'General')).toHaveAttribute('aria-selected', 'true');
  await expect(section(settings, 'General').getByRole('heading', { name: 'About' })).toBeVisible();
  await expect(settings.getByRole('tabpanel')).toHaveCount(1);

  await tab(settings, 'Servers').click();
  await expect(tab(settings, 'Servers')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(settings, 'General')).toHaveAttribute('aria-selected', 'false');
  await expect(settings.getByRole('tabpanel')).toHaveCount(1);
  for (const heading of ['Inbox and outbox', 'File servers', 'Relays the shell asks']) await expect(section(settings, 'Servers').getByRole('heading', { name: heading })).toBeVisible();
  await section(settings, 'Servers').getByRole('textbox', { name: 'Add a lookup relay' }).fill('half.typed.example');

  // Only the chosen tab is in the Tab order; the arrows along the list move between tabs and wrap.
  await tab(settings, 'Servers').focus();
  await page.keyboard.press('ArrowDown');
  await expect(tab(settings, 'Messages')).toBeFocused();
  await expect(section(settings, 'Messages').getByRole('heading', { name: 'Providers' })).toBeVisible();
  await expect(section(settings, 'Messages').getByRole('heading', { name: 'Replies' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(section(settings, 'Connections').getByRole('heading', { name: 'Meeting people and remote tools' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(section(settings, 'Downloads').getByRole('heading', { name: 'Bridges' })).toBeVisible();
  await page.keyboard.press('End');
  await expect(section(settings, 'Media').getByRole('heading', { name: 'Media' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(tab(settings, 'General')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(tab(settings, 'Media')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tab(settings, 'General')).toHaveAttribute('aria-selected', 'true');
  await expect(settings.getByRole('tab', { selected: true })).toHaveCount(1);
  await expect(tabs.locator('[tabindex="0"]')).toHaveText('General');
  // Across a list that runs down the side, the arrows are not the list's.
  await page.keyboard.press('ArrowRight');
  await expect(tab(settings, 'General')).toHaveAttribute('aria-selected', 'true');

  await tab(settings, 'Servers').click();
  await expect(section(settings, 'Servers').getByRole('textbox', { name: 'Add a lookup relay' })).toHaveValue('half.typed.example');
});

test('the chosen section is kept when the window is closed and reopened, and across a reload', async ({ page }) => {
  await preview(page);
  let settings = await openSettings(page, 'Connections');
  await settings.getByRole('button', { name: 'Close Settings' }).click();
  await expect(settings).toHaveCount(0);
  settings = await openSettings(page);
  await expect(tab(settings, 'Connections')).toHaveAttribute('aria-selected', 'true');
  await expect(section(settings, 'Connections')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('preview:kernl:settings:section:v1'))).toBe('connections');

  await page.reload();
  await page.getByRole('button', { name: 'Try the preview' }).click();
  settings = await openSettings(page);
  await expect(tab(settings, 'Connections')).toHaveAttribute('aria-selected', 'true');
});

test('another part of the shell opens Settings at the section it names', async ({ page }) => {
  await preview(page);
  // Open and on another section already: the link brings the window forward at the section it names.
  const settings = await openSettings(page, 'Messages');
  await page.getByRole('button', { name: 'Downloads', exact: true }).click();
  await page.getByRole('dialog', { name: 'Downloads' }).getByRole('button', { name: 'Change in Settings' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(tab(settings, 'Downloads')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(settings, 'Downloads')).toBeFocused();
  await expect(section(settings, 'Downloads').getByRole('radio', { name: /Download in kernl/ })).toBeChecked();

  // Closed: the same link opens it there.
  await settings.getByRole('button', { name: 'Close Settings' }).click();
  await openSettings(page, 'General');
  await settings.getByRole('button', { name: 'Close Settings' }).click();
  await page.getByRole('button', { name: 'Downloads', exact: true }).click();
  await page.getByRole('dialog', { name: 'Downloads' }).getByRole('button', { name: 'Change in Settings' }).click();
  await expect(section(settings, 'Downloads').getByRole('heading', { name: 'Bridges' })).toBeVisible();
});

test('in a narrow window the tabs become a row across the top and nothing overflows the window', async ({ page }) => {
  await preview(page);
  const settings = await openSettings(page);
  const tabs = settings.getByRole('tablist', { name: 'Settings sections' });
  await expect(tabs).toHaveAttribute('aria-orientation', 'vertical');
  const wide = (await settings.boundingBox())!;
  // The page stays wide; only the window is narrowed, by its own resize handle.
  const handle = (await settings.getByRole('button', { name: 'Resize Settings' }).boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(wide.x + 400, handle.y + handle.height / 2, { steps: 5 });
  await page.mouse.up();
  const narrow = (await settings.boundingBox())!;
  expect(narrow.width).toBeLessThan(440);
  await expect(tabs).toHaveAttribute('aria-orientation', 'horizontal');

  const first = (await tab(settings, 'General').boundingBox())!;
  const second = (await tab(settings, 'Servers').boundingBox())!;
  expect(Math.round(first.y)).toBe(Math.round(second.y));
  expect(second.x).toBeGreaterThan(first.x);
  const panel = (await section(settings, 'General').boundingBox())!;
  expect(panel.y).toBeGreaterThan(first.y + first.height - 1);

  for (const name of SETTINGS_SECTIONS) {
    await tab(settings, name).click();
    await expect(section(settings, name)).toBeVisible();
    const chosen = (await tab(settings, name).boundingBox())!;
    expect(chosen.x, `${name} tab is scrolled into the row`).toBeGreaterThanOrEqual(narrow.x - 1);
    expect(chosen.x + chosen.width, `${name} tab is scrolled into the row`).toBeLessThanOrEqual(narrow.x + narrow.width + 1);
    await fitsItsWindow(settings, `narrow, ${name}`);
  }

  // In a row the arrows across move between tabs, and the arrows down are left alone.
  await tab(settings, 'General').click();
  await page.keyboard.press('ArrowRight');
  await expect(tab(settings, 'Servers')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(tab(settings, 'Servers')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(tab(settings, 'General')).toHaveAttribute('aria-selected', 'true');
});

test('signing out closes Settings with the session', async ({ page }) => {
  await preview(page);
  const settings = await openSettings(page, 'Servers');
  await expect(settings).toBeVisible();
  await page.locator('details.account summary').click();
  await page.locator('details.account').getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await expect(page.getByText('No applets open.')).toBeVisible();
  await expect(settings).toHaveCount(0);
});
