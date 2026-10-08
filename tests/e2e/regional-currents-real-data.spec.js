const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { closeTopMenu, openMap, openTopMenu, selectEnvironmentView } = require('./support');

const fixtureRoot = path.resolve(__dirname, '..', 'fixtures', 'regional-currents-real');
const samples = require('../fixtures/regional-currents-real/samples.json');

async function openLayersPanel(page) {
  const panel = page.locator('#bioLegend');
  if (await panel.evaluate(node => node.classList.contains('is-collapsed'))) {
    await page.locator('#bioLegendTitle').click();
  }
  await expect(page.locator('#bioLegendLayers')).toHaveAttribute('aria-hidden', 'false');
}

async function clickCurrentSample(page, sample) {
  await page.waitForFunction(() => {
    const state = window.__DIVEATLAS_TEST__?.getState();
    return state && !state.pendingInteraction && performance.now() >= state.suppressedUntil;
  });
  await page.evaluate(({ latitude, longitude }) => {
    const map = window.__DIVEATLAS_TEST__.map;
    const latlng = L.latLng(latitude, longitude);
    const point = map.latLngToContainerPoint(latlng);
    map.fire('click', { latlng, containerPoint: point });
  }, sample);
}

test('real GLORYS12 fixture reaches the browser with source-matched values and mask behavior', async ({ page }, testInfo) => {
  const requests = [];
  const metadataPath = path.join(fixtureRoot, 'metadata.json');
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  page.on('request', request => {
    const url = new URL(request.url());
    if (/currents|current-math|current-tile-cache|regional-currents/.test(url.pathname)) requests.push(request.url());
  });

  await openMap(page, { localStorage: { 'global-coral-map-environment-month-v1': '9' } });
  await page.waitForTimeout(200);
  expect(requests).toEqual([]);
  await page.route('**/data/currents/metadata.json', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(metadata)
  }));
  await page.route('**/data/currents/**', async route => {
    const url = new URL(route.request().url());
    const relative = decodeURIComponent(url.pathname.slice('/data/currents/'.length));
    const assetPath = path.resolve(fixtureRoot, relative);
    if (!assetPath.startsWith(fixtureRoot + path.sep)) {
      await route.fulfill({ status: 400, body: 'invalid fixture path' });
      return;
    }
    await route.fulfill({
      path: assetPath,
      headers: { 'content-type': 'application/gzip' }
    });
  });

  await openLayersPanel(page);
  await page.evaluate(() => window.__DIVEATLAS_TEST__.map.setView([-8, 130], 8, { animate: false }));
  const metadataRequest = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/metadata.json'));
  await selectEnvironmentView(page, 'currents');
  await metadataRequest;
  await expect(page.locator('#currentsStatus')).toHaveAttribute('data-state', 'ready');
  await expect.poll(() => page.locator('.regional-current-speed-tint-tile').count()).toBeGreaterThan(0);
  await expect.poll(() => page.locator('.regional-current-speed-tint-tile').first().evaluate(canvas =>
    getComputedStyle(canvas).visibility)).toBe('visible');
  await expect.poll(() => page.locator('.regional-current-speed-tint-tile').evaluateAll(canvases =>
    canvases.some(canvas => {
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      for (let offset = 3; offset < data.length; offset += 4) if (data[offset]) return true;
      return false;
    }))).toBe(true);
  await expect.poll(() => page.locator('.regional-current-speed-tint-tile').evaluateAll(canvases =>
    canvases.some(canvas => canvas.dataset.coastMask === 'gebco'))).toBe(true);
  expect(await page.locator('.regional-current-speed-tint-tile').evaluateAll(canvases =>
    canvases.every(canvas => canvas.width === 128 && canvas.height === 128))).toBe(true);
  expect(await page.evaluate(() => window.__DIVEATLAS_TEST__.map.getPane('currentSpeedTintPane').style.zIndex)).toBe('375');
  await expect(page.locator('.regional-currents-canvas')).toHaveCount(0);
  await page.locator('#currentsDepth').selectOption('20');
  await expect(page.locator('#currentsStatus')).toHaveAttribute('data-state', 'ready');
  await expect.poll(() => requests.some(url => /\/sep\/20m\/s4\//.test(new URL(url).pathname))).toBe(true);
  expect(requests.filter(url => new URL(url).pathname.endsWith('/metadata.json'))).toHaveLength(1);
  expect(requests.filter(url => /\.bin\.gz/.test(new URL(url).pathname))).toHaveLength(1);

  for (const sample of samples.samples) {
    await clickCurrentSample(page, sample);
    const popup = page.locator('.regional-currents-popup');
    await expect(popup).toBeVisible();
    await expect(popup).toContainText(`Water flows toward ${sample.expected_direction_toward}`);
    await expect(popup).toContainText(sample.popup_speed);
    await expect(popup).toContainText('September');
    await expect(popup).toContainText('20 m');
    await expect(popup.locator('a[href="https://doi.org/10.48670/moi-00021"]')).toContainText('10.48670/moi-00021');
  }

  const screenshotSuffix = testInfo.project.name === 'mobile-touch-chromium' ? 'mobile' : 'desktop';
  await page.screenshot({ path: `test-results/regional-currents-real-${screenshotSuffix}-light.png` });
  const lightTint = await page.locator('.regional-current-speed-tint-tile').evaluateAll(canvases => canvases.reduce((sum, canvas) => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    for (let offset = 0; offset < data.length; offset += 4) if (data[offset + 3]) sum += data[offset] + data[offset + 1] + data[offset + 2];
    return sum;
  }, 0));
  await openTopMenu(page);
  await page.locator('#themeBtn').click();
  await closeTopMenu(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => page.locator('.regional-current-speed-tint-tile').evaluateAll(canvases => canvases.reduce((sum, canvas) => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    for (let offset = 0; offset < data.length; offset += 4) if (data[offset + 3]) sum += data[offset] + data[offset + 1] + data[offset + 2];
    return sum;
  }, 0))).not.toBe(lightTint);
  await page.screenshot({ path: `test-results/regional-currents-real-${screenshotSuffix}-dark.png` });

  await page.evaluate(() => window.__DIVEATLAS_TEST__.map.setZoom(8));
  await expect.poll(() => requests.some(url => /\/sep\/20m\/s4\//.test(url))).toBe(true);
  await page.evaluate(() => window.__DIVEATLAS_TEST__.map.closePopup());
  await clickCurrentSample(page, { latitude: -8.0, longitude: 129.6666717529297 });
  await expect(page.locator('.regional-currents-popup')).toHaveCount(0);

  await page.evaluate(() => window.__DIVEATLAS_TEST__.map.setZoom(7));
  await expect.poll(() => page.locator('#currentsStatus').getAttribute('data-state')).toBe('ready');
  await openLayersPanel(page);
  const januaryTile = page.waitForRequest(request => /\/jan\/20m\/s8\//.test(request.url()));
  await page.locator('#currentsMonth').selectOption('1');
  await januaryTile;
  await expect(page.locator('#currentsStatus')).toHaveAttribute('data-state', 'ready');
  const januaryTenMeterTile = page.waitForRequest(request => /\/jan\/10m\/s8\//.test(request.url()));
  await page.locator('#currentsDepth').selectOption('10');
  await januaryTenMeterTile;
  await expect(page.locator('#currentsStatus')).toHaveAttribute('data-state', 'ready');

  await page.locator('#currentsMonth').selectOption('9');
  await page.locator('#currentsDepth').selectOption('20');
  await expect(page.locator('#currentsStatus')).toHaveAttribute('data-state', 'ready');
  const requestCountAfterLoadingBothPairs = requests.filter(url => /\.bin\.gz/.test(url)).length;
  await page.locator('#currentsMonth').selectOption('1');
  await page.locator('#currentsDepth').selectOption('10');
  await expect(page.locator('#currentsStatus')).toHaveAttribute('data-state', 'ready');
  expect(requests.filter(url => /\.bin\.gz/.test(url))).toHaveLength(requestCountAfterLoadingBothPairs);
  expect(await page.locator('.regional-currents-canvas').count()).toBe(0);

  const panel = page.locator('#bioLegend');
  if (!(await panel.evaluate(node => node.classList.contains('is-collapsed')))) {
    await page.locator('#bioLegendTitle').click();
  }
  await page.evaluate(() => window.__DIVEATLAS_TEST__.map.setView([-8, 129], 7, { animate: false }));
  await page.waitForTimeout(400);
  const zoomBeforeDoubleClick = await page.evaluate(() => window.__DIVEATLAS_TEST__.map.getZoom());
  const mapCenter = await page.locator('#map').boundingBox();
  await page.mouse.dblclick(mapCenter.x + mapCenter.width / 2, mapCenter.y + mapCenter.height / 2);
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.map.getZoom())).toBe(zoomBeforeDoubleClick + 1);
  await page.waitForTimeout(400);
  await expect(page.locator('.regional-currents-popup')).toHaveCount(0);

  await openLayersPanel(page);
  await page.locator('label.layer-switch-label:has(#terrainLayerToggle) .layer-toggle-switch').click();
  await expect.poll(() => page.locator('.regional-current-speed-tint-tile').count()).toBeGreaterThan(0);
  await selectEnvironmentView(page, 'default');
  await expect(page.locator('.regional-current-speed-tint-tile')).toHaveCount(0);
  await selectEnvironmentView(page, 'currents');
  await expect(page.locator('#currentsStatus')).toHaveAttribute('data-state', 'ready');
  await expect.poll(() => page.locator('.regional-current-speed-tint-tile').count()).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.locator('.regional-current-speed-tint-tile').count()).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});

