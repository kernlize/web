import type { FrameLocator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';

test('the preview shell signs in, runs a sample applet, shows the guard and sends a message', async ({ page }) => {
  await page.goto(`${base}/app/?preview=1`);
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await expect(page.getByRole('button', { name: 'Open an applet' })).toBeVisible();

  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Notes' }).getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Notes' })).toBeVisible();

  // Your account is a grant, not baseline, in both modes; Notes requires it, so it starts switched on.
  const account = page.getByRole('checkbox', { name: /your account/ });
  await expect(account).toBeEnabled();
  await expect(account).toBeChecked();
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

async function runPulse(page: Page): Promise<FrameLocator> {
  await page.goto(`${base}/app/?preview=1`);
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Pulse' }).getByRole('button', { name: 'Open' }).click();
  await page.getByRole('checkbox', { name: /network/ }).check();
  await page.getByRole('button', { name: 'Run' }).click();
  const applet = page.frameLocator('iframe[data-window-id]');
  await expect(applet.getByRole('heading', { name: 'Pulse' })).toBeVisible();
  return applet;
}

test('the preview asks only before destructive publishes, as the live shell does, and logs a flood', async ({ page }) => {
  const applet = await runPulse(page);

  await applet.getByRole('button', { name: 'Publish a note' }).click();
  await expect(applet.locator('#log li').first()).toContainText('Publish a post: done');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await applet.getByRole('button', { name: 'Delete a note' }).click();
  const dialog = page.getByRole('dialog', { name: /^Delete/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('destructive')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Deny' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Allow' }).click();
  await expect(applet.locator('#log li').first()).toContainText('done');

  await applet.getByRole('button', { name: 'Update your profile' }).click();
  await expect(page.getByRole('dialog', { name: 'Update your profile' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Deny' }).click();
  await expect(applet.locator('#log li').first()).toContainText('you said no');

  await applet.getByRole('button', { name: 'Flood the shell' }).click();
  await expect(page.getByRole('button', { name: /^Guard/ })).not.toContainText('· 0');
  await page.getByRole('button', { name: /^Guard/ }).click();
  await expect(page.getByRole('dialog').getByText(/Applet Pulse went over/).first()).toBeVisible();
  // Observe-only: the guard reports the burst, the applet keeps running.
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'running');
});

test('preview applets have no WebRTC constructors and carry the guard CSP', async ({ page }) => {
  await runPulse(page);
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  expect(frame).toBeDefined();
  const leftovers = await frame!.evaluate(() =>
    Object.getOwnPropertyNames(window).filter((name) => /^(RTC|webkitRTC|mozRTC)/.test(name) && (window as unknown as Record<string, unknown>)[name] !== undefined),
  );
  expect(leftovers).toEqual([]);
  const policy = await frame!.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '');
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("connect-src 'none'");
  const srcdoc = (await page.locator('iframe[data-window-id]').getAttribute('srcdoc')) ?? '';
  expect(srcdoc.indexOf('Content-Security-Policy')).toBeLessThan(srcdoc.indexOf('RTC'));
  // The frame lock follows the sweep and comes before any applet script, as the live mount plan places it.
  expect(policy).toContain("require-trusted-types-for 'script'");
  expect(srcdoc.indexOf('RTC')).toBeLessThan(srcdoc.indexOf('data-kernl-frame-lock'));
  expect(srcdoc.indexOf('data-kernl-frame-lock')).toBeLessThan(srcdoc.indexOf('kernlPreview'));
});

test('a running preview applet cannot open a frame of its own', async ({ page }) => {
  await runPulse(page);
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  expect(frame).toBeDefined();
  const attempts = await frame!.evaluate(() => {
    const outcome = (attempt: () => unknown): string => {
      try {
        attempt();
        return 'created';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    return [
      outcome(() => document.createElement('iframe')),
      outcome(() => document.createElementNS('http://www.w3.org/1999/xhtml', 'iframe')),
      outcome(() => {
        document.body.insertAdjacentHTML('beforeend', '<iframe srcdoc="x"></iframe>');
      }),
    ];
  });
  expect(attempts).toEqual(['denied:nested-frame', 'denied:nested-frame', 'denied:nested-frame']);
  expect(await frame!.evaluate(() => document.querySelectorAll('iframe').length)).toBe(0);
});

test('the guard profile starts strict again after a reload', async ({ page }) => {
  await page.goto(`${base}/app/?preview=1`);
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await page.getByRole('button', { name: /^Guard/ }).click();
  await page.getByRole('radio', { name: /relaxed/ }).check();
  await expect(page.getByRole('button', { name: /^Guard/ })).toContainText('relaxed');
  await page.reload();
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await expect(page.getByRole('button', { name: /^Guard/ })).toContainText('strict');
});

test('the default window shows the whole sample applet', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const applet = await runPulse(page);
  const last = applet.getByRole('button', { name: 'Open a link' });
  const frameBox = await page.locator('iframe[data-window-id]').boundingBox();
  const buttonBox = await last.boundingBox();
  expect(frameBox && buttonBox).toBeTruthy();
  expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(frameBox!.y + frameBox!.height);
});

test('a shared download is handed to an app on the device only after the shell asks to leave', async ({ page }) => {
  const applet = await runPulse(page);
  const asked: string[] = [];
  page.on('dialog', (dialog) => {
    asked.push(`${dialog.type()}:${dialog.message()}`);
    void dialog.dismiss();
  });
  await applet.getByRole('button', { name: 'Download a shared file' }).click();
  await expect(applet.locator('#log li').first()).toContainText('Handed to an app on your device.');
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatch(/^confirm:Leave kernl and open this link\?/);
  expect(asked[0]).toContain(`magnet:?xt=urn:btih:${'ab'.repeat(20)}&dn=Sample`);
});

test('settings say downloads, sharing and mail open an app on the device', async ({ page }) => {
  await page.goto(`${base}/app/?preview=1`);
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await page.locator('details.account summary').click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Ready (opens an app on your device)')).toHaveCount(4);
});

test('an empty desktop reads as two sentences and the sign-in choices follow the preview', async ({ page }) => {
  await page.goto(`${base}/app/?preview=1`);
  await expect(page.getByRole('heading', { name: 'Sign in another way' })).toBeVisible();
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await expect(page.locator('.desktop .empty p')).toHaveText(/^No applets open\. (Press|Use)/);
});
