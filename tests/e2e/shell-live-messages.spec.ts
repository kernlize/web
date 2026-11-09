import type { FrameLocator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { correspondent, mailbox, type Correspondent, type Mailbox } from './live-messages';
import { installSignerExtension, type SignerExtension } from './live-network';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';
const proofs = process.env.KERNL_PROOFS_DIR;

test.use({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });

/**
 * Messages in the live shell, not the preview: the real core opens the applet the shell ships from
 * its pinned bytes and binds its port through the toolkit's runtime, the real message backends read
 * and write through the real relay pool, and a signing extension does the encrypting. The relays
 * are a mailbox the test owns, and the other person's key is the test's, so what leaves the shell
 * is opened here and read.
 */

interface Scene {
  readonly account: SignerExtension;
  readonly grace: Correspondent;
  readonly mail: Mailbox;
  readonly applet: FrameLocator;
}

/** Grace wrote the older way an hour ago; the account signs in and opens Messages. */
async function graceWrote(page: Page): Promise<Scene> {
  const account = await installSignerExtension(page, { encrypts: true });
  const grace = correspondent();
  const hourAgo = Math.floor(Date.now() / 1000) - 3600;
  const mail = await mailbox(page, [await grace.write(account.pubkey, 'Do you still read these?', hourAgo)]);
  await page.goto(`${base}/app/`);
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await page.getByRole('button', { name: /^Messages/ }).click();
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'running');
  const applet = page.frameLocator('iframe[data-window-id]');
  // Nobody has a name for her here, so the conversation is listed under the start of her account id.
  await applet.getByRole('button', { name: new RegExp(grace.pubkey.slice(0, 8)) }).click();
  await expect(said(applet, 'Do you still read these?')).toBeVisible();
  return { account, grace, mail, applet };
}

async function answer(applet: FrameLocator, text: string): Promise<void> {
  const message = applet.getByRole('textbox', { name: 'Message' });
  await message.fill(text);
  await message.press('Enter');
}

const said = (applet: FrameLocator, text: string) => applet.getByRole('log').getByText(text);
const question = (page: Page) => page.getByRole('dialog', { name: 'How should this reply travel?' });
const taggedFor = (pubkey: string) => (event: { tags: string[][] }): boolean => event.tags.some((tag) => tag[0] === 'p' && tag[1] === pubkey);

test('a reply to someone who wrote the older way is offered that way, and leaves through it', async ({ page }) => {
  const { account, grace, mail, applet } = await graceWrote(page);
  // The applet came from the shell, not the network, and runs sealed like any other.
  await expect(page.locator('iframe[data-window-id]')).toHaveAttribute('sandbox', 'allow-scripts');
  expect(await page.locator('iframe[data-window-id]').getAttribute('src')).toBeNull();

  await answer(applet, 'Yes, I do.');
  const dialog = question(page);
  await expect(dialog).toContainText('last wrote to you through Legacy messages. Your order would send this through Private messages');
  await expect(dialog.getByRole('radio', { name: /Legacy messages/ })).toBeChecked();
  // Nothing has left while the question is open.
  expect(mail.published.filter((event) => event.kind === 4 || event.kind === 1059)).toEqual([]);
  if (proofs) await page.screenshot({ path: `${proofs}/09-live-reply-question.png` });
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();

  await expect.poll(() => mail.published.filter((event) => event.kind === 4).length).toBe(1);
  const sent = mail.published.find((event) => event.kind === 4);
  expect(sent?.pubkey).toBe(account.pubkey);
  expect(sent && taggedFor(grace.pubkey)(sent)).toBe(true);
  // Grace can read it with her own key, which is the whole point of answering her way.
  expect(sent && (await grace.read(sent))).toBe('Yes, I do.');
  expect(mail.published.some((event) => event.kind === 1059)).toBe(false);
  await expect(said(applet, 'Yes, I do.')).toBeVisible();
  // Opening, reading and answering stayed inside the strict guard's budget: it had nothing to report.
  await expect(page.getByRole('button', { name: /^Guard/ })).toContainText('· 0');
  if (proofs) await page.screenshot({ path: `${proofs}/10-live-reply-sent.png` });
});

test('keeping the order sends the sealed kind instead, and saying no sends nothing', async ({ page }) => {
  const { grace, mail, applet } = await graceWrote(page);

  await answer(applet, 'Not this one.');
  await question(page).getByRole('button', { name: 'Do not send' }).click();
  await expect(said(applet, 'Not sent')).toBeVisible();
  expect(mail.published.filter((event) => event.kind === 4 || event.kind === 1059)).toEqual([]);

  await answer(applet, 'Sealed, please.');
  await question(page).getByRole('radio', { name: /Private messages/ }).check();
  await question(page).getByRole('button', { name: 'Send', exact: true }).click();
  // A sealed message is wrapped once for her and once for the sender; neither says who wrote it.
  await expect.poll(() => mail.published.filter((event) => event.kind === 1059).length).toBe(2);
  expect(mail.published.filter((event) => event.kind === 1059).some(taggedFor(grace.pubkey))).toBe(true);
  expect(mail.published.some((event) => event.kind === 4)).toBe(false);
  await expect(said(applet, 'Sealed, please.')).toBeVisible();
});
