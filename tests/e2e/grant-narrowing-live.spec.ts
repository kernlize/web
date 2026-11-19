import { getPublicKey, generateSecretKey } from 'nostr-tools';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The live shell (no `?preview=1`), offline: every socket is closed at once. A running applet whose
 * grant the user narrows in the grants panel is stopped and says why (D-038); one the user grants
 * more keeps running.
 */

const ACCOUNT = getPublicKey(generateSecretKey());

async function openMessages(page: Page): Promise<void> {
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.goto('/app/');
  await page.getByRole('listitem').filter({ hasText: 'Read-only' }).getByRole('button', { name: 'Choose' }).click();
  await page.getByRole('textbox', { name: 'Identity' }).fill(ACCOUNT);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('[data-phase="desktop"]')).toBeVisible();
  await page.getByRole('button', { name: /^Messages/ }).first().click();
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'running');
  await page.getByRole('button', { name: 'Grants for Messages' }).click();
}

test('taking back a domain a running applet uses stops it, and granting one does not', async ({ page }) => {
  await openMessages(page);
  await page.getByRole('checkbox', { name: /web fetches/ }).check();
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'running');
  await page.getByRole('checkbox', { name: /^messages/ }).uncheck();
  await page.keyboard.press('Escape');
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'revoked');
  await expect(page.locator('section.window').getByText('You took back something it was using.', { exact: false })).toBeVisible();
  await expect(page.locator('iframe[data-window-id]')).toHaveCount(0);
});

test('blocking a running applet stops it', async ({ page }) => {
  await openMessages(page);
  await page.getByRole('button', { name: 'Block applet' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'revoked');
  await expect(page.locator('section.window').getByText('You blocked it.')).toBeVisible();
});
