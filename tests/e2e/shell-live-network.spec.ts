import { expect, test } from './fixtures';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';

/**
 * Applets that are published on the public network and open in other shells. Opening them here
 * depends on servers nobody in this repository runs, so this file is skipped unless
 * KERNL_PUBLIC_NETWORK=1: it is the check to run before and after publishing the site, not a
 * gate that can fail a commit because a relay was down.
 */
const PUBLISHED = [
  {
    title: 'Napplet Feed',
    address: 'naddr1qvzqqqyf8ypzqfngzhsvjggdlgeycm96x4emzjlwf8dyyzdfg4hefp89zpkdgz99qythwumn8ghj7un9d3shjtnwv9c8qmr9wsh8xmmeqy28wumn8ghj7un9d3shjtnyv9kh2uewd9hsqzrwv9cz6en9v4jq7m0q7y',
    needs: /posting to your network/,
  },
];

/** Dodgy Duck: a published game that names no domain for its keys and registers its whole keymap as it starts (D-054). */
const DODGY_DUCK = 'naddr1qvzqqqyf8ypzpem34u9stj8ftlxldl4n2qz5f5hmrnxns3uga86fpwe7u28ga4n0qythwumn8ghj7un9d3shjtnwv9c8qmr9wsh8xmmeqyt8wumn8ghj7un9d3shjtnswf5k6ctv9ehx2aqpzemhxue69uhhyetvv9ujumn0wvh8xmmrd9skcqg4waehxw309aex2mrp0yhxummnw3ezumn9wsq3gamnwvaz7tmwdaehgu3wdau8gu3wv3jhvqguwaehxw309ahx7um5wgknqvfw09skk6tgdahxuefwvdhk6qgawaehxw309aex2mrp0yhxummnw3ezuamfwfjkgmn9wshx5uqqp9c82eryd3jksmmsrwrnfp';

interface KeysEnvelope {
  readonly from: 'applet' | 'shell';
  readonly type: string;
  readonly id?: string;
  readonly binding?: string;
  readonly key?: string;
}

test.describe('applets published on the public network', () => {
  test.skip(process.env.KERNL_PUBLIC_NETWORK !== '1', 'set KERNL_PUBLIC_NETWORK=1 to dial the public network');
  // A public relay may refuse a connection; the lookup must survive that, and the browser's own complaint is not a shell error.
  test.use({ expectedConsoleError: /WebSocket connection to|Failed to load resource|ERR_|establish a connection to the server at wss:|CORS request did not succeed/ });

  for (const applet of PUBLISHED) {
    test(`${applet.title} is found, verified and runs`, async ({ page }) => {
      await page.goto(`${base}/app/`);
      await page.getByRole('button', { name: 'Create' }).click();
      await page.getByLabel(/^Password/).fill('correct horse battery');
      await page.getByLabel('Repeat the password').fill('correct horse battery');
      await page.getByRole('button', { name: 'Create and sign in' }).click();

      await page.getByRole('button', { name: 'Open an applet' }).click();
      await page.getByRole('searchbox', { name: 'Find an applet' }).fill(applet.address);
      await page.getByRole('button', { name: 'Look up' }).click();

      const dialog = page.getByRole('region', { name: 'Applets window' });
      await expect(dialog.getByRole('heading', { name: applet.title })).toBeVisible({ timeout: 30_000 });
      await dialog.getByRole('checkbox', { name: applet.needs }).check();
      await dialog.getByRole('button', { name: 'Run' }).click();

      await expect(page.locator('section.window')).toHaveAttribute('data-status', 'running');
      // The applet got what it requires: it reports on its feed instead of on a missing capability.
      const body = page.frameLocator('iframe[data-window-id]').locator('body');
      await expect(body).toContainText(/contacts/, { timeout: 30_000 });
      await expect(body).not.toContainText(/Starting/, { timeout: 30_000 });
      await expect(body).not.toContainText(/Missing required|No identity connected|unavailable/i);
    });
  }

  test('Dodgy Duck, as published, gets every key it registers', async ({ page }) => {
    // The applet is run exactly as published. What crosses its port is read from outside it, in both directions.
    const seen: KeysEnvelope[] = [];
    await page.exposeBinding('__keysSeen', (source, envelope: Omit<KeysEnvelope, 'from'>) => {
      seen.push({ ...envelope, from: source.frame === page.mainFrame() ? 'shell' : 'applet' });
    });
    await page.addInitScript(() => {
      const post = MessagePort.prototype.postMessage;
      MessagePort.prototype.postMessage = function (this: MessagePort, data: { type?: unknown; id?: string; binding?: string; key?: string }, ...rest: unknown[]) {
        const report = (window as unknown as { __keysSeen?: (envelope: unknown) => void }).__keysSeen;
        if (report && typeof data?.type === 'string' && data.type.startsWith('keys.')) report({ type: data.type, id: data.id, binding: data.binding, key: data.key });
        return (post as (...args: unknown[]) => void).call(this, data, ...rest);
      } as typeof post;
    });

    await page.goto(`${base}/app/`);
    await page.getByRole('button', { name: 'Create' }).click();
    await page.getByLabel(/^Password/).fill('correct horse battery');
    await page.getByLabel('Repeat the password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Create and sign in' }).click();

    await page.getByRole('button', { name: 'Open an applet' }).click();
    await page.getByRole('searchbox', { name: 'Find an applet' }).fill(DODGY_DUCK);
    await page.getByRole('button', { name: 'Look up' }).click();
    const dialog = page.getByRole('region', { name: 'Applets window' });
    await expect(dialog.getByRole('heading', { name: 'Dodgy Duck' })).toBeVisible({ timeout: 30_000 });
    // Nothing is switched on for it: keyboard shortcuts need no grant.
    await dialog.getByRole('button', { name: 'Run' }).click();
    const game = page.getByRole('region', { name: 'Dodgy Duck window' });
    await expect(game).toHaveAttribute('data-status', 'running');

    const asked = (): KeysEnvelope[] => seen.filter((envelope) => envelope.from === 'applet' && envelope.type === 'keys.registerAction');
    const answers = (): KeysEnvelope[] => seen.filter((envelope) => envelope.from === 'shell' && envelope.type === 'keys.registerAction.result');
    await expect.poll(() => asked().length, { timeout: 30_000 }).toBeGreaterThan(8);
    // Every registration is answered, the ones past the runtime's startup allowance included.
    await expect.poll(() => answers().length, { timeout: 10_000 }).toBe(asked().length);
    expect(answers().map((answer) => answer.id).sort()).toEqual(asked().map((request) => request.id).sort());
    // Each key is bound as asked, apart from the ones a browser keeps for itself.
    expect(answers().filter((answer) => answer.binding === undefined).length).toBeLessThanOrEqual(1);
    expect(answers().map((answer) => answer.binding)).toEqual(expect.arrayContaining(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']));

    // A key it holds is the game's own: pressed inside it, held down, it is neither forwarded nor a flood.
    await page.frameLocator('iframe[data-window-id]').locator('body').click({ position: { x: 300, y: 300 } });
    for (let i = 0; i < 350; i += 1) await page.keyboard.down('ArrowUp');
    await page.keyboard.up('ArrowUp');
    expect(seen.filter((envelope) => envelope.type === 'keys.forward' && envelope.key === 'ArrowUp')).toEqual([]);
    await expect(game).toHaveAttribute('data-status', 'running');
  });
});
