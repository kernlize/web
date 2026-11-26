import { matchFilters, type Filter } from 'nostr-tools';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { expect, test } from './fixtures';
import { installSignerExtension, signApplet } from './live-network';

const RELAY = 'wss://relay.napplet.soy';
const BLOBS = 'https://blobs.test';

// Seventeen distinct manifests for the same small artifact exceed the core's cap on waiting plans.
test('a live stack larger than the admission queue opens every selected applet', async ({ page }) => {
  const applets = Array.from({ length: 17 }, () => signApplet({ servers: [BLOBS], requires: [], optional: [] }));
  const stack = finalizeEvent({
    kind: 30267,
    created_at: 1_790_000_000,
    content: '',
    tags: [['d', 'large'], ['title', 'Large stack'], ...applets.map(({ pubkey }) => ['a', `35129:${pubkey}:feed`, RELAY])],
  }, generateSecretKey());
  const events = [stack, ...applets.map(({ event }) => event)];
  await page.routeWebSocket(/^wss:\/\//, (socket) => {
    socket.onMessage((raw) => {
      const [verb, id, ...filters] = JSON.parse(String(raw)) as [string, string, ...Filter[]];
      if (verb !== 'REQ') return;
      if (new URL(socket.url()).hostname === new URL(RELAY).hostname) {
        for (const event of events) if (matchFilters(filters, event)) socket.send(JSON.stringify(['EVENT', id, event]));
      }
      socket.send(JSON.stringify(['EOSE', id]));
    });
  });
  await page.route(`${BLOBS}/**`, (route) => route.fulfill({ body: applets[0]!.html, headers: { 'access-control-allow-origin': '*' } }));
  await installSignerExtension(page);
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await page.getByRole('tab', { name: 'Stacks' }).click();
  await page.getByRole('button', { name: 'Open 17 of the 17 in Large stack, installing the rest' }).click();
  await page.getByRole('button', { name: 'Open all 17' }).click();
  await expect(page.locator('section.window[data-status="running"]')).toHaveCount(17);
  await expect(page.locator('iframe[data-window-id]')).toHaveCount(17);
  await expect(page.getByRole('region', { name: 'Applets window' })).toHaveCount(0);
});
