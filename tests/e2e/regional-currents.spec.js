const { test, expect } = require('@playwright/test');
const { gzipSync } = require('node:zlib');
const { closeTopMenu, openMap, openMobileSettings, openTopMenu, selectEnvironmentView } = require('./support');

async function openLayersPanel(page) {
  const panel = page.locator('#bioLegend');
  if (await panel.evaluate(node => node.classList.contains('is-collapsed'))) {
    await page.locator('#bioLegendTitle').click();
  }
  await expect(page.locator('#bioLegendLayers')).toHaveAttribute('aria-hidden', 'false');
}

test('Regional Currents is off at startup and requests no current code or data', async ({ page }) => {
  const currentRequests = [];
  page.on('request', request => {
    if (/currents|current-math|current-tile-cache|regional-currents/.test(request.url())) currentRequests.push(request.url());
  });
  await openMap(page);
  await page.waitForTimeout(250);
  expect(await page.locator('#currentsLayerToggle').isChecked()).toBe(false);
  expect(currentRequests).toEqual([]);
});

test('enabling Regional Currents loads visible tiles and reports flow direction without a map-wide arrow layer', async ({ page }, testInfo) => {
  const metadataRequests = [];
  const tileRequests = [];
  const metadata = {
    source: 'Copernicus Marine Service',
    dataset: 'GLOBAL_MULTIYEAR_PHY_001_030',
    version: 'fixture-v1',
    data_format_version: 1,
    asset_base: 'data/currents',
    tile_template: 'v{format_version}/{month}/{depth}/s{step}/{column}_{row}.bin.gz',
    tile_size: 128,
    grid: { width: 4320, height: 2041, longitude_min: -180, longitude_max: 179.9166667, latitude_min: -80, latitude_max: 90, longitude_step: 1 / 12, latitude_step: 1 / 12 },
    zooms: [{ min_zoom: 2, max_zoom: 4, step: 16 }, { min_zoom: 5, max_zoom: 7, step: 8 }, { min_zoom: 8, max_zoom: 22, step: 4 }],
    quantization: { scale_m_s: 0.001 },
    depth_mapping: { surface: { source_m: 0.494 }, '10m': { source_m: 11.405 }, '20m': { source_m: 21.599 }, '30m': { source_m: 29.44 } },
    available_slices: Array.from({ length: 12 }, (_, index) => [
      { month: index + 1, depth_label: 'surface' }, { month: index + 1, depth_label: '10m' },
      { month: index + 1, depth_label: '20m' }, { month: index + 1, depth_label: '30m' }
    ]).flat()
  };
  const size = 128;
  const raw = new ArrayBuffer(16 + size * size * 4);
  const bytes = new Uint8Array(raw);
  bytes.set([68, 65, 84, 67]);
  const header = new DataView(raw);
  header.setUint8(4, 1); header.setUint8(5, 7); header.setUint8(6, 8);
  header.setUint16(8, 1, true); header.setUint16(10, size, true);
  header.setUint16(12, 1, true); header.setUint16(14, 3, true);
  const samples = new Int16Array(raw, 16);
  for (let index = 0; index < samples.length; index += 2) { samples[index] = 321; samples[index + 1] = 234; }
  const compressedTile = gzipSync(Buffer.from(raw));

  await openMap(page, { localStorage: { 'global-coral-map-environment-month-v1': '9' } });
  await openLayersPanel(page);
  await page.route('**/data/currents/metadata.json', async route => {
    metadataRequests.push(route.request().url());
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(metadata) });
  });
  await page.route('**/data/currents/v1/*/*/s8/*.bin.gz*', async route => {
    tileRequests.push(route.request().url());
    await route.fulfill({ contentType: 'application/gzip', body: compressedTile });
  });

  await selectEnvironmentView(page, 'currents');
  await expect.poll(() => metadataRequests.length).toBe(1);
  await expect.poll(() => tileRequests.length).toBeGreaterThan(0);
  await expect(page.locator('.regional-currents-canvas')).toHaveCount(0);
  await page.evaluate(() => {
    const map = window.__DIVEATLAS_TEST__.map;
    const point = L.point(map.getSize().x * 0.85, map.getSize().y * 0.5);
    map.fire('click', { latlng: map.containerPointToLatLng(point), containerPoint: point });
  });
  await expect(page.locator('.regional-currents-popup')).toBeVisible();
  await expect(page.locator('.regional-current-value [aria-hidden="true"]')).toHaveCount(0);
  await expect(page.locator('.regional-currents-popup')).toContainText('NE');
  await expect(page.locator('.regional-currents-popup')).toContainText('0.40 m/s');
  await expect(page.locator('.regional-currents-popup')).toContainText('September');
  await expect(page.locator('.regional-currents-popup')).toContainText('Copernicus Marine');
  const regionalPopupWidth = await page.locator('.regional-currents-popup').evaluate(element => element.getBoundingClientRect().width);
  expect(regionalPopupWidth).toBeCloseTo(testInfo.project.name.includes('mobile') ? 320 : 360, 0);
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getState().popup?.lifecycle)).toBe('open');
  if (testInfo.project.name === 'mobile-touch-chromium') {
    await expect(page.locator('#bioLegend')).toHaveClass(/is-collapsed/);
  }
  const popupBounds = await page.locator('.regional-currents-popup').boundingBox();
  const viewport = page.viewportSize();
  expect(popupBounds.x).toBeGreaterThanOrEqual(0);
  expect(popupBounds.x + popupBounds.width).toBeLessThanOrEqual(viewport.width);
  expect(tileRequests.length).toBeLessThan(48);

  const screenshotName = testInfo.project.name === 'mobile-touch-chromium' ? 'mobile' : 'desktop';
  await page.screenshot({ path: `test-results/regional-currents-${screenshotName}-light.png` });
  await openMobileSettings(page);
  await page.locator('#measurementUnitSwitch [data-length-unit="ft"]').click();
  await expect(page.locator('#currentsInfoResolutionValue')).toHaveText('~5 mi');
  await expect(page.locator('#currentsMetaResolutionValue')).toHaveText('~5 mi');
  await expect(page.locator('.regional-currents-popup')).toContainText('1.30 ft/s');
  await expect(page.locator('.regional-currents-popup')).toContainText('~5 mi');
  await openTopMenu(page);
  await page.locator('#themeBtn').click();
  await closeTopMenu(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: `test-results/regional-currents-${screenshotName}-dark.png` });

  await openLayersPanel(page);
  const octoberTile = page.waitForResponse(response => response.url().includes('/currents/v1/oct/20m/s8/'));
  await page.locator('#currentsMonth').selectOption('10');
  await octoberTile;
  await expect(page.locator('#currentsStatus')).toHaveAttribute('data-state', 'ready');
  const octoberThirtyMeterTile = page.waitForResponse(response => response.url().includes('/currents/v1/oct/30m/s8/'));
  await page.locator('#currentsDepth').selectOption('30');
  await octoberThirtyMeterTile;
  await expect(page.locator('#currentsStatus')).toHaveAttribute('data-state', 'ready');
  const requestsBeforeCachedReturn = tileRequests.length;
  await page.locator('#currentsDepth').selectOption('20');
  await expect(page.locator('#currentsStatus')).toHaveAttribute('data-state', 'ready');
  await page.locator('#currentsMonth').selectOption('9');
  await expect(page.locator('#currentsStatus')).toHaveAttribute('data-state', 'ready');
  expect(tileRequests.length).toBe(requestsBeforeCachedReturn);

  await selectEnvironmentView(page, 'default');
  await expect(page.locator('.regional-currents-canvas')).toHaveCount(0);
  await expect(page.locator('.regional-currents-popup')).toHaveCount(0);
  const requestsAfterDisable = tileRequests.length;
  await selectEnvironmentView(page, 'currents');
  await expect(page.locator('.regional-currents-canvas')).toHaveCount(0);
  expect(metadataRequests).toHaveLength(1);
  expect(tileRequests.length).toBe(requestsAfterDisable);
  await selectEnvironmentView(page, 'default');
  await expect(page.locator('.regional-currents-canvas')).toHaveCount(0);
});

