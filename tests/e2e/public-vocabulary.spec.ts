import type { Frame, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// DECISIONS D-006: the public site and the shell never name a protocol. The build-time scan reads files;
// this reads what a person can perceive in a real browser, including text that scripts render,
// accessible names, and the values of fields the shell fills in. Addresses are not exempt: the shell
// shows servers by a display name and keeps pairing codes out of the page (QR and clipboard only).
const DENYLIST = /\b(nostr|nip-?\d+|napplets?|relays?|pubkeys?|npub\w*|nsec\w*|naddr\w*|nevent\w*|bunker)\b/i;

async function perceivable(frame: Frame | Page): Promise<string> {
  return frame.evaluate(() => {
    const attributes = ['title', 'aria-label', 'placeholder', 'alt', 'aria-description'];
    const parts = [document.title, document.body.innerText];
    for (const element of document.querySelectorAll('*')) {
      for (const name of attributes) {
        const value = element.getAttribute(name);
        if (value) parts.push(value);
      }
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) parts.push(element.value);
    }
    return parts.join('\n');
  });
}

async function expectClean(page: Page, where: string): Promise<void> {
  for (const frame of page.frames()) {
    const text = await perceivable(frame);
    const hit = DENYLIST.exec(text);
    expect(hit?.[0], `${where} (${frame === page.mainFrame() ? 'page' : 'applet frame'})`).toBeUndefined();
  }
}

for (const path of ['/', '/why/', '/guard/', '/messaging/', '/bridges/', '/developers/', '/app/']) {
  test(`${path} names no protocol`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await page.locator('details').evaluateAll((all) => all.forEach((d) => d.setAttribute('open', '')));
    await expectClean(page, path);
  });
}

test('sign-in, including remote-signer pairing, names no protocol', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/app/?preview=1');
  await expectClean(page, 'sign-in');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  const code = page.getByRole('textbox', { name: 'Pairing code from your signer app' });
  await expect(code).toBeVisible();
  await expectClean(page, 'remote signer');
  await code.fill('not a code');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expectClean(page, 'remote signer error');

  await page.getByRole('button', { name: 'Or pair from the signer' }).click();
  await expect(page.getByRole('img', { name: 'Pairing code as a QR code' })).toBeVisible();
  await expectClean(page, 'pairing code');
  await page.getByRole('button', { name: 'Copy pairing code' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied.' })).toBeVisible();
  // The code exists, but only in the clipboard and the QR, never as page text or attributes.
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.length).toBeGreaterThan(20);
  expect(await page.content()).not.toContain(copied.slice(0, 20));
  await page.getByRole('button', { name: 'Back' }).click();
});

test('every shell surface names no protocol', async ({ page }) => {
  await page.goto('/app/?preview=1');
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await expectClean(page, 'launcher');
  await page.getByRole('listitem').filter({ hasText: 'Pulse' }).getByRole('button', { name: 'Open' }).click();
  await expectClean(page, 'applet summary');
  await page.getByRole('checkbox', { name: /network/ }).check();
  await page.getByRole('button', { name: 'Run' }).click();
  await page.frameLocator('iframe[data-window-id]').getByRole('heading', { name: 'Pulse' }).waitFor();
  await expectClean(page, 'desktop with applet');

  const applet = page.frameLocator('iframe[data-window-id]');
  await applet.getByRole('button', { name: 'Delete a note' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').locator('details').evaluateAll((all) => all.forEach((d) => d.setAttribute('open', '')));
  await expectClean(page, 'consent dialog');
  await page.getByRole('dialog').getByRole('button', { name: 'Deny' }).click();

  await page.getByRole('button', { name: /^Guard/ }).first().click();
  await expectClean(page, 'guard panel');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Messages/ }).first().click();
  await expectClean(page, 'messages, new conversation');
  await page.getByRole('option').first().click();
  await expect(page.locator('.messages li').first()).toBeVisible();
  await expectClean(page, 'messages, conversation');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Grants' }).first().click();
  await expectClean(page, 'grants panel');
  await page.keyboard.press('Escape');
  await page.locator('details.account summary').click();
  await expectClean(page, 'account menu');
  await page.getByRole('button', { name: 'Settings' }).click();
  const servers = page.locator('[data-address]');
  await expect(servers.first()).toBeVisible();
  expect(await servers.count()).toBeGreaterThanOrEqual(4);
  await expect(page.getByText('damus.io', { exact: true })).toBeVisible();
  await expectClean(page, 'settings panel with servers');
  const add = page.getByRole('textbox', { name: 'Server address' }).first();
  await add.fill('relay.example.org');
  await add.press('Enter');
  await expect(page.getByText('example.org', { exact: true })).toBeVisible();
  await expectClean(page, 'settings after adding a server');
});
