import { expect, test } from '@playwright/test';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';

test('the preview shell signs in, runs a sample applet, shows the guard and sends a message', async ({ page }) => {
  await page.goto(`${base}/app/?preview=1`);
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await expect(page.getByRole('button', { name: 'Open an applet' })).toBeVisible();

  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Notes' }).getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Notes' })).toBeVisible();

  const network = page.getByRole('checkbox', { name: /network/ });
  await expect(network).not.toBeChecked();
  await network.check();
  await page.getByRole('button', { name: 'Run' }).click();

  const frame = page.locator('iframe[data-window-id]');
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  expect(await frame.getAttribute('srcdoc')).toContain('<!doctype html>');
  expect(await frame.getAttribute('src')).toBeNull();
  await expect(page.frameLocator('iframe[data-window-id]').getByRole('heading', { name: 'Notes' })).toBeVisible();
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'running');

  await page.getByRole('button', { name: /^Guard/ }).click();
  await expect(page.getByTestId('mitigations').getByRole('listitem')).toHaveCount(11);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: /^Messages/ }).click();
  await page.getByRole('option').first().click();
  await page.getByRole('textbox', { name: 'Message' }).fill('Hello from the shell test');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.messages li.mine')).toContainText('Hello from the shell test');
  await expect(page.locator('.messages li:not(.mine)')).toHaveCount(3, { timeout: 5000 });
});

test('the preview applet asks before publishing and the guard logs a flood', async ({ page }) => {
  await page.goto(`${base}/app/?preview=1`);
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Pulse' }).getByRole('button', { name: 'Open' }).click();
  await page.getByRole('checkbox', { name: /network/ }).check();
  await page.getByRole('button', { name: 'Run' }).click();

  const applet = page.frameLocator('iframe[data-window-id]');
  await expect(applet.getByRole('heading', { name: 'Pulse' })).toBeVisible();
  await applet.getByRole('button', { name: 'Publish a note' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish a note' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Deny' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Allow' }).click();
  await expect(applet.locator('#log li').first()).toContainText('done');

  await applet.getByRole('button', { name: 'Flood the shell' }).click();
  await expect(page.getByRole('button', { name: /^Guard/ })).not.toContainText('· 0');
  await page.getByRole('button', { name: /^Guard/ }).click();
  await expect(page.getByRole('dialog').getByText(/Applet Pulse was slowed/).first()).toBeVisible();
});
