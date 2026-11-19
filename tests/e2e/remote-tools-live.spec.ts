import { expect, test } from './fixtures';
import { fakeNetwork, generalRelays, installSignerExtension, signApplet } from './live-network';
import { installToolServer, toolCallingApplet } from './live-tools';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';
const TOOLS = 'wss://tools.test';

/**
 * The live shell runs an applet that calls a tool on a remote server, against a relay and a tool
 * server that exist only in this browser. The call leaves under a key of the applet's window, never
 * the account's, and only once the person granted remote tools (D-041).
 */

async function open(page: import('@playwright/test').Page, grant: boolean) {
  const applet = signApplet({ servers: ['https://blobs.test'], requires: [], optional: ['cvm'], html: toolCallingApplet(TOOLS, 'trust_score') });
  await fakeNetwork(page, applet, { 'catalogue.test': 'holds', ...generalRelays('empty') }, { 'blobs.test': 'has' });
  const server = await installToolServer(page, TOOLS, { name: 'Trust fixture', tool: 'trust_score', answer: '0.87' });
  const extension = await installSignerExtension(page);
  await page.goto(`${base}/app/`);
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('searchbox', { name: 'Find an applet' }).fill(applet.address(['wss://catalogue.test']));
  await page.getByRole('button', { name: 'Look up' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Feed applet' })).toBeVisible();
  if (grant) await dialog.getByRole('checkbox', { name: /remote tools/ }).check();
  await dialog.getByRole('button', { name: 'Run' }).click();
  return { server, extension, out: page.frameLocator('iframe[data-window-id]').locator('#out') };
}

test('an applet granted remote tools calls one under its own key, not the account', async ({ page }) => {
  const { server, extension, out } = await open(page, true);
  await expect(out).toHaveText('score 0.87', { timeout: 20_000 });
  expect(server.callers.size).toBe(1);
  expect(server.callers.has(extension.pubkey)).toBe(false);
  // Nothing was signed as the account, and what reached the relay was sealed.
  expect(extension.calls.signEvent ?? 0).toBe(0);
  const requests = server.published.filter((event) => event.tags.some((tag) => tag[0] === 'p' && tag[1] === server.pubkey));
  expect(requests.length).toBeGreaterThan(0);
  for (const request of requests) expect(request.content).not.toContain('trust_score');
});

test('an applet that was not granted remote tools reaches no tool server', async ({ page }) => {
  const { server, out } = await open(page, false);
  await expect(out).toContainText('failed', { timeout: 20_000 });
  expect(server.callers.size).toBe(0);
  expect(server.published).toEqual([]);
});
