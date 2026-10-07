const { defineConfig, devices } = require('@playwright/test');
const port = process.env.PLAYWRIGHT_PORT || '8766';

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Map rendering is CPU-heavy in GitHub's mobile Chromium; serialize CI runs
  // so popup placement is not competing with another browser context.
  workers: process.env.CI ? 1 : 2,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}.png',
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 8_000
  },
  projects: [
    {
      name: 'desktop-chromium',
      testMatch: ['critical-contracts.spec.js', 'environmental-view.spec.js', 'dive-conditions.spec.js', 'dive-experience-outlook.spec.js', 'tide-feature.spec.js', 'tide-visual-qa.spec.js', 'reef-condition.spec.js', 'reef-condition-seaview-local.spec.js', 'reef-condition-thermal-history.spec.js', 'reef-condition-ocean-heat-history.spec.js', 'regional-currents.spec.js', 'regional-currents-real-data.spec.js', 'regional-currents-production-perf.spec.js', 'regional-currents-flow.spec.js'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 }
      }
    },
    {
      name: 'mobile-touch-chromium',
      testMatch: ['mobile-interactions.spec.js', 'dive-conditions.spec.js', 'dive-experience-outlook.spec.js', 'tide-feature.spec.js', 'reef-condition.spec.js', 'reef-condition-seaview-local.spec.js', 'reef-condition-thermal-history.spec.js', 'reef-condition-ocean-heat-history.spec.js', 'regional-currents.spec.js', 'regional-currents-real-data.spec.js', 'regional-currents-production-perf.spec.js', 'regional-currents-flow.spec.js'],
      use: { ...devices['Pixel 7'], browserName: 'chromium' }
    }
  ],
  webServer: {
    command: `node tools/serve_test_site.js --port=${port}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
