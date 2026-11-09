import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';

async function openStore(page: Page): Promise<void> {
  await page.goto(`${base}/app/?preview=1`);
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await expect(page.getByRole('list', { name: 'Applets' }).getByRole('listitem')).toHaveCount(3);
}

test('the store searches loosely, filters by topic and still opens a pasted address', async ({ page }) => {
  await openStore(page);
  const results = page.getByRole('list', { name: 'Applets' }).getByRole('listitem');

  await page.getByRole('searchbox', { name: 'Find an applet' }).fill('profle');
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText('Profiles');
  await expect(results.first()).toContainText('Takes requests to open a profile.');

  await page.getByRole('searchbox', { name: 'Find an applet' }).fill('');
  const topics = page.getByRole('group', { name: 'Topics' });
  await topics.getByRole('button', { name: /^social/ }).click();
  await expect(topics.getByRole('button', { name: /^social/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(results).toHaveCount(3);
  await topics.getByRole('button', { name: /^people/ }).click();
  await expect(results).toHaveCount(1);
  await topics.getByRole('button', { name: /^people/ }).click();
  await topics.getByRole('button', { name: /^social/ }).click();
  await expect(results).toHaveCount(3);

  await page.getByRole('searchbox', { name: 'Find an applet' }).fill('preview:pulse');
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Pulse' })).toBeVisible();
});

test('an applet asks for a profile, the user picks a handler from the store, and it receives the request', async ({ page }) => {
  await openStore(page);
  await page.getByRole('listitem').filter({ hasText: 'Notes' }).getByRole('button', { name: 'Open' }).click();
  // Opening other applets is a grant; Notes requires it, so its first run starts with it on.
  await expect(page.getByRole('checkbox', { name: /opening other applets/ })).toBeChecked();
  await page.getByRole('button', { name: 'Run' }).click();

  const notes = page.frameLocator('iframe[data-window-id]').first();
  await notes.getByRole('button', { name: 'Open a profile' }).click();

  const chooser = page.getByRole('dialog', { name: 'Choose an applet' });
  await expect(chooser).toContainText('Notes wants to open a profile.');
  await expect(chooser).toContainText('None of your applets can do this yet.');
  await chooser.getByRole('checkbox', { name: 'Always use it to open a profile' }).check();
  await chooser.getByRole('listitem').filter({ hasText: 'Profiles' }).getByRole('button', { name: 'Open' }).click();
  // A handler is offered the receiving grant, switched on, so the request can reach it.
  await expect(chooser.getByRole('checkbox', { name: /opening other applets/ })).toBeChecked();
  await chooser.getByRole('button', { name: 'Use this applet' }).click();
  await expect(chooser).toHaveCount(0);

  const profiles = page.frameLocator('iframe[data-window-id]').nth(1);
  await expect(profiles.getByRole('heading', { name: 'Profiles' })).toBeVisible();
  await expect(profiles.getByText('Notes asked this applet to open a profile.')).toBeVisible();
  await expect(notes.getByText('Profiles is taking it.')).toBeVisible();

  // The choice was remembered: asking again goes straight to the open Profiles window, no chooser.
  // Profiles now sits over Notes, so the click is dispatched to the button rather than at its position.
  await notes.getByRole('button', { name: 'Open a profile' }).dispatchEvent('click');
  await expect(profiles.getByText('Notes asked this applet to open a profile.')).toHaveCount(2);
  await expect(page.getByRole('dialog', { name: 'Choose an applet' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('tab', { name: 'Yours' }).click();
  await expect(page.getByRole('combobox', { name: 'Profiles' })).toHaveValue(/profiles$/);
});
