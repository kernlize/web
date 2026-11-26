import type { Page } from '@playwright/test';
import { nip19 } from 'nostr-tools';
import shipped from '../../applets/samples/shipped/samples.json' with { type: 'json' };
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

  // The preview's store reads the signed sample manifests; the same Pulse opens from its address.
  const pulse = shipped.samples.find((sample) => sample.name === 'pulse')!.manifest;
  const address = nip19.naddrEncode({ kind: pulse.kind, pubkey: pulse.pubkey, identifier: 'pulse' });
  await page.getByRole('searchbox', { name: 'Find an applet' }).fill(address);
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByRole('region', { name: 'Applets window' }).getByRole('heading', { name: 'Pulse' })).toBeVisible();
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
  await expect(profiles.locator('#granted')).toHaveText(/^Granted:/);
  await expect(profiles.getByText('Another applet asked this applet to open a profile for decade00….')).toBeVisible();
  await expect(notes.getByText('Profiles is taking it.')).toBeVisible();

  // The choice was remembered: asking again goes straight to the open Profiles window, no chooser.
  // Profiles now sits over Notes, so the click is dispatched to the button rather than at its position.
  await notes.getByRole('button', { name: 'Open a profile' }).dispatchEvent('click');
  await expect(profiles.getByText('Another applet asked this applet to open a profile for decade00….')).toHaveCount(2);
  await expect(page.getByRole('dialog', { name: 'Choose an applet' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('tab', { name: 'Yours' }).click();
  await expect(page.getByRole('combobox', { name: 'Profiles' })).toHaveValue(/profiles$/);
});

test('the store is a window like any other: inside the desktop, scrolled to its last applet, moved, minimised and brought back', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 520 });
  await page.goto(`${base}/app/?preview=1`);
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await page.getByRole('button', { name: 'Open an applet' }).click();
  const store = page.getByRole('region', { name: 'Applets window' });
  await expect(store.getByRole('list', { name: 'Applets' }).getByRole('listitem')).toHaveCount(3);
  const desk = (await page.locator('.desk').boundingBox())!;
  const box = (await store.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(desk.x);
  expect(box.y).toBeGreaterThanOrEqual(desk.y);
  expect(box.x + box.width).toBeLessThanOrEqual(desk.x + desk.width);
  expect(box.y + box.height).toBeLessThanOrEqual(desk.y + desk.height + 1);
  // More than fits: the window's own body scrolls, and the last applet comes into view inside it.
  const last = store.getByRole('list', { name: 'Applets' }).getByRole('listitem').last();
  await last.scrollIntoViewIfNeeded();
  const lastBox = (await last.boundingBox())!;
  expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(lastBox.x).toBeGreaterThanOrEqual(box.x);

  await store.getByRole('toolbar', { name: 'Applets window controls' }).focus();
  await page.keyboard.press('ArrowRight');
  expect((await store.boundingBox())!.x).toBeGreaterThan(box.x);

  await store.getByRole('button', { name: 'Minimise Applets' }).click();
  await expect(store).toBeHidden();
  await page.getByRole('list', { name: 'Minimised windows' }).getByRole('button', { name: 'Applets' }).click();
  await expect(store).toBeVisible();
  await store.getByRole('button', { name: 'Close Applets' }).click();
  await expect(store).toHaveCount(0);
});

test('the stacks tab lists the stacks people published and opens only the applets marked to start', async ({ page }) => {
  await page.goto(`${base}/app/?preview=1`);
  await page.getByRole('button', { name: 'Try the preview' }).click();
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('tab', { name: 'Stacks' }).click();

  const stacks = page.getByRole('list', { name: 'Stacks' }).getByRole('listitem');
  await expect(stacks).toHaveCount(2);
  await expect(stacks.first()).toContainText('Basics');
  await expect(stacks.first()).toContainText('2 applets');

  // The disclosure lists every applet with a tick; the publisher's entry point is ticked already.
  await stacks.first().getByRole('button', { name: 'Show applets' }).click();
  const listed = stacks.first().getByRole('list', { name: 'Applets in Basics' }).getByRole('listitem');
  await expect(listed).toHaveCount(2);
  await expect(listed.first().getByRole('checkbox')).toBeChecked();
  await expect(listed.last().getByRole('checkbox')).not.toBeChecked();
  await expect(stacks.first().getByRole('button', { name: 'Open 1 of the 2 in Basics, installing the rest' })).toBeVisible();

  await stacks.first().getByRole('button', { name: 'Open 1 of the 2 in Basics, installing the rest' }).click();

  // One table for the whole stack: a row per permission, each listing the applets that asked for it.
  const review = page.getByRole('article');
  await expect(review).toContainText('1 applet in Basics');
  const relay = review.getByRole('group', { name: 'Required' }).getByRole('list', { name: 'Asked for by' }).first();
  await expect(relay.getByRole('listitem')).toHaveText(['Notes needed']);
  const notify = review.getByRole('group', { name: 'Optional' }).getByRole('list', { name: 'Asked for by' }).first();
  await expect(notify.getByRole('listitem')).toHaveText(['Notes']);
  await review.getByRole('button', { name: 'Open this applet' }).click();
  await expect(page.getByRole('region', { name: 'Applets window' })).toHaveCount(0);
  await expect(page.locator('iframe[data-window-id]')).toHaveCount(1);
  await expect(page.frameLocator('iframe[title="Notes applet"]').locator('#granted')).toHaveText(/^Granted:/);
});

test('a stack reuses an equivalent window and replaces it for widened or temporarily narrowed grants', async ({ page }) => {
  await openStore(page);
  const notes = page.frameLocator('iframe[data-window-id]').getByRole('button', { name: 'Send a notification' });
  const frames = page.locator('iframe[data-window-id]');
  const run = async (notify: boolean, remember: boolean): Promise<string> => {
    await page.getByRole('tab', { name: 'Stacks' }).click();
    await page.getByRole('button', { name: 'Open 1 of the 2 in Basics, installing the rest' }).click();
    await page.getByRole('checkbox', { name: /notifications NOTIFY/i }).setChecked(notify);
    await page.getByRole('checkbox', { name: 'Remember grants' }).setChecked(remember);
    await page.getByRole('button', { name: 'Open this applet' }).click();
    await expect(page.getByRole('region', { name: 'Applets window' })).toHaveCount(0);
    await expect(frames).toHaveCount(1);
    if (notify) await expect(notes).not.toHaveAttribute('data-missing', '1');
    else await expect(notes).toHaveAttribute('data-missing', '1');
    return (await frames.getAttribute('data-window-id'))!;
  };
  const launcher = page.getByRole('button', { name: 'Open an applet' });
  const initial = await run(false, true);
  await launcher.click();
  expect(await run(false, true)).toBe(initial);
  await launcher.click();
  const widened = await run(true, true);
  expect(widened).not.toBe(initial);
  await launcher.click();
  expect(await run(false, false)).not.toBe(widened);
  await expect(page.getByRole('region', { name: 'Notes window' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Close Notes' }).click();
  await launcher.click();
  await page.getByRole('tab', { name: 'Stacks' }).click();
  await page.getByRole('button', { name: 'Open 1 of the 2 in Basics, installing the rest' }).click();
  await expect(page.getByRole('checkbox', { name: /notifications NOTIFY/i })).toBeChecked();
});
