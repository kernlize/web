import { expect, test as base, type Locator, type Page } from '@playwright/test';

/**
 * Every spec imports `test` from here. A page error or a console error anywhere on the page,
 * applet frames included, fails the test that caused it: an effect loop or a thrown handler
 * must not hide behind assertions that happen to pass.
 */
export const test = base.extend<{ pageErrors: string[]; expectedConsoleError: RegExp | null }>({
  // A spec that takes a server down on purpose names the browser's own complaint about it here; nothing else is excused.
  // One pattern, not a list: Playwright reads an array given to `test.use` as a value with options.
  expectedConsoleError: [null, { option: true }],
  pageErrors: [
    async ({ page, expectedConsoleError }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        if (expectedConsoleError?.test(message.text())) return;
        errors.push(`console: ${message.text()}`);
      });
      await use(errors);
      expect(errors, 'page errors and console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** The tabs of the Settings window, in the order it lists them (D-049). */
export const SETTINGS_SECTIONS = ['General', 'Servers', 'Messages', 'Connections', 'Downloads'] as const;

/**
 * Open Settings from the identity menu on the bar and, when a section is named, go to it. Settings
 * is a window, found as the "Settings window" region; it opens on the section last used, so a spec
 * that needs one names it.
 */
export async function openSettings(page: Page, section?: (typeof SETTINGS_SECTIONS)[number]): Promise<Locator> {
  await page.locator('details.account summary').click();
  await page.locator('details.account').getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('region', { name: 'Settings window' });
  if (section) await settings.getByRole('tab', { name: section }).click();
  return settings;
}
