import { expect, test as base } from '@playwright/test';

/**
 * Every spec imports `test` from here. A page error or a console error anywhere on the page,
 * applet frames included, fails the test that caused it: an effect loop or a thrown handler
 * must not hide behind assertions that happen to pass.
 */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console: ${message.text()}`);
      });
      await use(errors);
      expect(errors, 'page errors and console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
