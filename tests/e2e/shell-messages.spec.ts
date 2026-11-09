import type { FrameLocator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';
// Set to a directory to keep a picture of each step, for a pull request or the docs.
const proofs = process.env.KERNL_PROOFS_DIR;

// The shell's own default look, and room for a whole window; the light theme has its own test.
test.use({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });

async function proof(page: Page, name: string): Promise<void> {
  if (!proofs) return;
  // Let a dialog finish fading in, so the picture shows what a person sees.
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${proofs}/${name}.png` });
}

/** Sign in to the preview and press Messages: the applet the shell ships opens in a sealed frame. */
async function openMessages(page: Page): Promise<FrameLocator> {
  await page.goto(`${base}/app/?preview=1`);
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await page.getByRole('button', { name: /^Messages/ }).click();
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'running');
  return page.frameLocator('iframe[data-window-id]');
}

async function write(applet: FrameLocator, to: string, text: string): Promise<void> {
  await applet.getByRole('button', { name: to, exact: true }).click();
  const message = applet.getByRole('textbox', { name: 'Message' });
  await message.fill(text);
  await message.press('Enter');
}

/** A line in the open conversation; the list shows a preview of the same words. */
const said = (applet: FrameLocator, text: string) => applet.getByRole('log').getByText(text);

const question = (page: Page) => page.getByRole('dialog', { name: 'How should this reply travel?' });

async function openSettings(page: Page): Promise<void> {
  await page.locator('details.account summary').click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Messages', exact: true }).evaluate((heading) => heading.scrollIntoView({ block: 'start' }));
}

test('Messages opens the applet the shell ships, and a conversation is written and answered in it', async ({ page }) => {
  const applet = await openMessages(page);
  const frame = page.locator('iframe[data-window-id]');
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  expect(await frame.getAttribute('src')).toBeNull();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(applet.getByRole('button', { name: 'Grace', exact: true })).toBeVisible();
  await proof(page, '01-messages-applet');

  // Ada wrote through the provider that is first in the order, so nothing is asked.
  await write(applet, 'Ada', 'Hello Ada, from the shell test');
  await expect(said(applet, 'Hello Ada, from the shell test')).toBeVisible();
  await expect(said(applet, 'Got it. That arrived the way you sent it.')).toBeVisible({ timeout: 5000 });
  await expect(question(page)).toHaveCount(0);
  await proof(page, '02-conversation');

  // Pressing Messages again brings the same window forward; it never opens a second one.
  await page.getByRole('button', { name: /^Messages/ }).click();
  await expect(frame).toHaveCount(1);
});

test('answering someone who wrote another way asks first, and the answer can be kept or forgotten', async ({ page }) => {
  const applet = await openMessages(page);
  await write(applet, 'Grace', 'Hi Grace');

  const dialog = question(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Grace last wrote to you through Legacy messages. Your order would send this through Private messages, and Grace may not see it there.');
  // Theirs is the suggestion, and nothing is kept unless the user says so.
  await expect(dialog.getByRole('radio', { name: /Legacy messages/ })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'For this message only' })).toBeChecked();
  await proof(page, '03-reply-question');

  await dialog.getByRole('radio', { name: 'Every time I write to Grace' }).check();
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(said(applet, 'Hi Grace')).toBeVisible();
  await expect(said(applet, 'Got it. That arrived the way you sent it.')).toBeVisible({ timeout: 5000 });

  await write(applet, 'Grace', 'And again');
  await expect(said(applet, 'And again')).toBeVisible();
  await expect(dialog).toHaveCount(0);

  await openSettings(page);
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByText('You settled this for one person.')).toBeVisible();
  await settings.getByRole('button', { name: 'Forget those answers' }).click();
  await expect(settings.getByText('You settled this for one person.')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Forgotten, so it is asked again; saying no sends nothing.
  await write(applet, 'Grace', 'One more');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Do not send' }).click();
  await expect(said(applet, 'Not sent')).toBeVisible();
});

test('the order of providers is the user\'s, and the first one that is on is used first', async ({ page }) => {
  const applet = await openMessages(page);
  await openSettings(page);
  const settings = page.getByRole('dialog', { name: 'Settings' });
  const providers = settings.getByRole('list', { name: 'Providers, in your order' }).getByRole('listitem');
  await expect(providers.locator('h4')).toHaveText(['Private messages', 'Legacy messages', 'Ratchet sessions', 'Group sessions']);
  await expect(providers.nth(0)).toContainText('used first');
  await expect(settings.getByRole('button', { name: 'Move Private messages up' })).toBeDisabled();
  await proof(page, '04-settings-order');

  await settings.getByRole('button', { name: 'Move Legacy messages up' }).click();
  await expect(providers.locator('h4')).toHaveText(['Legacy messages', 'Private messages', 'Ratchet sessions', 'Group sessions']);
  await expect(providers.nth(0)).toContainText('used first');
  await expect(settings.getByRole('status').filter({ hasText: 'Legacy messages is now number 1 of 4.' })).toHaveCount(1);
  await proof(page, '05-settings-reordered');
  await page.keyboard.press('Escape');

  // Legacy is first now and it is how Grace writes, so nothing is asked.
  await write(applet, 'Grace', 'Sent your way');
  await expect(said(applet, 'Sent your way')).toBeVisible();
  await expect(question(page)).toHaveCount(0);

  // Ada writes through the provider that is now second, so the question is about her.
  await write(applet, 'Ada', 'Which way, Ada?');
  await expect(question(page)).toContainText('Ada last wrote to you through Private messages. Your order would send this through Legacy messages');
  await question(page).getByRole('button', { name: 'Do not send' }).click();

  // The order is kept across a reload.
  await page.reload();
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await openSettings(page);
  await expect(page.getByRole('dialog', { name: 'Settings' }).getByRole('list', { name: 'Providers, in your order' }).locator('h4').first()).toHaveText('Legacy messages');
});

test('a standing rule answers the question, and a provider that is switched off is not used', async ({ page }) => {
  const applet = await openMessages(page);
  await openSettings(page);
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('radio', { name: /Reply the way they wrote to me/ }).check();
  await settings.getByRole('group', { name: /When someone last wrote to you/ }).evaluate((rules) => rules.scrollIntoView({ block: 'center' }));
  await proof(page, '06-settings-reply-rule');
  await page.keyboard.press('Escape');

  await write(applet, 'Grace', 'No question this time');
  await expect(said(applet, 'No question this time')).toBeVisible();
  await expect(said(applet, 'Got it. That arrived the way you sent it.')).toBeVisible({ timeout: 5000 });
  await expect(question(page)).toHaveCount(0);

  await openSettings(page);
  await settings.getByRole('button', { name: 'Switch off Legacy messages' }).click();
  await expect(settings.getByRole('button', { name: 'Switch on Legacy messages' })).toBeVisible();
  // What cannot run here says why, and cannot be switched on.
  await expect(settings.getByRole('button', { name: 'Switch on Ratchet sessions' })).toBeDisabled();
});

test('a message that arrives while the user is elsewhere is counted on the bar until they look', async ({ page }) => {
  const applet = await openMessages(page);
  await write(applet, 'Ada', 'Back in a moment');
  // The user turns to the desktop before the answer comes.
  await page.locator('.wallpaper').click({ position: { x: 1100, y: 600 } });
  await expect(page.getByRole('button', { name: 'Messages, 1 unread' })).toBeVisible({ timeout: 5000 });
  await proof(page, '07-unread-on-the-bar');
  await page.getByRole('button', { name: 'Messages, 1 unread' }).click();
  await expect(page.getByRole('button', { name: 'Messages, 0 unread' })).toBeVisible();
});

test('the applet follows the shell\'s light theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const applet = await openMessages(page);
  await applet.getByRole('button', { name: 'Ada', exact: true }).click();
  await expect(said(applet, 'Try sending something.')).toBeVisible();
  const background = await applet.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor);
  // The window surface in the light theme, not the toolkit's dark default.
  expect(background).toBe('rgb(252, 250, 244)');
  await proof(page, '08-light-theme');
});
