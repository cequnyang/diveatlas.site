const { test, expect } = require('@playwright/test');
const { openMap, setMapView } = require('./support');

async function expandLayers(page) {
  const layers = page.locator('#bioLegend');
  if (await layers.evaluate(node => node.classList.contains('is-collapsed'))) {
    await page.locator('#bioLegendTitle').click();
  }
}

test('Tide is a peer environmental tab with a lazy blue surface and numeric legend', async ({ page }) => {
  await openMap(page);
  const tideRequests = [];
  page.on('request', request => {
    if (/tide|eot20|fes2014/i.test(request.url())) tideRequests.push(request.url());
  });
  await expandLayers(page);

  const tideTab = page.locator('.environment-segment').filter({
    has: page.locator('input[name="environmentView"][value="tide"]')
  });
  await expect(tideTab).toBeVisible();
  await expect(tideTab.locator('span')).toHaveText('Tide');
  await expect(tideTab).toHaveCSS('min-height', '44px');
  await expect(page.locator('#tideControls')).toBeHidden();
  expect(tideRequests).toEqual([]);

  await tideTab.click();
  await expect(page.locator('#tideControls')).toBeVisible();
  await expect(page.locator('#tideTitle')).toHaveText('Tide');
  await expect(page.locator('#tideInfoAbout')).toBeVisible();
  await expect(page.locator('#tideControls .temperature-heading-title')).toHaveCSS('font-family', /Outfit/);
  const timeSelector = page.locator('#tideTime').locator('xpath=..');
  await expect(timeSelector).toHaveCSS('width', '150px');
  await expect(page.locator('#tideTime')).toHaveCSS('width', '150px');
  const legendMetaGap = await page.evaluate(() => {
    const card = document.querySelector('.tide-legend .temperature-legend-card').getBoundingClientRect();
    const meta = document.querySelector('.tide-source-badge').getBoundingClientRect();
    return meta.top - card.bottom;
  });
  expect(legendMetaGap).toBeLessThanOrEqual(4);
  await page.locator('#tideInfoAbout').click();
  await expect(page.locator('#tideInfoPopover')).toHaveClass(/is-detached/);
  await expect(page.locator('#tideInfoPopover')).toContainText('does not directly indicate local current speed');
  await page.locator('#tideInfoAbout').click();
  await expect(page.locator('#tideTime')).toHaveValue('0');
  await expect(page.locator('#tideLegendSelection')).toHaveText('Now');
  await page.locator('#tideTime').click();
  const timeWheel = page.locator('#tideTime-wheel-list');
  await expect(timeWheel).toBeVisible();
  await expect(timeWheel.locator('[role="option"]')).toHaveCount(7);
  await timeWheel.locator('[role="option"]').filter({ hasText: '+6 h' }).click();
  await expect(page.locator('#tideLegendSelection')).toHaveText('+6 h');
  await expect(timeWheel).toBeHidden();
  await page.locator('#tideTime').selectOption('0');
  await expect(page.locator('.tide-controls .temperature-scale')).toContainText('−2 m');
  await expect.poll(() => page.locator('#tideStatus').textContent(), { timeout: 30_000 }).toContain('Tide surface ready');
  await expect.poll(() => page.locator('.tide-surface-tile').count()).toBeGreaterThan(0);
  const tideReleaseSmoke = await page.evaluate(async () => {
    const { tideAssetUrl } = await import('./js/tides/asset-config.js');
    const manifestResponse = await fetch(tideAssetUrl('eot20-viz-v1/manifest.json'));
    if (!manifestResponse.ok) return { manifestStatus: manifestResponse.status, chunkStatus: null };
    const manifest = await manifestResponse.json();
    const tile = Object.values(manifest.tiles || {}).find(candidate => candidate.validNodes > 0);
    if (!tile) return { manifestStatus: manifestResponse.status, chunkStatus: null };
    const chunkResponse = await fetch(tideAssetUrl(`eot20-viz-v1/${tile.path}`));
    return { manifestStatus: manifestResponse.status, chunkStatus: chunkResponse.status };
  });
  expect(tideReleaseSmoke).toEqual({ manifestStatus: 200, chunkStatus: 200 });
});