test('monthly current comparison leaves loading state when one tile request stalls', async ({ page }) => {
  const metadataPath = path.join(fixtureRoot, 'metadata.json');
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  await page.route('**/data/currents/metadata.json', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(metadata)
  }));
  await page.route('**/data/currents/**', async route => {
    const url = new URL(route.request().url());
    const relative = decodeURIComponent(url.pathname.slice('/data/currents/'.length));
    const assetPath = path.resolve(fixtureRoot, relative);
    if (!assetPath.startsWith(fixtureRoot + path.sep)) {
      await route.fulfill({ status: 400, body: 'invalid fixture path' });
      return;
    }
    await route.fulfill({ path: assetPath, headers: { 'content-type': 'application/gzip' } });
  });

  await openMap(page);
  await openLayersPanel(page);
  await page.evaluate(() => window.__DIVEATLAS_TEST__.map.setView([-8, 130], 8, { animate: false }));
  await selectEnvironmentView(page, 'currents');
  await expect(page.locator('#currentsStatus')).toHaveAttribute('data-state', 'ready');
  await page.locator('#currentsMonth').selectOption('9');
  await page.locator('#currentsDepth').selectOption('20');
  await clickCurrentSample(page, samples.samples[1]);

  const popup = page.locator('.regional-currents-popup');
  await expect(popup).toBeVisible();
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (resource, options) => {
      if (/\/jan\/20m\/s4\//.test(String(resource))) {
        window.__stalledCurrentMonthRequested = true;
        return new Promise(() => {});
      }
      return originalFetch(resource, options);
    };
  });
  await popup.locator('.waves-seasonal-button').click();
  await expect(popup).toContainText('Loading monthly climatology');
  await expect.poll(() => page.evaluate(() => window.__stalledCurrentMonthRequested)).toBe(true);
  await expect(popup.locator('.regional-currents-month-chart')).toBeVisible({ timeout: 14000 });
  await expect(popup).not.toContainText(/Loading monthly climatology/);
  await expect(popup.locator('.regional-currents-month-chart').locator('g title')).toHaveCount(12);
});
