import type { FrameLocator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';

test('the preview shell signs in, runs a sample applet, shows the guard and opens messages', async ({ page }) => {
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

  // Messages is an applet too: it opens in a second sealed frame beside the first (shell-messages.spec.ts walks it).
  await page.getByRole('button', { name: /^Messages/ }).click();
  await expect(page.locator('iframe[data-window-id]')).toHaveCount(2);
  await expect(page.frameLocator('iframe[data-window-id]').nth(1).getByRole('button', { name: 'Ada', exact: true })).toBeVisible();
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
  // kehto's locked prelude sweeps WebRTC; the insertion lock follows it and comes before any applet script, as the live mount plan places it.
  expect(policy).toContain("require-trusted-types-for 'script'; trusted-types default");
  expect(srcdoc.indexOf('data-kehto-nip5d-injection')).toBeLessThan(srcdoc.indexOf('RTC'));
  expect(srcdoc.indexOf('RTC')).toBeLessThan(srcdoc.indexOf('data-kernl-insertion-lock'));
  expect(srcdoc.indexOf('data-kernl-insertion-lock')).toBeLessThan(srcdoc.indexOf('kernlPreview'));
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
        return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
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
  // kehto's factory pins and Trusted Types policy refuse creation; kernl's insertion lock refuses connection.
  expect(attempts).toHaveLength(3);
  for (const attempt of attempts) expect(attempt).toMatch(/^TypeError: (denied:nested-frame|kehto: napplets may not create nested browsing contexts)$/);
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

async function openSample(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('listitem').filter({ hasText: name }).getByRole('button', { name: 'Open' }).click();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.frameLocator(`iframe[title="${name} applet"]`).getByRole('heading', { name })).toBeVisible();
}

async function startWithNotesAndPulse(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/app/?preview=1`);
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await openSample(page, 'Notes');
  await openSample(page, 'Pulse');
}

/** Each window's rectangle, relative to the desktop it is laid out in. */
async function windowRects(page: Page): Promise<Record<string, { x: number; y: number; w: number; h: number }>> {
  const desk = await page.locator('.desk').boundingBox();
  const rects = await page.locator('section.window:not(.hidden)').evaluateAll((all) =>
    all.map((element) => {
      const box = element.getBoundingClientRect();
      return [(element.getAttribute('aria-label') ?? '').replace(' window', ''), { x: box.x, y: box.y, w: box.width, h: box.height }] as const;
    }),
  );
  return Object.fromEntries(rects.map(([title, box]) => [title, { ...box, y: box.y - (desk?.y ?? 0) }]));
}

test('the layout control steps through every layout, and the windows follow without reloading their applets', async ({ page }) => {
  await startWithNotesAndPulse(page);
  const control = page.getByRole('button', { name: /^Layout:/ });
  const desk = await page.locator('.desk').boundingBox();
  const height = desk?.height ?? 0;
  const applets = page.frames().filter((frame) => frame.parentFrame() === page.mainFrame());
  expect(applets).toHaveLength(2);
  for (const applet of applets) await applet.evaluate(() => Object.assign(window, { sinceTheStart: true }));

  await expect(control).toHaveAccessibleName('Layout: floating. Switch to tiled');
  await expect(page.getByRole('button', { name: /^Resize / })).toHaveCount(2);
  const floating = await windowRects(page);
  expect(floating).toEqual({ Notes: { x: 40, y: 24, w: 720, h: 660 }, Pulse: { x: 72, y: 56, w: 720, h: 660 } });

  await control.click();
  await expect(control).toHaveAccessibleName('Layout: tiled. Switch to columns');
  await expect(page.getByRole('button', { name: /^Resize / })).toHaveCount(0);
  expect(await windowRects(page)).toEqual({ Notes: { x: 0, y: 0, w: 716, h: height }, Pulse: { x: 724, y: 0, w: 716, h: height } });

  await control.click();
  await expect(control).toHaveAccessibleName('Layout: columns. Switch to main and stack');
  expect(await windowRects(page)).toEqual({ Notes: { x: 0, y: 0, w: 716, h: height }, Pulse: { x: 724, y: 0, w: 716, h: height } });

  await control.click();
  await expect(control).toHaveAccessibleName('Layout: main and stack. Switch to floating');
  expect(await windowRects(page)).toEqual({ Pulse: { x: 0, y: 0, w: 859, h: height }, Notes: { x: 867, y: 0, w: 573, h: height } });
  // The window the person turns to becomes the main one.
  await page.getByRole('toolbar', { name: 'Notes window controls' }).click({ position: { x: 200, y: 10 } });
  await expect.poll(() => windowRects(page)).toEqual({ Notes: { x: 0, y: 0, w: 859, h: height }, Pulse: { x: 867, y: 0, w: 573, h: height } });

  await control.click();
  await expect(control).toHaveAccessibleName('Layout: floating. Switch to tiled');
  expect(await windowRects(page)).toEqual(floating);
  for (const applet of applets) expect(await applet.evaluate(() => 'sinceTheStart' in window)).toBe(true);
});

test('a minimised window leaves the arrangement and comes back from the dock', async ({ page }) => {
  await startWithNotesAndPulse(page);
  await page.getByRole('button', { name: /^Layout:/ }).click();
  await page.getByRole('button', { name: 'Minimise Notes' }).click();
  const width = (await page.locator('.desk').boundingBox())?.width;
  await expect.poll(async () => (await windowRects(page)).Pulse?.w).toBe(width);
  await expect(page.locator('iframe[title="Notes applet"]')).toBeHidden();
  await page.getByRole('list', { name: 'Minimised windows' }).getByRole('button', { name: 'Notes' }).click();
  await expect.poll(async () => Object.keys(await windowRects(page)).sort()).toEqual(['Notes', 'Pulse']);
  await expect(page.locator('iframe[title="Notes applet"]')).toBeVisible();
  await expect(page.locator('section.window.focused')).toHaveAccessibleName('Notes window');
});

test('the chosen layout is remembered, and a choice stored by an earlier build still reads', async ({ page }) => {
  await page.goto(`${base}/app/?preview=1`);
  await page.evaluate(() => localStorage.setItem('kernl:layout:v1', 'tiled'));
  await page.reload();
  await page.getByRole('button', { name: 'Try the preview' }).click();
  const control = page.getByRole('button', { name: /^Layout:/ });
  await expect(control).toHaveAccessibleName('Layout: tiled. Switch to columns');
  await control.click();
  await expect(control).toHaveAccessibleName('Layout: columns. Switch to main and stack');
  expect(await page.evaluate(() => localStorage.getItem('kernl:layout:v1'))).toBe('columns');
  await page.reload();
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await expect(page.getByRole('button', { name: /^Layout:/ })).toHaveAccessibleName('Layout: columns. Switch to main and stack');
});

async function openSettings(page: Page): Promise<void> {
  await page.locator('details.account summary').click();
  await page.getByRole('button', { name: 'Settings' }).click();
}

test('a shared download joins the Downloads panel, fills in and can be saved', async ({ page }) => {
  const applet = await runPulse(page);
  const asked: string[] = [];
  page.on('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.dismiss();
  });
  await applet.getByRole('button', { name: 'Download a shared file' }).click();
  await expect(applet.locator('#log li').first()).toContainText('Added to your downloads.');
  expect(asked).toHaveLength(0);

  await page.getByRole('button', { name: 'Downloads', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Downloads' });
  const job = panel.getByTestId('downloads').getByRole('listitem').filter({ hasText: 'Sample' });
  await expect(job).toHaveCount(1);
  await expect(job).toHaveAttribute('data-state', 'done', { timeout: 10_000 });
  await expect(job.locator('.status')).toHaveText(/^Finished · 64\.0 KB of 64\.0 KB$/);
  const saved = page.waitForEvent('download');
  await job.getByRole('button', { name: 'Save' }).click();
  expect((await saved).suggestedFilename()).toBe('Sample.txt');
  await job.getByRole('button', { name: 'Remove Sample' }).click();
  await expect(panel.getByText('Nothing downloading.')).toBeVisible();
});

test('a download link pasted into the panel can be paused and resumed', async ({ page }) => {
  await page.goto(`${base}/app/?preview=1`);
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await page.getByRole('button', { name: 'Downloads', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Downloads' });
  await expect(panel.getByText('Nothing downloading.')).toBeVisible();
  await panel.getByRole('textbox', { name: 'Download link' }).fill('not a link');
  await panel.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText('That is not a download link kernl can open.');
  await panel.getByRole('textbox', { name: 'Download link' }).fill(`magnet:?xt=urn:btih:${'cd'.repeat(20)}&dn=Field%20Notes`);
  await panel.getByRole('button', { name: 'Download', exact: true }).click();
  const job = panel.getByTestId('downloads').getByRole('listitem').filter({ hasText: 'Field Notes' });
  await job.getByRole('button', { name: 'Pause' }).click();
  await expect(job).toHaveAttribute('data-state', 'paused');
  await job.getByRole('button', { name: 'Resume' }).click();
  await expect(job).toHaveAttribute('data-state', 'done', { timeout: 10_000 });
});

test('choosing an app on the device hands a shared download off only after the shell asks to leave', async ({ page }) => {
  const applet = await runPulse(page);
  await openSettings(page);
  await page.getByRole('radio', { name: /Open in an app on your device/ }).check();
  await expect(page.getByText('Ready (opens an app on your device)')).toHaveCount(4);
  await page.keyboard.press('Escape');
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

  await page.reload();
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await openSettings(page);
  await expect(page.getByRole('radio', { name: /Open in an app on your device/ })).toBeChecked();
});

test('settings say downloads from peers happen in kernl, and sharing and mail open an app on the device', async ({ page }) => {
  await page.goto(`${base}/app/?preview=1`);
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await openSettings(page);
  await expect(page.getByRole('radio', { name: /Download in kernl/ })).toBeChecked();
  await expect(page.getByText('Ready (opens an app on your device)')).toHaveCount(3);
});

test('an empty desktop reads as two sentences and the sign-in choices follow the preview', async ({ page }) => {
  await page.goto(`${base}/app/?preview=1`);
  await expect(page.getByRole('heading', { name: 'Sign in another way' })).toBeVisible();
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await expect(page.locator('.desktop .empty p')).toHaveText(/^No applets open\. (Press|Use)/);
});

test('settings show a new account suggested inbox and outbox servers, and say how many took the published list', async ({ page }) => {
  await page.goto(`${base}/app/?preview=1`);
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await openSettings(page);
  await expect(page.getByRole('heading', { name: 'Inbox and outbox' })).toBeVisible();
  await expect(page.getByText('This account has not said where it can be reached yet.')).toBeVisible();
  const inbox = page.getByRole('list', { name: 'Inbox servers' });
  await expect(inbox.getByRole('listitem')).toHaveCount(3);
  await inbox.getByRole('button', { name: 'Remove nos.lol from Inbox' }).click();
  await expect(inbox.getByRole('listitem')).toHaveCount(2);
  // A removed server comes back as a suggestion, and a typed address completes from monitored servers.
  await page.getByRole('group', { name: 'Suggested for Inbox' }).getByRole('button', { name: 'Add nos.lol to Inbox' }).click();
  await expect(inbox.getByRole('listitem')).toHaveCount(3);
  const field = page.getByRole('combobox', { name: 'Add an inbox server' });
  await field.fill('inbox.example.org');
  await field.press('Enter');
  await expect(inbox.getByText('inbox.example.org', { exact: true })).toBeVisible();
  await field.fill('not a server');
  await field.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Enter a server address such as nos.lol.');
  await page.getByRole('button', { name: 'Publish this list' }).click();
  await expect(page.getByText('Saved to all 4 servers')).toBeVisible();
  await expect(page.getByText('This account has not said where it can be reached yet.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Publish this list' })).toBeDisabled();
  // The shell's own lists say what each is for, and the outbox is no longer a separate local list.
  await expect(page.getByRole('heading', { name: 'People lookup' })).toBeVisible();
  await expect(page.getByText('Your connections')).toHaveCount(0);
});

test('a relay list change asks in terms of inbox and outbox', async ({ page }) => {
  const applet = await runPulse(page);
  await applet.locator('details').evaluateAll((all) => all.forEach((d) => d.setAttribute('open', '')));
  await applet.getByRole('button', { name: 'Change your inbox and outbox' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Change your inbox and outbox' })).toBeVisible();
  await expect(dialog.getByText('Inbox added')).toBeVisible();
  await expect(dialog.getByText('Outbox added')).toBeVisible();
  await expect(dialog.getByText('(write)')).toHaveCount(0);
});

test('settings show where uploads go, and the list can be changed and published', async ({ page }) => {
  await page.goto(`${base}/app/?preview=1`);
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await openSettings(page);
  const section = page.getByRole('region', { name: 'File servers' });
  await expect(section.getByText('This account has not chosen file servers yet')).toBeVisible();
  const list = section.getByRole('list', { name: 'File servers' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list.getByText('blossom.primal.net (first)')).toBeVisible();
  // A server whose name says the protocol's name is called by the list's own (D-006).
  await section.getByRole('button', { name: 'Remove File server 2 from file servers' }).click();
  const field = section.getByRole('textbox', { name: 'Add a file server' });
  await field.fill('not a server');
  await field.press('Enter');
  await expect(section.getByRole('alert')).toHaveText('Enter a file server address such as blossom.primal.net.');
  await field.fill('files.example.org');
  await field.press('Enter');
  await expect(list.getByText('files.example.org')).toBeVisible();
  await section.getByRole('button', { name: 'Publish file servers' }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Saved to' })).toBeVisible();
  await expect(section.getByText('This account has not chosen file servers yet')).toHaveCount(0);
});

test('an applet opens its settings, the shell draws the form from its schema and the applet hears the saved values', async ({ page }) => {
  await page.goto(`${base}/app/?preview=1`);
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Notes' }).getByRole('button', { name: 'Open' }).click();
  await page.getByRole('checkbox', { name: /its settings/ }).check();
  await page.getByRole('button', { name: 'Run' }).click();
  const applet = page.frameLocator('iframe[data-window-id]');
  await expect(applet.getByRole('heading', { name: 'Notes' })).toBeVisible();

  await applet.getByRole('button', { name: 'Open its settings' }).click();
  const form = page.getByRole('dialog', { name: 'Notes settings' });
  await expect(form).toBeVisible();
  await expect(applet.locator('#log li').first()).toContainText('size 15');
  await expect(form.getByRole('heading', { name: 'Look' })).toBeVisible();
  await expect(form.getByRole('heading', { name: 'Sync' })).toBeVisible();
  await expect(form.getByLabel(/Sync token/)).toHaveAttribute('type', 'password');

  await form.getByLabel(/Text size/).fill('30');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByRole('alert')).toHaveText('Text size is at most 24.');

  await form.getByLabel(/Text size/).fill('20');
  await form.getByLabel(/Colour tone/).selectOption('bright');
  await form.getByLabel(/Compact list/).check();
  await form.getByLabel(/Sync token/).fill('t0ken');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  const saved = applet.locator('#log li').first();
  await expect(saved).toContainText('size 20');
  await expect(saved).toContainText('tone "bright"');
  await expect(saved).toContainText('compact true');
  await expect(saved).toContainText('token set');
  await expect(saved).not.toContainText('t0ken');

  // Opened again, the form starts from what was saved and never puts the secret back on screen.
  await applet.getByRole('button', { name: 'Open its settings' }).click();
  await expect(form.getByLabel(/Text size/)).toHaveValue('20');
  await expect(form.getByLabel(/Sync token/)).toHaveValue('');
  await expect(form.getByLabel(/Sync token/)).toHaveAttribute('placeholder', /leave empty to keep it/);
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
});
