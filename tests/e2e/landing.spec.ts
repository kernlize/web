import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const about = ['/about/', '/about/why/', '/about/guard/', '/about/messaging/', '/about/bridges/', '/about/developers/'];
const pages = ['/', ...about];
const sideways = (page: Page): Promise<number> => page.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollWidth - innerWidth);
/** Reveals whose top is on screen and which are not yet fully shown. */
const unrevealed = (page: Page): Promise<number> =>
  page.evaluate(() => Array.from(document.querySelectorAll('.reveal')).filter((element) => element.getBoundingClientRect().top < innerHeight * 0.9 && getComputedStyle(element).opacity !== '1').length);

test.describe('landing site', () => {
  for (const path of pages) {
    test(`${path} renders with one h1 and a markdown twin`, async ({ page, request }) => {
      const response = await page.goto(path);
      expect(response?.ok()).toBe(true);
      await expect(page.locator('h1')).toHaveCount(1);
      const twin = await page.locator('link[rel="alternate"][type="text/markdown"]').getAttribute('href');
      expect(twin).toBeTruthy();
      const markdown = await request.get(twin as string);
      expect(markdown.ok()).toBe(true);
      expect(await markdown.text()).toMatch(/^# /m);
    });
  }

  test('the header leads from the landing into the long-form pages, and between them', async ({ page }) => {
    for (const [path, expected] of [['/', 2], ['/about/', 6]] as const) {
      await page.goto(path);
      const links = page.locator('header nav[aria-label="Site"] a');
      await expect(links).toHaveCount(expected);
      for (const link of await links.all()) {
        const href = await link.getAttribute('href');
        const response = await page.request.get(href as string);
        expect(response.ok(), href as string).toBe(true);
      }
    }
  });

  test('every footer link into the site answers, and a docs page opened at its clean address stays that page', async ({ page }) => {
    await page.goto('/');
    const site = new URL((await page.locator('link[rel="canonical"]').getAttribute('href')) as string).origin;
    const hrefs = await page.locator('footer nav[aria-label="Footer"] a').evaluateAll((links) => links.map((link) => link.getAttribute('href') as string));
    expect(hrefs).toHaveLength(6);
    // Copy names the production origin outright in places; here those links are followed on the site under test.
    const paths = hrefs.map((href) => new URL(href, site)).filter((url) => url.origin === site).map((url) => url.pathname);
    expect(paths).toHaveLength(5);
    for (const path of paths) expect((await page.request.get(path)).status(), path).toBe(200);

    // D-032: the host serving the file is half of it; the docs app must also recognise the address it wakes up at.
    const docs = paths.filter((path) => path.startsWith('/docs/') && path !== '/docs/');
    expect(docs).toHaveLength(2);
    for (const path of docs) {
      await page.goto(path, { waitUntil: 'networkidle' });
      await expect(page.locator('.VPDoc h1')).toBeVisible();
      await expect(page.locator('.NotFound')).toHaveCount(0);
      expect(new URL(page.url()).pathname).toBe(path);
    }
  });

  for (const [width, height] of [[1280, 720], [390, 844]] as const) {
    test(`at ${width}x${height} the hero is whole above the fold`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      const hero = page.locator('section.hero');
      for (const part of [hero.locator('h1'), hero.locator('.lede'), hero.getByRole('link', { name: 'Try the preview' }), hero.getByRole('link', { name: 'Adopt kernl' })]) {
        await expect(part).toBeInViewport({ ratio: 1 });
      }
      await expect(page.locator('#adopt h2')).not.toBeInViewport();
      const bottom = await hero.evaluate((element) => element.getBoundingClientRect().bottom);
      expect(bottom).toBeLessThanOrEqual(height);
    });
  }

  test('the landing gives an existing application and a new shell a path each', async ({ page }) => {
    await page.goto('/');
    await page.locator('section.hero').getByRole('link', { name: 'Adopt kernl' }).click();
    await expect(page.locator('#adopt h2')).toBeInViewport();
    const paths = page.locator('#adopt article');
    await expect(paths).toHaveCount(2);
    for (const [index, who, tutorial] of [[0, 'You have an application', 'Embed kernl in a page'], [1, 'You are starting a shell', 'Run the shell']] as const) {
      const path = paths.nth(index);
      await expect(path).toContainText(who);
      await expect(path.locator('ol > li')).toHaveCount(3);
      await expect(path.locator('pre')).toBeVisible();
      for (const link of await path.getByRole('link').all()) {
        const href = await link.getAttribute('href');
        expect((await page.request.get(href as string)).ok(), href as string).toBe(true);
      }
      await expect(path.getByRole('link', { name: tutorial })).toBeVisible();
    }
  });

  test('moving between pages keeps the document, crosses behind the curtain and reveals the new page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas[data-stage][data-live]')).toHaveCount(1);
    await page.evaluate(() => Object.assign(window, { sameVisit: true }));
    await page.getByRole('navigation', { name: 'Site', exact: true }).getByRole('link', { name: 'About' }).click();
    await expect(page.locator('canvas[data-stage].is-front')).toHaveCount(1);
    await expect(page).toHaveURL(/\/about\/$/);
    await expect(page.locator('h1')).toHaveText("Run things you don't have to trust.");
    await expect(page.locator('canvas[data-stage].is-front')).toHaveCount(0);
    await expect.poll(() => unrevealed(page)).toBe(0);
    expect(await page.evaluate(() => 'sameVisit' in window)).toBe(true);

    await page.getByRole('navigation', { name: 'Site', exact: true }).getByRole('link', { name: 'Guard' }).click();
    await expect(page).toHaveURL(/\/about\/guard\/$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/about\/$/);
    await expect(page.locator('canvas[data-stage].is-front')).toHaveCount(0);
    await expect.poll(() => unrevealed(page)).toBe(0);
    expect(await page.evaluate(() => 'sameVisit' in window)).toBe(true);
  });

  test('the shell is always a fresh page load, never a swap', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => Object.assign(window, { sameVisit: true }));
    await page.locator('section.hero').getByRole('link', { name: 'Try the preview' }).click();
    await expect(page).toHaveURL(/\/app\/\?preview=1$/);
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
    expect(await page.evaluate(() => 'sameVisit' in window)).toBe(false);
  });

  test('with reduced motion nothing is hidden, nothing moves and navigation is plain', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const path of ['/', '/about/']) {
      await page.goto(path);
      await expect(page.locator('.reveal').first()).toHaveClass(/\bin\b/);
      expect(await page.evaluate(() => Array.from(document.querySelectorAll('.reveal')).filter((element) => getComputedStyle(element).opacity !== '1').length)).toBe(0);
      await expect(page.locator('canvas[data-stage][data-live]')).toHaveCount(0);
    }
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Site', exact: true }).getByRole('link', { name: 'About' }).click();
    await expect(page).toHaveURL(/\/about\/$/);
    await expect(page.locator('canvas[data-stage].is-front')).toHaveCount(0);
  });

  test('without scripts the landing is whole', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('#adopt article')).toHaveCount(2);
    for (const reveal of await page.locator('.reveal').all()) await expect(reveal).toHaveCSS('opacity', '1');
    await context.close();
  });

  test('at 390px every site link is reachable from the menu and nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of pages) {
      await page.goto(path);
      expect(await sideways(page), `${path} scrolls sideways`).toBeLessThanOrEqual(0);
      await expect(page.getByRole('navigation', { name: 'Site', exact: true })).toBeHidden();
      await page.locator('header details.site-menu > summary').click();
      const links = page.getByRole('navigation', { name: 'Site menu' }).getByRole('link');
      await expect(links).toHaveCount(path === '/' ? 2 : 6);
      for (const link of await links.all()) {
        await expect(link).toBeInViewport({ ratio: 1 });
        await link.click({ trial: true });
      }
      expect(await sideways(page), `${path} scrolls sideways with the menu open`).toBeLessThanOrEqual(0);
    }
    await page.goto('/about/');
    await page.locator('header details.site-menu > summary').click();
    await page.getByRole('navigation', { name: 'Site menu' }).getByRole('link', { name: 'Guard' }).click();
    await expect(page).toHaveURL(/\/about\/guard\/$/);
  });

  test('the addresses the long-form pages used to have lead to where they moved', async ({ page, request }) => {
    for (const name of ['why', 'guard', 'messaging', 'bridges', 'developers']) {
      await page.goto(`/${name}/`);
      await expect(page).toHaveURL(new RegExp(`/about/${name}/$`));
      expect(await (await request.get(`/${name}/index.md`)).text()).toContain(`/about/${name}/index.md`);
    }
    expect(await (await request.get('/llms.txt')).text()).not.toMatch(/\]\([^)]*\.run\/(why|guard|messaging|bridges|developers)\//);
  });

  test('the open form is a real labelled form with tool attributes', async ({ page }) => {
    await page.goto('/');
    const form = page.locator('form[toolname="open-applet"]');
    await expect(form).toHaveCount(1);
    const input = form.locator('input[name="address"]');
    await expect(input).toHaveAttribute('required', '');
    const id = await input.getAttribute('id');
    await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
  });

  test('agent discovery files are served', async ({ request }) => {
    for (const file of ['/llms.txt', '/llms-full.txt', '/robots.txt', '/sitemap-index.xml']) {
      const response = await request.get(file);
      expect(response.ok(), file).toBe(true);
    }
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Sitemap:');
    expect(robots).not.toMatch(/Disallow: \/\s*$/m);
  });

  test('the theme toggle switches the colour scheme, and the choice outlives a page transition', async ({ page }) => {
    await page.goto('/');
    const toggle = page.getByRole('button', { name: /theme|dark|light/i }).first();
    await expect(toggle).toBeVisible();
    const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await toggle.click();
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(after).not.toBe(before);
    await page.getByRole('navigation', { name: 'Site', exact: true }).getByRole('link', { name: 'About' }).click();
    await expect(page).toHaveURL(/\/about\/$/);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(after);
    await page.getByRole('button', { name: /theme|dark|light/i }).first().click();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(before ?? (after === 'dark' ? 'light' : 'dark'));
  });
});
