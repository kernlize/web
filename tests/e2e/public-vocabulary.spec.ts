import { expect, test } from './fixtures';
import { expectClean } from './vocabulary';

// DECISIONS D-006: the public site and the shell never name a protocol. The build-time scan reads files;
// this reads what a person can perceive in a real browser, including text that scripts render,
// accessible names, and the values of fields the shell fills in. Addresses are not exempt: the shell
// shows servers by a display name and keeps pairing codes out of the page (QR and clipboard only).
// The live shell, with its real default servers, is walked in public-vocabulary-live.spec.ts.

for (const path of ['/', '/about/', '/about/why/', '/about/guard/', '/about/messaging/', '/about/bridges/', '/about/developers/', '/app/']) {
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
  await page.getByRole('button', { name: 'Downloads', exact: true }).first().click();
  await expectClean(page, 'downloads panel');
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

// Every wire name a domain can have. The launcher shows each one in plain words, and an unknown
// one as "another capability", never by its raw name.
const RAW_DOMAINS = new Set(['shell', 'inc', 'relay', 'outbox', 'identity', 'storage', 'cache', 'theme', 'config', 'resource', 'link', 'dm', 'notify', 'media', 'upload', 'intent', 'keys', 'fs', 'llm', 'cvm', 'count', 'lists', 'common']);

for (const sample of ['Notes', 'Pulse']) {
  test(`the launcher names ${sample}'s grants in plain words`, async ({ page }) => {
    await page.goto('/app/?preview=1');
    await page.getByRole('button', { name: 'Try the preview' }).click();
    await page.getByRole('button', { name: 'Open an applet' }).click();
    await page.getByRole('listitem').filter({ hasText: sample }).getByRole('button', { name: 'Open' }).click();
    // The store has a switch of its own; wait for the applet's summary before counting grant switches.
    await expect(page.getByRole('dialog').getByRole('heading', { name: sample })).toBeVisible();
    const switches = page.getByRole('checkbox');
    await expect(switches.first()).toBeVisible();
    const labels = await page.locator('.choices label > span:first-child').allInnerTexts();
    expect(labels.length).toBe(await switches.count());
    for (const label of labels) expect(RAW_DOMAINS.has(label.trim().toLowerCase()), `"${label}" is a raw domain name`).toBe(false);
    await expectClean(page, `${sample} summary`);
  });
}

const PLAIN_TAG = /^(person|item|address|topic|server|name|type|label)( · |$)/;

test('every consent the preview can ask for, and its exact record, names no protocol', async ({ page }) => {
  await page.goto('/app/?preview=1');
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Pulse' }).getByRole('button', { name: 'Open' }).click();
  await page.getByRole('checkbox', { name: /network/ }).check();
  await page.getByRole('button', { name: 'Run' }).click();
  const applet = page.frameLocator('iframe[data-window-id]');
  await applet.getByRole('heading', { name: 'Pulse' }).waitFor();
  await applet.locator('details').evaluateAll((all) => all.forEach((d) => d.setAttribute('open', '')));

  const cases = [
    ['Update your profile', /^Update your profile/],
    ['Delete a note', /^Delete/],
    ['Replace your contacts', /^Change who you follow/],
    ['Change your servers', /^Change your/],
    ['Ask to erase your account', /erase your account/],
  ] as const;
  for (const [button, title] of cases) {
    await applet.getByRole('button', { name: button }).click();
    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog).toBeVisible();
    await dialog.getByText('Advanced: the exact record').click();
    const rows = dialog.locator('dl.record > div');
    await expect(rows.first()).toBeVisible();
    for (const row of await rows.all()) {
      const label = await row.locator('dt').innerText();
      const value = await row.locator('dd').innerText();
      expect(label, button).not.toMatch(/\b(kind|pubkey|tags?|sig|created_at|content)\b/);
      if (/^Label \d+$/.test(label)) {
        expect(value, `${button}: ${label}`).toMatch(PLAIN_TAG);
        expect(value, `${button}: ${label}`).not.toMatch(/wss?:\/\//);
      }
    }
    await expectClean(page, `consent: ${button}`);
    await dialog.getByRole('button', { name: 'Deny' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});
