import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { fakeNetwork, generalRelays, installSignerExtension, signApplet } from './live-network';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';

/**
 * The live shell runs an applet that loads its assets as `blossom:` references naming no server,
 * the way published applets do, against a relay and a blob server that exist only in this browser.
 * The blob is on the applet's own server and nowhere else; the shell finds it there and checks its
 * hash before the applet sees it (D-055).
 */

const ASSET = 'sprites and sounds';
const ASSET_HASH = createHash('sha256').update(ASSET).digest('hex');

function assetApplet(reference: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Assets</title></head><body><h1>Assets</h1><p id="out">waiting</p><script>
(async () => {
  const out = document.getElementById('out');
  try {
    const blob = await window.napplet.resource.bytes(${JSON.stringify(reference)});
    out.textContent = 'loaded ' + (await blob.text());
  } catch (error) {
    out.textContent = 'failed: ' + error.message;
  }
})();
</script></body></html>`;
}

async function open(page: Page, reference: string, served: string) {
  const applet = signApplet({ servers: ['https://blobs.test'], requires: ['resource'], optional: [], html: assetApplet(reference) });
  await fakeNetwork(page, applet, { 'catalogue.test': 'holds', ...generalRelays('empty') }, { 'blobs.test': 'has' });
  const asked: string[] = [];
  // Registered after the network, so it answers first for the asset; the applet's artifact still comes from the fake blob server.
  await page.route(`https://blobs.test/${ASSET_HASH}`, (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/html', headers: { 'access-control-allow-origin': '*' }, body: served });
  });
  await installSignerExtension(page);
  await page.goto(`${base}/app/`);
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('searchbox', { name: 'Find an applet' }).fill(applet.address(['wss://catalogue.test']));
  await page.getByRole('button', { name: 'Look up' }).click();
  const dialog = page.getByRole('region', { name: 'Applets window' });
  await expect(dialog.getByRole('heading', { name: 'Feed applet' })).toBeVisible();
  const fetches = dialog.getByRole('checkbox', { name: /web fetches/ });
  if (!(await fetches.isChecked())) await fetches.check();
  await dialog.getByRole('button', { name: 'Run' }).click();
  return { out: page.frameLocator('iframe[data-window-id]').locator('#out'), asked };
}

test('an applet loads an asset its reference names no server for, from its own server', async ({ page }) => {
  const { out, asked } = await open(page, `blossom:sha256:${ASSET_HASH}`, ASSET);
  await expect(out).toHaveText(`loaded ${ASSET}`, { timeout: 20_000 });
  expect(asked).toEqual([`https://blobs.test/${ASSET_HASH}`]);
});

test('an asset whose bytes do not match its hash never reaches the applet', async ({ page }) => {
  const { out } = await open(page, `blossom:${ASSET_HASH}.png`, 'something else');
  await expect(out).toHaveText('failed: not-found', { timeout: 20_000 });
});
