import path from 'path';
import { fileURLToPath } from 'url';

import { defineConfig, devices } from '@playwright/test';

const currentDir = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const baseUrl = process.env.BASE_URL || 'http://localhost:3004';
const serverUrl = new URL(baseUrl);
const webServerPort = serverUrl.port || '3000';

// Default to isolated test dataset unless explicitly overridden
process.env.SANITY_PROJECT_ID = process.env.SANITY_PROJECT_ID || 'smplat';
process.env.SANITY_DATASET = process.env.SANITY_DATASET || 'test';
process.env.MOCK_RECONCILIATION_DASHBOARD_PATH =
  process.env.MOCK_RECONCILIATION_DASHBOARD_PATH ||
  path.resolve(currentDir, './tests/fixtures/reconciliation-dashboard.json');
process.env.MOCK_PROCESSOR_REPLAYS_PATH =
  process.env.MOCK_PROCESSOR_REPLAYS_PATH ||
  path.resolve(currentDir, './tests/fixtures/replay-events.json');

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: baseUrl,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports. */
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev',
    url: baseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000, // 2 minutes timeout for dev server startup
    env: {
      PORT: webServerPort,
    },
  },
});
