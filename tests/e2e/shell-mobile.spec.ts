import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';

test.use({ viewport: { width: 390, height: 844 } });

async function noHorizontalOverflow(page: Page, where: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    const wide = [...document.querySelectorAll<HTMLElement>('.shell-root *')]
      .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).position !== 'fixed')
      .filter((element) => element.closest('iframe, .shell-root .frames') === null)
      .filter((element) => element.getBoundingClientRect().right > innerWidth + 1)
      .map((element) => element.className || element.tagName);
    return { page: root.scrollWidth - innerWidth, wide: wide.slice(0, 5) };
  });
  expect(overflow.page, `${where}: page scrolls sideways`).toBeLessThanOrEqual(0);
  expect(overflow.wide, `${where}: elements past the right edge`).toEqual([]);
}

test('at 390px the shell fits the screen and every panel is reachable', async ({ page }) => {
  await page.goto(`${base}/app/?preview=1`);
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await expect(page.getByText('No applets open.')).toBeInViewport({ ratio: 1 });
  await noHorizontalOverflow(page, 'empty desktop');

  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Pulse' }).getByRole('button', { name: 'Open' }).click();
  await page.getByRole('checkbox', { name: /network/ }).check();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.frameLocator('iframe[data-window-id]').getByRole('heading', { name: 'Pulse' })).toBeVisible();
  const frame = await page.locator('iframe[data-window-id]').boundingBox();
  expect(frame?.x).toBe(0);
  expect(frame?.width).toBe(390);
  await expect(page.getByRole('button', { name: 'Close Pulse' })).toBeInViewport({ ratio: 1 });
  await noHorizontalOverflow(page, 'applet window');

  const menu = page.getByRole('button', { name: /^Menu/ });
  for (const [entry, heading] of [[/^Guard/, 'Guard'], [/^Messages/, 'Messages'], [/^Settings$/, 'Settings']] as const) {
    await menu.click();
    const item = page.getByRole('navigation', { name: 'Shell menu' }).getByRole('button', { name: entry });
    await expect(item).toBeInViewport({ ratio: 1 });
    await item.click();
    const sheet = page.getByRole('dialog', { name: heading });
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    expect(box?.width, `${heading} is a full-width sheet`).toBe(390);
    await noHorizontalOverflow(page, `${heading} sheet`);
    await sheet.getByRole('button', { name: `Close ${heading}` }).click();
  }

  await menu.click();
  await expect(page.getByRole('navigation', { name: 'Shell menu' }).getByRole('button', { name: 'Sign out' })).toBeInViewport({ ratio: 1 });
});