test('Regional Currents controls fit a narrow screen and keep touch-sized selectors', async ({ page }) => {
  await openMap(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/data/currents/metadata.json', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      data_format_version: 1, asset_base: 'data/currents',
      tile_template: 'v{format_version}/{month}/{depth}/s{step}/{column}_{row}.bin.gz',
      tile_size: 128, grid: { width: 4320, height: 2041, longitude_min: -180, latitude_min: -80, latitude_max: 90, longitude_step: 1 / 12, latitude_step: 1 / 12 },
      zooms: [{ min_zoom: 2, max_zoom: 22, step: 4 }], quantization: { scale_m_s: 0.001 },
      available_slices: []
    })
  }));
  await openLayersPanel(page);
  await selectEnvironmentView(page, 'currents');
  await expect(page.locator('#currentsControls')).toBeVisible();
  await expect(page.locator('#currentsStatus')).toContainText('unavailable');
  const measurements = await page.evaluate(() => {
    const month = document.getElementById('currentsMonth').getBoundingClientRect();
    const depth = document.getElementById('currentsDepth').getBoundingClientRect();
    return {
      monthHeight: month.height,
      depthHeight: depth.height,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth
    };
  });
  expect(measurements.monthHeight).toBeGreaterThanOrEqual(40);
  expect(measurements.depthHeight).toBeGreaterThanOrEqual(40);
  expect(measurements.documentWidth).toBeLessThanOrEqual(measurements.viewportWidth);
});

