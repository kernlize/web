import { expect, test as base } from '@playwright/test';

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
