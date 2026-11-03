import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { getPublicKey, generateSecretKey, nip19 } from 'nostr-tools';
import { expect, test } from './fixtures';
import { UNAVAILABLE_WORDS, messagingError } from '../../apps/web/src/shell/messaging-reasons';
import { expectClean } from './vocabulary';

/**
 * The live shell (no `?preview=1`), walked offline. Every socket the shell opens is answered by a
 * route that closes it at once, so nothing leaves the machine and the shell sees servers that are
 * down. Sign-in is read-only with a fresh key, which needs no signer. What is checked is what the
 * public-vocabulary spec checks for the preview, but against the real default servers from the
 * built core, whose names include words a person must never read (D-006).
 */

type Core = typeof import('@kernl/core');
const core = (await import(pathToFileURL(resolve(import.meta.dirname, '../../packages/core/dist/index.js')).href)) as Core;
const ACCOUNT = getPublicKey(generateSecretKey());
const ADDRESS = nip19.naddrEncode({ kind: 35128, pubkey: ACCOUNT, identifier: 'probe', relays: ['wss://relay.example.org'] });

async function offline(page: Page): Promise<void> {
  await page.routeWebSocket(/.*/, (socket) => socket.close());
}

async function signInReadOnly(page: Page, path = '/app/'): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Who is at the keyboard?' })).toBeVisible();
  await page.getByRole('listitem').filter({ hasText: 'Read-only' }).getByRole('button', { name: 'Choose' }).click();
  await page.getByRole('textbox', { name: 'Account id' }).fill(ACCOUNT);
  await expectClean(page, 'read-only sign-in, filled');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('[data-phase="desktop"]')).toBeVisible();
}

test.beforeEach(async ({ page }) => offline(page));

test('the live sign-in names no protocol', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.getByRole('heading', { name: 'Who is at the keyboard?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try the preview' })).toHaveCount(0);
  await expectClean(page, 'live sign-in');
  for (const [item, button] of [['Connect a remote signer', 'Connect'], ['Read-only', 'Choose'], ['Create a local account', 'Create']] as const) {
    await page.getByRole('listitem').filter({ hasText: item }).getByRole('button', { name: button }).click();
    await expectClean(page, `live sign-in: ${item}`);
    await page.getByRole('button', { name: 'Back' }).click();
  }
});

test('the live settings show every default server without naming the protocol', async ({ page }) => {
  await signInReadOnly(page);
  await expectClean(page, 'live desktop');
  await page.locator('details.account summary').click();
  await page.getByRole('button', { name: 'Settings' }).click();
  const defaults = Object.values(core.DEFAULT_RELAY_TIERS).flat();
  const shown = await page.locator('[data-address]').evaluateAll((items) => items.map((item) => item.getAttribute('data-address')));
  expect(shown.sort()).toEqual([...defaults].sort());
  // The applet catalogue's default server has a name that would say what the protocol is, so it is called by its tier.
  await expect(page.getByText('Applet catalogue server 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Applet catalogue server 1 from Applet catalogue' })).toBeVisible();
  await expectClean(page, 'live settings with the default servers');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /^Messages/ }).first().click();
  await expect(page.getByText('No backend is available for this provider yet', { exact: false }).first()).toBeVisible();
  await expectClean(page, 'live messages');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Guard/ }).first().click();
  await expectClean(page, 'live guard');
});

test('the live launcher never shows the address it was asked to open', async ({ page }) => {
  await signInReadOnly(page, `/app/?open=${encodeURIComponent(ADDRESS)}`);
  const field = page.getByRole('textbox', { name: 'Applet address' });
  await expect(field).toBeVisible();
  await expect(field).toHaveValue('');
  await expectClean(page, 'live launcher opened from a link');
  // Offline, the lookup either keeps waiting for servers that never answer or gives up with a reason in plain words.
  await page.waitForTimeout(5000);
  await expect(field).toHaveValue('');
  await expectClean(page, 'live launcher after the lookup');
});

test('every reason the core gives for an unavailable provider has plain words', () => {
  for (const reason of Object.values(core.MESSAGING_UNAVAILABLE_REASONS)) {
    expect(UNAVAILABLE_WORDS[reason], reason).toMatch(/^No backend is available for this provider yet/);
    expect(messagingError(new Error(`unavailable:${reason}`)), reason).toBe(UNAVAILABLE_WORDS[reason]);
  }
  expect(messagingError(new Error('something raw:with-a-code'))).toBe('That did not work. Try again.');
});

test('with no preview and no remembered account the sign-in choices are headed "Sign in"', async ({ page }) => {
  await offline(page);
  await page.goto('/app/');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in another way' })).toHaveCount(0);
});