test('Regional Currents explanation card stays readable across themes and mobile width', async ({ page }) => {
  await openMap(page);
  await openLayersPanel(page);
  await selectEnvironmentView(page, 'currents');
  const card = page.locator('.regional-currents-legend-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Typical regional current · m/s');
  await expect(card).toContainText('Direction shows where the water flows');
  await expect(card).toContainText('Speed shows how fast it typically moves');
  await expect(card).toContainText('Weak <0.2');
  await expect(card).toContainText('Moderate 0.2–0.5');
  await expect(card).toContainText('Strong 0.5+ m/s');
  const sourceMeta = page.locator('.regional-currents-legend-meta');
  await expect(sourceMeta).toContainText(/Source:\s*Copernicus Marine/);
  await expect(sourceMeta).toContainText(/Resolution:\s*~8 km/);
  const desktopLight = await card.evaluate(node => ({
    cardWidth: node.scrollWidth,
    contentWidth: node.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    radius: getComputedStyle(node).borderRadius,
    padding: getComputedStyle(node).padding,
    borderColor: getComputedStyle(node).borderColor,
    backgroundColor: getComputedStyle(node).backgroundColor,
    scale: getComputedStyle(node.querySelector('.regional-currents-speed-gradient')).backgroundImage
  }));
  expect(desktopLight.cardWidth).toBeLessThanOrEqual(desktopLight.contentWidth + 1);
  expect(desktopLight.documentWidth).toBeLessThanOrEqual(desktopLight.viewportWidth);
  expect(desktopLight.radius).not.toBe('0px');
  expect(desktopLight.padding).not.toBe('0px');
  expect(desktopLight.scale).not.toBe('none');
  expect(await card.locator('.regional-currents-speed-labels').innerText()).toContain('Moderate');
  await page.screenshot({ path: 'test-results/regional-currents-card-desktop-light.png' });
  await openTopMenu(page);
  await page.locator('#themeBtn').click();
  await closeTopMenu(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const desktopDark = await card.evaluate(node => ({
    borderColor: getComputedStyle(node).borderColor,
    backgroundColor: getComputedStyle(node).backgroundColor,
    scale: getComputedStyle(node.querySelector('.regional-currents-speed-gradient')).backgroundImage
  }));
  expect(desktopDark.scale).not.toBe('none');
  expect(desktopDark.scale).not.toBe(desktopLight.scale);
  expect(desktopDark.borderColor).not.toBe(desktopLight.borderColor);
  expect(desktopDark.backgroundColor).not.toBe(desktopLight.backgroundColor);
  await page.screenshot({ path: 'test-results/regional-currents-card-desktop-dark.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.locator('#bioLegend').evaluate(node => node.classList.contains('is-collapsed'))) {
    await page.locator('#bioLegendTitle').click();
  }
  await expect(card).toBeVisible();
  const mobileDark = await card.evaluate(node => ({
    cardWidth: node.scrollWidth,
    contentWidth: node.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    scale: getComputedStyle(node.querySelector('.regional-currents-speed-gradient')).backgroundImage
  }));
  expect(mobileDark.cardWidth).toBeLessThanOrEqual(mobileDark.contentWidth + 1);
  expect(mobileDark.documentWidth).toBeLessThanOrEqual(mobileDark.viewportWidth);
  expect(mobileDark.scale).not.toBe('none');
  await page.screenshot({ path: 'test-results/regional-currents-card-mobile-dark.png' });
  await openTopMenu(page);
  await page.locator('#themeBtn').click();
  await closeTopMenu(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: 'test-results/regional-currents-card-mobile-light.png' });
});
