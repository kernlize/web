import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { expect, test } from './fixtures';
import { mailbox } from './live-messages';

/**
 * examples/minimal-host: someone else's page, built from the published @kernlize/kernel and
 * @kernlize/modules, with its own sign-in, its own dialog and one applet pinned by hash (#76).
 * The kernel, the private-message provider and the file servers' uploader run for real against
 * relays and a file server that exist only in this browser.
 */

const proofs = process.env.KERNL_PROOFS_DIR;
const NOTE = 'see you at six';

async function proof(page: Page, name: string): Promise<void> {
  if (proofs) await page.screenshot({ path: `${proofs}/${name}.png`, animations: 'disabled' });
}
const FILE_SERVERS = ['blossom.primal.net', 'nostr.download', 'blossom.band'];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

/** Someone with an inbox for private messages (kind 10050) on one relay. */
function friend() {
  const secret = generateSecretKey();
  const inbox = finalizeEvent({ kind: 10050, created_at: Math.floor(Date.now() / 1000) - 60, tags: [['relay', 'wss://inbox.test']], content: '' }, secret);
  return { pubkey: getPublicKey(secret), inbox };
}

/** The person's file servers, answering uploads and mirrors the way a Blossom server does. Each request is noted as `host path`. */
async function fileServers(page: Page): Promise<{ readonly requests: string[]; readonly stored: string[] }> {
  const requests: string[] = [];
  const stored: string[] = [];
  for (const host of FILE_SERVERS) {
    await page.route(`https://${host}/**`, (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      // HEAD /upload asks whether an upload would be taken (BUD-06); HEAD /<sha256> whether the blob is here, and none is yet.
      if (request.method() === 'HEAD') return route.fulfill({ status: new URL(request.url()).pathname === '/upload' ? 200 : 404, headers: CORS });
      if (request.method() !== 'PUT') return route.fulfill({ status: 404, headers: CORS, body: '' });
      const { pathname } = new URL(request.url());
      const body = request.postDataBuffer() ?? Buffer.alloc(0);
      requests.push(`${host} ${pathname}`);
      // An upload carries the bytes; a mirror (BUD-04) names where another server already has them.
      const sha256 = pathname === '/mirror'
        ? (JSON.parse(body.toString()) as { url: string }).url.match(/[0-9a-f]{64}/)?.[0] ?? ''
        : createHash('sha256').update(body).digest('hex');
      if (pathname === '/upload') stored.push(body.toString());
      return route.fulfill({
        status: 200,
        headers: CORS,
        contentType: 'application/json',
        body: JSON.stringify({ url: `https://${host}/${sha256}.txt`, sha256, size: body.length, type: 'text/plain', uploaded: Math.floor(Date.now() / 1000) }),
      });
    });
  }
  return { requests, stored };
}

async function openNote(page: Page, options: { readonly keepUploads?: boolean } = {}) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Sign in with a throwaway identity' }).click();
  await expect(page.getByRole('heading', { name: 'Note to a friend' })).toBeVisible();
  await expect(page.getByText(/^Pinned to sha256 [0-9a-f]{12}…$/)).toBeVisible();
  await page.getByRole('button', { name: 'Open' }).click();

  // The host's own dialog, not kernl's: its words, its choice about uploads.
  const dialog = page.getByRole('dialog', { name: 'Open Note to a friend?' });
  await expect(dialog.getByText('It can read and send your private messages.')).toBeVisible();
  if (options.keepUploads) await dialog.getByRole('checkbox', { name: /Let it upload files too/ }).check();
  await proof(page, options.keepUploads ? '02-open-keeping-uploads' : '01-open');
  await dialog.getByRole('button', { name: 'Yes' }).click();

  const applet = page.frameLocator('#stage iframe');
  await expect(applet.getByRole('status')).toHaveText('ready');
  return applet;
}

test('the host opens its pinned applet after its own question, and the applet sends a private message', async ({ page }) => {
  const to = friend();
  const relays = await mailbox(page, [to.inbox]);
  const applet = await openNote(page);

  await applet.getByLabel('To, as a hex key').fill(to.pubkey);
  await applet.getByLabel('Note').fill(NOTE);
  await applet.getByRole('button', { name: 'Send' }).click();
  await expect(applet.getByRole('status')).toHaveText('sent', { timeout: 20_000 });
  await proof(page, '03-sent');

  // Sealed and gift-wrapped for the friend (NIP-17): the note itself is never on a relay in the clear.
  const wraps = relays.published.filter((event) => event.kind === 1059);
  expect(wraps.some((event) => event.tags.some((tag) => tag[0] === 'p' && tag[1] === to.pubkey))).toBe(true);
  expect(relays.published.some((event) => event.content.includes(NOTE))).toBe(false);
});

test('beside messages, uploads stay off unless the person keeps them', async ({ page }) => {
  await mailbox(page, []);
  const servers = await fileServers(page);
  const applet = await openNote(page);

  await applet.getByLabel('Note').fill(NOTE);
  await applet.getByRole('button', { name: 'Upload it as a file' }).click();
  await expect(applet.getByRole('status')).toHaveText('uploads are not offered');
  expect(servers.requests).toEqual([]);
});

test.describe('with uploads kept', () => {
  // Before uploading, the uploader asks each server whether it already has the blob, and the browser logs each "no".
  test.use({ expectedConsoleError: /the server responded with a status of 404/ });

  test('kept beside messages, an upload is asked about in the host\'s own dialog first', async ({ page }) => {
    await mailbox(page, []);
    const servers = await fileServers(page);
    const applet = await openNote(page, { keepUploads: true });
    await applet.getByLabel('Note').fill(NOTE);

    await applet.getByRole('button', { name: 'Upload it as a file' }).click();
    // kernl's facts and wording, drawn by the host: what leaves, where to, and who can see it.
    const question = page.getByRole('dialog', { name: 'Upload a file' });
    await expect(question.getByRole('listitem')).toHaveText(['File: note.txt, text/plain', 'Size: 14 bytes', 'Sent to: blossom.primal.net, nostr.download, blossom.band', 'Who can see it: Anyone who has its address']);
    await proof(page, '04-upload-question');
    await question.getByRole('button', { name: 'No' }).click();
    await expect(applet.getByRole('status')).toHaveText(/^not uploaded: .+$/);
    expect(servers.requests).toEqual([]);

    await applet.getByRole('button', { name: 'Upload it as a file' }).click();
    await question.getByRole('button', { name: 'Yes' }).click();
    await expect(applet.getByRole('status')).toHaveText(/^uploaded https:\/\/[^/]+\/[0-9a-f]{64}\.txt$/, { timeout: 20_000 });
    await proof(page, '05-uploaded');
    // The bytes go to the first of the person's servers once, and the others copy them from there.
    expect(servers.stored).toEqual([NOTE]);
    expect(servers.requests).toEqual(['blossom.primal.net /upload', 'nostr.download /mirror', 'blossom.band /mirror']);
  });
});

test('bytes that are not the pinned applet are never run', async ({ page }) => {
  await mailbox(page, []);
  await page.route('**/applet.html', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><p>someone else\'s page</p>' }));
  await page.goto('./');
  await page.getByRole('button', { name: 'Sign in with a throwaway identity' }).click();
  // The kernel hashes the bytes as it reads them, before the host can offer to run them.
  await expect(page.getByRole('alert')).toHaveText('Note to a friend was not opened: these are not the bytes this page pinned.');
  await expect(page.getByRole('button', { name: 'Open' })).toBeHidden();
  await expect(page.locator('#stage iframe')).toHaveCount(0);
  await proof(page, '06-not-the-pinned-bytes');
});
