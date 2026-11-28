import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { fakeNetwork, signApplet } from './live-network';

const statsHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Routstr Stats</title></head><body><p id="out"></p><script>
  setTimeout(() => document.querySelector('#out').textContent = [!!window.napplet.outbox, !!window.napplet.link].join(','), 150);
</script></body></html>`;

async function start(page: Page, permissions = true) {
  const target = signApplet({ title: 'Routstr Stats', servers: ['https://blobs.test/'], requires: permissions ? ['outbox'] : [], optional: permissions ? ['link'] : [], html: statsHtml });
  const address = `nostr:${target.address(['wss://target.test'])}`;
  const sourceHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Toy Rocket</title></head><body><button id="go">Stats</button><p id="out"></p><script>
    document.querySelector('#go').onclick = async () => {
      document.querySelector('#out').textContent = 'asking';
      const result = await window.napplet.link.open(${JSON.stringify(address)}, { label: 'Pretend Publisher' });
      document.querySelector('#out').textContent = result.status;
    };
  </script></body></html>`;
  const source = signApplet({ title: 'Toy Rocket', servers: ['https://blobs.test/'], requires: ['link'], optional: [], html: sourceHtml });
  const network = await fakeNetwork(page, [source, target], { 'catalogue.test': 'holds', 'target.test': 'holds' }, { 'blobs.test': 'has' });
  await page.goto(`/app/?open=${source.address(['wss://catalogue.test'])}`);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByLabel(/^Password/).fill('correct horse battery');
  await page.getByLabel('Repeat the password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create and sign in' }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const frame = page.frameLocator('iframe[data-window-id]').first();
  return { frame, network, target, question: page.getByRole('dialog').filter({ hasText: 'Look up a linked applet' }), review: page.getByRole('dialog', { name: 'Open an applet link' }) };
}

async function targetRecords(page: Page, publisher: string, hash: string) {
  return page.evaluate(({ publisher, hash }) => ({
    installed: localStorage.getItem('kernl:installed:v1')?.includes(publisher) ?? false,
    grants: localStorage.getItem('kernl:grants:v1')?.includes(hash) ?? false,
  }), { publisher, hash });
}

test.use({ expectedConsoleError: /WebSocket|ERR_CONNECTION|NS_ERROR|can.t establish a connection/i });

test('applet addresses stay internal and review verified permissions before installing', async ({ page, context }) => {
  const { frame, network, target, question, review } = await start(page);
  await frame.getByRole('button', { name: 'Stats' }).click();
  await expect(question).toBeVisible();
  await expect(question).toContainText('Toy Rocket wants to');
  await question.getByRole('button', { name: 'Cancel' }).click();
  await expect(frame.locator('#out')).toHaveText('denied');
  expect(network.lookups).not.toContain('target.test');
  await expect(review).toHaveCount(0);

  await frame.getByRole('button', { name: 'Stats' }).click();
  await question.getByRole('button', { name: 'Look up applet' }).click();
  await expect(review.getByRole('heading', { name: 'Toy Rocket wants to install and open Routstr Stats' })).toBeVisible();
  await expect(review.locator(`[title="${target.pubkey}"]`)).toBeVisible();
  await expect(review).not.toContainText('Pretend Publisher');
  await expect(review.getByRole('group', { name: 'Required' }).getByRole('checkbox')).toBeChecked();
  await expect(review.getByRole('group', { name: 'Optional' }).getByRole('checkbox')).not.toBeChecked();
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(frame.locator('#out')).toHaveText('denied');
  expect(await targetRecords(page, target.pubkey, target.hash)).toEqual({ installed: false, grants: false });
  await expect(page.locator('iframe[data-window-id]')).toHaveCount(1);

  await frame.getByRole('button', { name: 'Stats' }).click();
  await question.getByRole('button', { name: 'Look up applet' }).click();
  await review.getByRole('button', { name: 'Install and open', exact: true }).click();
  await expect(frame.locator('#out')).toHaveText('opened');
  await expect(page.frameLocator('iframe[data-window-id]').nth(1).locator('#out')).toHaveText('true,false');
  expect(await targetRecords(page, target.pubkey, target.hash)).toEqual({ installed: true, grants: true });
  expect(context.pages()).toEqual([page]);

  await frame.getByRole('button', { name: 'Stats' }).click();
  await question.getByRole('button', { name: 'Look up applet' }).click();
  await expect(review.getByRole('heading', { name: 'Toy Rocket wants to open Routstr Stats' })).toBeVisible();
  await review.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(frame.locator('#out')).toHaveText('opened');
  await expect(page.locator('iframe[data-window-id]')).toHaveCount(2);
});

test('a linked applet without permissions says so, and Escape declines', async ({ page }) => {
  const { frame, target, question, review } = await start(page, false);
  await frame.getByRole('button', { name: 'Stats' }).click();
  await question.getByRole('button', { name: 'Look up applet' }).click();
  await expect(review.getByText('No permissions requested.', { exact: true })).toBeVisible();
  if (process.env.APPLET_LINK_SCREENSHOT) await review.screenshot({ path: process.env.APPLET_LINK_SCREENSHOT });
  await page.keyboard.press('Escape');
  await expect(frame.locator('#out')).toHaveText('denied');
  expect(await targetRecords(page, target.pubkey, target.hash)).toEqual({ installed: false, grants: false });
});
