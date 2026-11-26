import { defineConfig } from '@playwright/test';

const port = 4178;
// Set PLAYWRIGHT_BASE_URL to run the suite against a deployed site instead of the local artifact.
const remote = process.env.PLAYWRIGHT_BASE_URL;
// The example host is its own page, built from published packages in examples/minimal-host (#76).
const hostPort = Number(process.env.MINIMAL_HOST_PORT ?? 4180);
const hostUrl = process.env.MINIMAL_HOST_URL ?? `http://127.0.0.1:${hostPort}/`;

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
  webServer: [
    ...(remote ? [] : [{
      command: 'node scripts/serve-pages.mjs',
      port,
      reuseExistingServer: false,
      env: { PAGES_PORT: String(port) },
    }]),
    ...(process.env.MINIMAL_HOST_URL ? [] : [{
      command: 'npm run --prefix examples/minimal-host serve',
      port: hostPort,
      reuseExistingServer: false,
      env: { MINIMAL_HOST_PORT: String(hostPort) },
    }]),
  ],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' }, testIgnore: /e2e\/minimal-host\.spec\.ts$/ },
    { name: 'minimal-host', use: { browserName: 'chromium', baseURL: hostUrl }, testMatch: /e2e\/minimal-host\.spec\.ts$/ },
    // The live shell's network path differs by engine (socket failures, fetch aborts), so its specs run in a second one.
    { name: 'firefox', use: { browserName: 'firefox' }, testMatch: /shell-live.*\.spec\.ts$/ },
  ],
});
