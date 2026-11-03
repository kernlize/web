import { expect, test, type Frame, type Page } from '@playwright/test';

// DECISIONS D-006: the public site and the shell never name a protocol. The build-time scan reads files;
// this reads what a person can perceive in a real browser, including text that scripts render.
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
    }
    return parts.join('\n');
  });
}

async function expectClean(page: Page, where: string): Promise<void> {
  for (const frame of page.frames()) {
    // Addresses are user data, not copy: a server's hostname is chosen by its operator (docs/policies/public-vocabulary.md).
    const text = (await perceivable(frame)).replace(/\b(?:https?|wss?):\/\/\S+/gi, ' ');
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

test('every shell surface names no protocol', async ({ page }) => {
  await page.goto('/app/?preview=1');
  await expectClean(page, 'sign-in');
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

  for (const panel of [/^Guard/, /^Messages/]) {
    await page.getByRole('button', { name: panel }).first().click();
    await expectClean(page, `panel ${panel}`);
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'Grants' }).first().click();
  await expectClean(page, 'grants panel');
  await page.keyboard.press('Escape');
  await page.locator('details.account summary').click();
  await expectClean(page, 'account menu');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expectClean(page, 'settings panel');
});
