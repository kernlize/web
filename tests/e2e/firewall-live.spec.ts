import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { fakeNetwork, signApplet } from './live-network';

/**
 * The live shell's firewall (D-056): the real core and kehto's approval authority, against a
 * network that exists only in this browser. An applet that asks the shell to open a link is put
 * to the person every time; nothing else asks until they change a rule.
 */

const LINK = 'https://docs.example.test/start';

/** An applet with one button that asks the shell to open {@link LINK} and says what came back. */
const LINKING_APPLET = `<!doctype html><html><head><meta charset="utf-8"><title>Reader</title></head><body><h1>Reader</h1><button id="go" type="button">Read the docs</button><p id="out">idle</p><script>
let asked = 0;
document.getElementById('go').addEventListener('click', async () => {
  const out = document.getElementById('out');
  asked += 1;
  out.textContent = 'asking ' + asked;
  try {
    const result = await window.napplet.link.open(${JSON.stringify(LINK)});
    out.textContent = 'link ' + asked + ' ' + result.status;
  } catch (error) {
    out.textContent = 'link ' + asked + ' failed: ' + error.message;
  }
});
</script></body></html>`;

/** Pages the shell opened outside itself; the destination is answered here, never by the real network. */
async function watchOpenedLinks(context: BrowserContext): Promise<string[]> {
  const opened: string[] = [];
  await context.route('https://docs.example.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Docs</title><h1>Docs</h1>' }));
  context.on('page', (page) => {
    // The first navigation of a new tab is where the shell sent it.
    void page.waitForURL(/docs\.example\.test/).then(() => opened.push(page.url()), () => undefined);
  });
  return opened;
}

async function runLinkingApplet(page: Page): Promise<void> {
  const applet = signApplet({ servers: ['https://blobs.test/'], requires: [], optional: ['link'], html: LINKING_APPLET });
  await fakeNetwork(page, applet, { 'catalogue.test': 'holds' }, { 'blobs.test': 'has' });
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByLabel(/^Password/).fill('correct horse battery');
  await page.getByLabel('Repeat the password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create and sign in' }).click();
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('searchbox', { name: 'Find an applet' }).fill(applet.address(['wss://catalogue.test']));
  await page.getByRole('button', { name: 'Look up' }).click();
  const store = page.getByRole('region', { name: 'Applets window' });
  await store.getByRole('checkbox', { name: /opening links/ }).check();
  await store.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'running');
}

const appletFrame = (page: Page) => page.frameLocator('iframe[data-window-id]');
const firewallQuestion = (page: Page) => page.getByRole('dialog').filter({ hasText: 'firewall' });

// Every socket but the one catalogue relay is refused, which each engine reports in its own words.
test.use({ expectedConsoleError: /WebSocket|ERR_CONNECTION|NS_ERROR|can.t establish a connection/i });

test('starting an applet asks nothing, and a link asks every time and opens only on yes', async ({ page, context }) => {
  const opened = await watchOpenedLinks(context);
  await runLinkingApplet(page);
  // The shipped rules allow what the person granted: no question stands between Run and the applet.
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await appletFrame(page).getByRole('button', { name: 'Read the docs' }).click();
  const question = firewallQuestion(page);
  await expect(question.getByRole('heading', { name: 'Open a link outside kernl' })).toBeVisible();
  await expect(question).toContainText('Feed applet wants to');
  await expect(question).toContainText(LINK);
  await expect(question).toContainText('docs.example.test');
  // A link is answered for this once only: there is nothing to remember.
  await expect(question.getByRole('button')).toHaveText(['Don’t open', 'Open link']);
  await question.getByRole('button', { name: 'Don’t open' }).click();
  await expect(appletFrame(page).locator('#out')).toHaveText('link 1 denied');
  expect(opened).toEqual([]);

  // Asked again for the very same link: the answer was not kept.
  await appletFrame(page).getByRole('button', { name: 'Read the docs' }).click();
  await firewallQuestion(page).getByRole('button', { name: 'Open link' }).click();
  await expect(appletFrame(page).locator('#out')).toHaveText('link 2 opened');
  await expect.poll(() => opened).toEqual([LINK]);

  // Escape dismisses a question without opening anything.
  await appletFrame(page).getByRole('button', { name: 'Read the docs' }).click();
  await expect(firewallQuestion(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(appletFrame(page).locator('#out')).toHaveText('link 3 denied');
  expect(opened).toEqual([LINK]);
});

test('the firewall panel loosens links, and a stricter rule stops the applet and asks when it starts again', async ({ page, context }) => {
  const opened = await watchOpenedLinks(context);
  await runLinkingApplet(page);

  await page.getByRole('button', { name: 'Firewall' }).click();
  const panel = page.getByRole('dialog', { name: 'Firewall' });
  await expect(panel.getByLabel('Everything you granted')).toHaveValue('allow');
  await expect(panel.getByLabel('Opening links', { exact: true })).toHaveValue('ask');
  await expect(panel.getByText('None. Link answers are not kept.')).toBeVisible();
  await panel.getByLabel('Opening links', { exact: true }).selectOption('allow');
  await panel.getByRole('button', { name: 'Close Firewall' }).click();

  await appletFrame(page).getByRole('button', { name: 'Read the docs' }).click();
  await expect(appletFrame(page).locator('#out')).toHaveText('link 1 opened');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => opened).toEqual([LINK]);

  // Its own storage now asks: the applet started under the old rule, so it is stopped and says why.
  await page.getByRole('button', { name: 'Firewall' }).click();
  await panel.getByText('By kind').click();
  await panel.getByLabel('its own storage').selectOption('ask');
  await panel.getByRole('button', { name: 'Close Firewall' }).click();
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'revoked');
  await expect(page.getByText('A firewall rule or answer it ran under changed.').first()).toBeVisible();

  // Starting it again puts that one domain to the person, with answers that can be kept.
  await page.locator('section.window').getByRole('button', { name: /Close/ }).first().click();
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('tab', { name: 'Recent' }).click();
  await page.getByRole('region', { name: 'Applets window' }).getByRole('listitem').filter({ hasText: 'Feed applet' }).getByRole('button', { name: 'Open' }).click();
  await page.getByRole('region', { name: 'Applets window' }).getByRole('button', { name: 'Run' }).click();
  const question = firewallQuestion(page);
  await expect(question.getByRole('heading', { name: 'Use its own storage' })).toBeVisible();
  await expect(question.getByRole('button')).toHaveText(['Don’t allow', 'Allow while open', 'Always allow']);
  await question.getByRole('button', { name: 'Always allow' }).click();
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'running');

  // The answer is listed, and taking it back stops the applet that ran under it.
  await page.getByRole('button', { name: 'Firewall' }).click();
  const answers = panel.getByTestId('firewall-answers');
  await expect(answers.getByRole('listitem')).toHaveText(/Feed applet · its own storage: allowed, kept across visits/);
  await answers.getByRole('button', { name: 'Take back' }).click();
  await expect(panel.getByText('None. Link answers are not kept.')).toBeVisible();
  await panel.getByRole('button', { name: 'Close Firewall' }).click();
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'revoked');
});