test('Tide map taps open a location popup directly and reuse nearby model data', async ({ page }, testInfo) => {
  const tideAssetRequests = [];
  const tideAssetResponses = [];
  await page.addInitScript(() => {
    window.__tideLongTasks = [];
    if (window.PerformanceObserver && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      new PerformanceObserver(list => window.__tideLongTasks.push(...list.getEntries().map(entry => entry.duration)))
        .observe({ type: 'longtask', buffered: true });
    }
  });
  page.on('request', request => {
    if (request.url().includes('/data/tides/')) tideAssetRequests.push(request.url());
  });
  page.on('response', response => {
    if (response.url().includes('/data/tides/')) {
      tideAssetResponses.push(response.body().then(body => ({ url: response.url(), bytes: body.byteLength })));
    }
  });
  await page.route('**/data/tides/eot20-v1/coeff/26_11.bin.gz', route => route.continue());
  await page.route('**/data/tides/timezones-2026d/manifest.json', route => route.continue());
  await openMap(page);
  await setMapView(page, 44.9, -124.95, 5);
  await expandLayers(page);
  await page.locator('.environment-segment').filter({
    has: page.locator('input[name="environmentView"][value="tide"]')
  }).click();
  await expect.poll(() => page.locator('#tideStatus').textContent(), { timeout: 30_000 }).toContain('Tide surface ready');
  if (testInfo.project.name === 'mobile-touch-chromium') {
    const layers = page.locator('#bioLegend');
    if (!(await layers.evaluate(node => node.classList.contains('is-collapsed')))) {
      await page.locator('#bioLegendTitle').click();
    }
  }
  const point = await page.evaluate(() => {
    const map = window.__DIVEATLAS_TEST__.map;
    const pixel = map.latLngToContainerPoint([44.9, -124.95]);
    const rect = document.getElementById('map').getBoundingClientRect();
    return { x: rect.left + pixel.x, y: rect.top + pixel.y };
  });
  const longTaskStartIndex = await page.evaluate(() => window.__tideLongTasks.length);
  const firstSelectionStarted = Date.now();
  if (testInfo.project.name === 'mobile-touch-chromium') await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect(page.locator('.tide-map-popup')).toBeVisible();
  const tidePopupWidth = await page.locator('.tide-map-popup').evaluate(element => element.getBoundingClientRect().width);
  expect(tidePopupWidth).toBeCloseTo(page.viewportSize().width <= 720 ? 320 : 360, 0);
  await expect(page.locator('.tide-map-popup')).toContainText('Tide');
  await expect(page.locator('#tideStatus')).toContainText('estimate ready');
  await expect(page.locator('.tide-popup-location')).toContainText('44.9');
  await expect(page.locator('.tide-popup-location')).toContainText('-124.9');
  const chartNowValue = page.locator('.tide-popup-now-value');
  await expect(chartNowValue).toBeVisible();
  await expect(chartNowValue).toHaveText(/^[−+]?[\d.]+ m$/);
  await expect(page.locator('.tide-popup-chart')).toHaveAttribute('aria-label', /starting (?:at|now)/);
  const tideChart = page.locator('.tide-popup-chart');
  const tideChartBounds = await tideChart.boundingBox();
  await tideChart.dispatchEvent('pointermove', {
    clientX: tideChartBounds.x + tideChartBounds.width * 0.72,
    clientY: tideChartBounds.y + tideChartBounds.height * 0.45,
    pointerType: 'mouse'
  });
  await expect(page.locator('.tide-chart-inspection')).toHaveAttribute('visibility', 'visible');
  await expect(page.locator('.tide-chart-inspection-time')).toHaveText(/\d{1,2}:\d{2}/);
  await expect(page.locator('.tide-chart-inspection-label')).toHaveText(/^[−+]?[\d.]+ m$/);
  await expect(tideChart).toHaveAttribute('aria-label', /Predicted tide level at/);
  const tidePopupHeadingOrder = await page.locator('.tide-popup').evaluate(node => {
    const children = Array.from(node.children);
    return [
      children.findIndex(child => child.classList.contains('temperature-detail-heading')),
      children.findIndex(child => child.classList.contains('tide-popup-disclaimer')),
      children.findIndex(child => child.classList.contains('tide-popup-location'))
    ];
  });
  expect(tidePopupHeadingOrder[0]).toBeLessThan(tidePopupHeadingOrder[1]);
  expect(tidePopupHeadingOrder[1]).toBeLessThan(tidePopupHeadingOrder[2]);
  await expect(page.locator('.tide-popup-disclaimer')).toHaveCSS('border-bottom-width', '1px');
  await expect(page.locator('.tide-popup .temperature-detail-caption')).toHaveCSS('border-top-width', '1px');
  const tideMetricAlignment = await page.locator('.tide-popup .bio-popup-fields > div').evaluateAll(rows =>
    rows.map(row => {
      const rowRight = row.getBoundingClientRect().right;
      const valueRight = row.querySelector('dd').getBoundingClientRect().right;
      return Math.abs(rowRight - valueRight);
    })
  );
  expect(tideMetricAlignment.length).toBeGreaterThan(0);
  expect(Math.max(...tideMetricAlignment)).toBeLessThanOrEqual(1);
  const firstSelectionMs = Date.now() - firstSelectionStarted;
  const firstTiming = await page.locator('#tideStatus').evaluate(node => ({
    assetResolution: Number(node.dataset.assetResolutionMs),
    prediction: Number(node.dataset.predictionMs),
    chartRender: Number(node.dataset.chartRenderMs)
  }));

  const coefficientChunk = 'data/tides/eot20-v1/coeff/26_11.bin.gz';
  const coefficientRequestsAfterFirstSelection = tideAssetRequests.filter(url => url.includes(coefficientChunk)).length;
  expect(coefficientRequestsAfterFirstSelection).toBeGreaterThan(0);
  const nearby = await page.evaluate(() => {
    const map = window.__DIVEATLAS_TEST__.map;
    const pixel = map.latLngToContainerPoint([44.8, -124.95]);
    const rect = document.getElementById('map').getBoundingClientRect();
    return { x: rect.left + pixel.x, y: rect.top + pixel.y };
  });
  await page.mouse.click(nearby.x, nearby.y);
  await expect(page.locator('#tideStatus')).toContainText('estimate ready');
  expect(tideAssetRequests.filter(url => url.includes(coefficientChunk))).toHaveLength(coefficientRequestsAfterFirstSelection);
  const assetBodies = await Promise.all(tideAssetResponses);
  const nonLocalAssets = tideAssetRequests.filter(url => !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url));
  expect(nonLocalAssets).toEqual([]);
  const tideLongTasks = await page.evaluate(startIndex => window.__tideLongTasks.slice(startIndex), longTaskStartIndex);
  console.log('Tide browser measurements', JSON.stringify({
    firstSelectionMs, firstRequestBytes: assetBodies.reduce((sum, item) => sum + item.bytes, 0),
    cachedNearbyRequestCount: tideAssetRequests.length - assetBodies.length,
    modelAssetBytes: assetBodies.filter(item => item.url.includes('/coeff/')).reduce((sum, item) => sum + item.bytes, 0),
    timezoneAssetBytes: assetBodies.filter(item => item.url.includes('/timezones-')).reduce((sum, item) => sum + item.bytes, 0),
    firstTiming, tideLongTasks, maxTideLongTaskMs: Math.max(0, ...tideLongTasks)
  }));
});
