import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { fakeNetwork, generalRelays, signApplet, type SignedApplet } from './live-network';

const base = process.env.PLAYWRIGHT_BASE_URL ?? '';

/**
 * The live shell's event cache in a real browser: sqlite-wasm over the origin-private file system,
 * in its worker, with the SAH pool the core installs (D-030). Node tests run the same recovery
 * logic against real sqlite-wasm; only a browser has OPFS, the worker and the pool's files.
 */

/** Where the SAH pool keeps its files: `.<vfs name>/.opaque` at the OPFS root. Each file starts with a 4 KiB header naming the database it holds. */
const POOL = ['.kernl-sahpool', '.opaque'];
const HEADER = 4096;

async function signInFresh(page: Page): Promise<void> {
  // A new account each visit: what carries over is the event cache in OPFS, not the account in storage.
  await page.goto(`${base}/`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${base}/app/`);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByLabel(/^Password/).fill('correct horse battery');
  await page.getByLabel('Repeat the password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create and sign in' }).click();
  await expect(page.getByRole('button', { name: 'Open an applet' })).toBeVisible();
}

async function storeLists(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Open an applet' }).click();
  await expect(page.getByRole('list', { name: 'Applets' }).getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 });
}

/** The pool's files that hold a database, by whether their data starts with sqlite's own header. */
async function poolDatabases(page: Page): Promise<{ sqlite: number; other: number }> {
  return page.evaluate(
    async ({ pool, header }) => {
      let directory: FileSystemDirectoryHandle | undefined = await navigator.storage.getDirectory();
      for (const name of pool) directory = await directory?.getDirectoryHandle(name).catch(() => undefined);
      const counts = { sqlite: 0, other: 0 };
      if (!directory) return counts;
      for await (const handle of (directory as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
        if (handle.kind !== 'file') continue;
        const file = await (handle as FileSystemFileHandle).getFile();
        if (file.size <= header) continue;
        const magic = new TextDecoder().decode(await file.slice(header, header + 15).arrayBuffer());
        if (magic === 'SQLite format 3') counts.sqlite += 1;
        else if (magic.replace(/\0/g, '') !== '') counts.other += 1;
      }
      return counts;
    },
    { pool: POOL, header: HEADER },
  );
}

/** Overwrite the data of every database file in the pool, keeping the pool's headers, as a torn write or a bad disk would. */
async function corruptPool(page: Page): Promise<number> {
  return page.evaluate(
    async ({ pool, header }) => {
      let directory = await navigator.storage.getDirectory();
      for (const name of pool) directory = await directory.getDirectoryHandle(name);
      let damaged = 0;
      for await (const handle of (directory as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
        if (handle.kind !== 'file') continue;
        const file = await (handle as FileSystemFileHandle).getFile();
        if (file.size <= header) continue;
        const writable = await (handle as FileSystemFileHandle).createWritable({ keepExistingData: true });
        await writable.write({ type: 'write', position: header, data: new TextEncoder().encode('this is not a database '.repeat(400)) });
        await writable.close();
        damaged += 1;
      }
      return damaged;
    },
    { pool: POOL, header: HEADER },
  );
}

/** A visit that lists the applet from the network, then waits for the cache's batched write. */
async function visitAndCache(context: BrowserContext, applet: SignedApplet): Promise<void> {
  const page = await context.newPage();
  await fakeNetwork(page, applet, generalRelays('holds'), {});
  await signInFresh(page);
  await storeLists(page, 'Feed applet');
  await expect.poll(() => poolDatabases(page), { timeout: 15_000 }).toMatchObject({ sqlite: 1 });
  // The cache writes in batches every 5 s; closing the page also releases the pool's file handles.
  await page.waitForTimeout(6_000);
  await page.close();
}

test('the store lists an applet from the sqlite cache when every relay is down', async ({ context, page }) => {
  test.setTimeout(90_000);
  const applet = signApplet({ servers: ['https://blobs.test'] });
  await visitAndCache(context, applet);

  await fakeNetwork(page, applet, generalRelays('down'), {});
  await signInFresh(page);
  await storeLists(page, 'Feed applet');
  expect(await poolDatabases(page)).toEqual({ sqlite: 1, other: 0 });
});

test('a damaged sqlite cache is detected, wiped and rebuilt, and the shell carries on', async ({ context, page }) => {
  test.setTimeout(90_000);
  const applet = signApplet({ servers: ['https://blobs.test'] });
  await visitAndCache(context, applet);

  // Damage the database from a page of the same origin that has no cache open.
  await page.goto(`${base}/`);
  expect(await corruptPool(page)).toBeGreaterThan(0);
  expect(await poolDatabases(page)).toMatchObject({ sqlite: 0 });

  await fakeNetwork(page, applet, generalRelays('holds'), {});
  await signInFresh(page);
  await storeLists(page, 'Feed applet');
  // The damaged file was never read as a database: it was wiped and a sound one took its place.
  await expect.poll(() => poolDatabases(page), { timeout: 15_000 }).toEqual({ sqlite: 1, other: 0 });
});
