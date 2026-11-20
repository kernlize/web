import type { Page } from '@playwright/test';
import { expect, openSettings, test } from './fixtures';
import { fakeNetwork, generalRelays, installSignerExtension, signApplet } from './live-network';
import { familyCallingApplet, installToolServer } from './live-tools';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';
const TOOLS = 'wss://tools.test/';

/**
 * In the live shell the person chooses, in Settings, the relays that introduce them and find tools,
 * a connection helper, and tools they trust, found from a reference someone shared. An applet then
 * runs one of those tools by the name the person gave it (D-043). The relay and the tool server
 * exist only in this browser.
 */

async function settings(page: Page) {
  return (await openSettings(page, 'Connections')).getByRole('region', { name: 'Meeting people and remote tools' });
}

test('the person trusts tools from a shared reference, and an applet runs one by the name they gave', async ({ page }) => {
  const applet = signApplet({ servers: ['https://blobs.test'], requires: [], optional: ['cvm'], html: familyCallingApplet('trust', 'trust_score') });
  await fakeNetwork(page, applet, { 'catalogue.test': 'holds', ...generalRelays('empty') }, { 'blobs.test': 'has' });
  const server = await installToolServer(page, TOOLS, { name: 'Trust fixture', tool: 'trust_score', answer: '0.87' });
  await installSignerExtension(page);
  await page.goto(`${base}/app/`);
  await page.getByRole('button', { name: 'Use', exact: true }).click();

  const section = await settings(page);
  await expect(section.getByText('Using the general relays.')).toBeVisible();
  await section.getByLabel('Add a meeting relay').fill('tools.test');
  await section.getByRole('button', { name: 'Add' }).first().click();
  await expect(section.getByRole('list', { name: 'Relays for meeting people' }).locator('li[data-address="wss://tools.test"]')).toBeVisible();
  await section.getByLabel('Helper address').fill('stun:helper.test:3478');
  await section.getByRole('button', { name: 'Add' }).nth(1).click();
  await expect(section.getByRole('list', { name: 'Connection helpers' })).toContainText('stun:helper.test:3478');

  await section.getByLabel('Find tools').fill(server.reference);
  await section.getByRole('button', { name: 'Look' }).click();
  const candidate = section.getByRole('form', { name: /^Tools from/ });
  await expect(candidate).toContainText('trust_score');
  await candidate.getByLabel('Name these tools').fill('trust');
  await candidate.getByRole('button', { name: 'Trust' }).click();
  await expect(section.getByRole('list', { name: 'Tools you trust' })).toContainText('trust · trust_score');
  await page.keyboard.press('Escape');

  // The choices are this device's: they are there after a reload.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open an applet' })).toBeVisible();
  await expect((await settings(page)).getByRole('list', { name: 'Tools you trust' })).toContainText('trust · trust_score');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('searchbox', { name: 'Find an applet' }).fill(applet.address(['wss://catalogue.test']));
  await page.getByRole('button', { name: 'Look up' }).click();
  const dialog = page.getByRole('region', { name: 'Applets window' });
  await dialog.getByRole('checkbox', { name: /remote tools/ }).check();
  await dialog.getByRole('button', { name: 'Run' }).click();
  await expect(page.frameLocator('iframe[data-window-id]').locator('#out')).toHaveText('score 0.87', { timeout: 20_000 });
});

test('a search that finds nothing says so in words', async ({ page }) => {
  const applet = signApplet({ servers: ['https://blobs.test'] });
  await fakeNetwork(page, applet, generalRelays('empty'), { 'blobs.test': 'has' });
  await installSignerExtension(page);
  await page.goto(`${base}/app/`);
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  const section = await settings(page);
  await section.getByLabel('Find tools').fill('12'.repeat(32));
  await section.getByRole('button', { name: 'Look' }).click();
  await expect(section.getByRole('alert')).toHaveText('No tools were found for that.', { timeout: 20_000 });
});
