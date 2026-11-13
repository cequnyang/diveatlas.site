const { defineConfig, devices } = require('@playwright/test');
const port = process.env.PLAYWRIGHT_PORT || '8766';

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  failOnFlakyTests: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Map rendering is CPU-heavy in GitHub's mobile Chromium; serialize CI runs
  // so popup placement is not competing with another browser context.
  workers: process.env.CI ? 1 : 2,
  reporter: [['list'], ['./tools/interaction_test_reporter.js']],
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
  // Opt-in matrix keeps routine map suites small while making the complete
  // mobile gesture flow reproducible across themes and viewport geometries.
  projects: process.env.PULL_FLOW_MATRIX === '1' ? [320, 390, 430, 720].flatMap(width =>
    ['light', 'dark'].map(theme => ({
      name: `pull-${width}-${theme}`,
      metadata: { pullTheme:theme },
      testMatch: ['dive-site-photo-ui-mobile.spec.js', 'mobile-interactions.spec.js'],
      use: { ...devices['Pixel 7'], browserName:'chromium', colorScheme:theme,
        viewport:{ width, height:width === 720 ? 1024 : 844 } }
    }))
  ) : [
    {
      name: 'desktop-chromium',
      grepInvert: process.env.INTERACTION_POLICY_INVENTORY === '1' ? undefined : /@mobile-only/,
      testMatch: ['destination-comparison.spec.js', 'saved-trips.spec.js', 'destination-overview.spec.js', 'shared-header.spec.js', 'dive-site-detail.spec.js', 'reviewed-site-photos.spec.js', 'critical-contracts.spec.js', 'environmental-view.spec.js', 'dive-conditions.spec.js', 'dive-experience-outlook.spec.js', 'dive-site-photo-ui-desktop.spec.js', 'tide-feature.spec.js', 'reef-condition.spec.js', 'reef-condition-seaview-local.spec.js', 'reef-condition-thermal-history.spec.js', 'reef-condition-ocean-heat-history.spec.js', 'regional-currents.spec.js', 'regional-currents-real-data.spec.js', 'regional-currents-flow.spec.js'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 }
      }
    },
    {
      name: 'mobile-touch-chromium',
      grepInvert: process.env.INTERACTION_POLICY_INVENTORY === '1' ? undefined : /@desktop-only/,
      testMatch: ['destination-comparison.spec.js', 'saved-trips.spec.js', 'destination-overview.spec.js', 'shared-header.spec.js', 'dive-site-detail.spec.js', 'reviewed-site-photos.spec.js', 'mobile-interactions.spec.js', 'saved-trips-mobile.spec.js', 'dive-conditions.spec.js', 'dive-experience-outlook.spec.js', 'dive-site-photo-ui-mobile.spec.js', 'tide-feature.spec.js', 'reef-condition.spec.js', 'reef-condition-seaview-local.spec.js', 'reef-condition-thermal-history.spec.js', 'reef-condition-ocean-heat-history.spec.js', 'regional-currents.spec.js', 'regional-currents-real-data.spec.js', 'regional-currents-flow.spec.js'],
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
