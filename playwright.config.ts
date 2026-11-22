import { defineConfig } from '@playwright/test';

const previewPort = process.env.PREVIEW_PORT || '4173';
const baseURL = `http://127.0.0.1:${previewPort}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'ui',
      testMatch: /ui\/.*\.spec\.ts/,
      use: { baseURL },
    },
    {
      name: 'smoke',
      testMatch: /smoke\/.*\.spec\.ts/,
    },
  ],
  ...(process.env.PW_SKIP_WEBSERVER === '1'
    ? {}
    : {
        webServer: {
          command: 'node tests/e2e/serve-dist.mjs',
          url: baseURL,
          reuseExistingServer: !process.env.CI,
        },
      }),
});
