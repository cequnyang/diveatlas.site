const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}.png',
  outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:8765',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 8_000
  },
  projects: [
    {
      name: 'desktop-chromium',
      testMatch: ['critical-contracts.spec.js', 'environmental-view.spec.js'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 }
      }
    },
    {
      name: 'mobile-touch-chromium',
      testMatch: 'mobile-interactions.spec.js',
      use: { ...devices['Pixel 7'], browserName: 'chromium' }
    }
  ],
  webServer: {
    command: 'python -m http.server 8765 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8765/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
