import type { Page, WebSocketRoute } from '@playwright/test';
import { nip19 } from 'nostr-tools';
import { expect, test } from './fixtures';
import { correspondent } from './live-messages';
import { installSignerExtension } from './live-network';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';
const HINTED = 'wss://hinted.test/';

/**
 * Every server answers and holds nothing, except the one the shared identity names, which holds
 * the person's profile. What was published and which servers were asked are kept for the test.
 */
async function onlyTheHintedServerKnows(page: Page, held: readonly { pubkey: string; kind: number }[]): Promise<{ published: { kind: number; tags: string[][] }[] }> {
  const seen = { published: [] as { kind: number; tags: string[][] }[] };
  await page.routeWebSocket(/^wss:\/\//, (socket: WebSocketRoute) => {
    const hinted = socket.url() === HINTED;
    socket.onMessage((raw) => {
      const [verb, ...rest] = JSON.parse(String(raw)) as [string, ...unknown[]];
      if (verb === 'REQ') {
        const [subId, ...filters] = rest as [string, ...{ kinds?: number[]; authors?: string[] }[]];
        if (hinted) for (const event of held) if (filters.some((filter) => filter.authors?.includes(event.pubkey) && filter.kinds?.includes(event.kind))) socket.send(JSON.stringify(['EVENT', subId, event]));
        socket.send(JSON.stringify(['EOSE', subId]));
      }
      if (verb === 'EVENT') {
        const event = rest[0] as { id: string; kind: number; tags: string[][] };
        seen.published.push(event);
        socket.send(JSON.stringify(['OK', event.id, true, '']));
      }
    });
  });
  return seen;
}

test('looking around as someone by a shared identity that names a server finds them there', async ({ page }) => {
  const grace = correspondent();
  await onlyTheHintedServerKnows(page, [grace.profile('Grace Hopper')]);
  await page.goto(`${base}/app/`);
  await page.getByRole('listitem').filter({ hasText: 'Read-only' }).getByRole('button', { name: 'Choose' }).click();
  await page.getByRole('textbox', { name: 'Identity' }).fill(nip19.nprofileEncode({ pubkey: grace.pubkey, relays: [HINTED] }));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('[data-phase="desktop"]')).toBeVisible();
  await expect(page.getByText('Grace Hopper').first()).toBeVisible();
});

for (const [form, encode] of [
  ['the short shareable form', (pubkey: string) => nip19.npubEncode(pubkey)],
  ['the form that names a server', (pubkey: string) => `nostr:${nip19.nprofileEncode({ pubkey, relays: [HINTED] })}`],
] as const) {
  test(`read-only sign-in takes ${form}`, async ({ page }) => {
    const grace = correspondent();
    await onlyTheHintedServerKnows(page, []);
    await page.goto(`${base}/app/`);
    await page.getByRole('listitem').filter({ hasText: 'Read-only' }).getByRole('button', { name: 'Choose' }).click();
    await page.getByRole('textbox', { name: 'Identity' }).fill(encode(grace.pubkey));
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('[data-phase="desktop"]')).toBeVisible();
  });
}

test('text that is not an identity is refused in plain words', async ({ page }) => {
  await onlyTheHintedServerKnows(page, []);
  await page.goto(`${base}/app/`);
  await page.getByRole('listitem').filter({ hasText: 'Read-only' }).getByRole('button', { name: 'Choose' }).click();
  await page.getByRole('textbox', { name: 'Identity' }).fill('grace');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toHaveText('That is not an identity. Paste one as it was shared with you, or as 64 letters and digits.');
});

test('a message to someone named by a shared identity with a server reaches them, named from that server', async ({ page }) => {
  await installSignerExtension(page, { encrypts: true });
  const grace = correspondent();
  const seen = await onlyTheHintedServerKnows(page, [grace.profile('Grace Hopper')]);
  await page.goto(`${base}/app/`);
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await page.getByRole('button', { name: /^Messages/ }).click();
  await expect(page.locator('section.window')).toHaveAttribute('data-status', 'running');
  const applet = page.frameLocator('iframe[data-window-id]');
  await applet.getByRole('button', { name: 'New message' }).first().click();
  await applet.getByRole('group', { name: 'New message' }).getByRole('textbox').fill(nip19.nprofileEncode({ pubkey: grace.pubkey, relays: [HINTED] }));
  await applet.getByRole('button', { name: 'Start conversation' }).click();
  await expect(applet.getByRole('alert')).toHaveCount(0);
  const message = applet.getByRole('textbox', { name: 'Message' });
  await message.fill('Found you.');
  await message.press('Enter');
  await expect(applet.getByRole('log').getByText('Found you.')).toBeVisible();
  await expect.poll(() => seen.published.some((event) => event.tags.some((tag) => tag[0] === 'p' && tag[1] === grace.pubkey))).toBe(true);
});
