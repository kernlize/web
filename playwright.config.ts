import { defineConfig } from '@playwright/test';

const port = 4178;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-pages.mjs',
    port,
    reuseExistingServer: false,
    env: { PAGES_PORT: String(port) },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
