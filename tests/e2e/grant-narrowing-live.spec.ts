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
  await page.getByRole('checkbox', { name: /^notifications/ }).check();
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'running');
  await page.getByRole('checkbox', { name: /^messages/ }).uncheck();
  await page.keyboard.press('Escape');
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'revoked');
  await expect(page.locator('section.window').getByText('You took back something it was using.', { exact: false })).toBeVisible();
  await expect(page.locator('iframe[data-window-id]')).toHaveCount(0);
});

test('every grant shows its contract beside its plain words (D-057)', async ({ page }) => {
  await openMessages(page);
  const panel = page.getByRole('dialog', { name: 'Grants for Messages' });
  // The name reads as it looks: the words, then the contract, then the caption under them.
  for (const [label, contract] of [['messages', 'DM'], ['network', 'RELAY'], ['web fetches', 'RESOURCE'], ['posting to your network', 'OUTBOX']] as const) {
    await expect(panel.getByRole('checkbox', { name: new RegExp(`^${label} ${contract}( |$)`) }), contract).toHaveCount(1);
  }
  const tag = panel.locator('[data-contract]', { hasText: /^RESOURCE$/ });
  await expect(tag).toBeVisible();
  // Quieter than the words beside it.
  const sizes = await tag.evaluate((element) => [parseFloat(getComputedStyle(element).fontSize), parseFloat(getComputedStyle(element.parentElement as Element).fontSize)]);
  expect(sizes[0]).toBeLessThan(sizes[1] as number);
});

test('blocking a running applet stops it', async ({ page }) => {
  await openMessages(page);
  await page.getByRole('button', { name: 'Block applet' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'revoked');
  await expect(page.locator('section.window').getByText('You blocked it.')).toBeVisible();
});

test('an applet that can read messages cannot be given anything that could send them elsewhere (D-046)', async ({ page }) => {
  await openMessages(page);
  const panel = page.getByRole('dialog', { name: 'Grants for Messages' });
  await expect(panel.getByRole('note')).toContainText('it gets nothing that could send them anywhere else');
  for (const label of [/^network/, /^posting to your network/, /^uploads/, /^direct connections/, /^web fetches/, /^remote tools/, /^talking to other applets/, /^opening links/]) {
    const row = panel.getByRole('checkbox', { name: label });
    await expect(row, String(label)).toBeDisabled();
    await expect(row, String(label)).not.toBeChecked();
  }
  await expect(panel.getByText('off while it can read your messages').first()).toBeVisible();
  await expect(panel.getByRole('checkbox', { name: /^notifications/ })).toBeEnabled();
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'running');
});
