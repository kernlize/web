import { defineConfig } from '@playwright/test';

const port = 4178;
// Set PLAYWRIGHT_BASE_URL to run the suite against a deployed site instead of the local artifact.
const remote = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: remote ?? `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: remote ? undefined : {
    command: 'node scripts/serve-pages.mjs',
    port,
    reuseExistingServer: false,
    env: { PAGES_PORT: String(port) },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    // The live shell's network path differs by engine (socket failures, fetch aborts), so its specs run in a second one.
    { name: 'firefox', use: { browserName: 'firefox' }, testMatch: /shell-live.*\.spec\.ts$/ },
  ],
});
