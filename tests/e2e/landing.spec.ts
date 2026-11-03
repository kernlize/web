import { expect, test } from './fixtures';

const pages = ['/', '/why/', '/guard/', '/messaging/', '/bridges/', '/developers/'];

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

  test('navigation reaches every section', async ({ page }) => {
    await page.goto('/');
    const links = page.locator('header nav a');
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(5);
    for (let index = 0; index < count; index += 1) {
      const href = await links.nth(index).getAttribute('href');
      const response = await page.request.get(href as string);
      expect(response.ok(), href as string).toBe(true);
    }
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

  test('the theme toggle switches the colour scheme', async ({ page }) => {
    await page.goto('/');
    const toggle = page.getByRole('button', { name: /theme|dark|light/i }).first();
    await expect(toggle).toBeVisible();
    const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await toggle.click();
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(after).not.toBe(before);
  });
});
