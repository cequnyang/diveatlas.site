const { test, expect } = require('@playwright/test');
const fixture = require('../fixtures/reef-condition/mock-raja-ampat.json');
const { openMap } = require('./support');

async function openReefCondition(page, testInfo) {
  await openMap(page, { url: '/?__diveatlas_test=1&lat=-5.7&lng=131&z=5' });
  if (testInfo.project.name.includes('mobile')) {
    if (await page.locator('#bioLegend').evaluate(element => element.classList.contains('is-collapsed'))) await page.locator('#bioLegendTitle').click();
    await page.locator('.environment-segment-group').evaluate(group => { group.scrollLeft = group.scrollWidth; });
  }
  await page.locator('.environment-segment').filter({ has: page.locator('input[name="environmentView"][value="reef-survey-condition"]') }).click();
  await page.getByRole('button', { name: 'Map layers' }).click();
  await page.locator('#reefSurveyConditionControls').waitFor({ state: 'visible' });
}

test('Ocean Heat History popup uses the shared width for its device size', async ({ page }, testInfo) => {
  await page.route('**/data/reef-condition/field-observations.json', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(fixture)
  }));
  await openReefCondition(page, testInfo);
  const metric = page.locator('#reefSurveyMetric');
  await metric.selectOption('oceanHeatHistory');
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().providerId))
    .toBe('noaa-crw-ocean-heat-history');
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().layerVisible)).toBe(true);
  if (testInfo.project.name.includes('mobile')) await page.getByRole('button', { name: 'Map layers' }).click();
  await page.evaluate(() => window.__DIVEATLAS_TEST__.map.fire('click', { latlng: window.L.latLng(-5.7, 131) }));
  const popup = page.locator('.leaflet-popup.reef-condition-ocean-heat-popup').last();
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('Ocean heat history');
  const width = await popup.evaluate(element => element.getBoundingClientRect().width);
  expect(width).toBeCloseTo(testInfo.project.name.includes('mobile') ? 320 : 360, 0);
});

test('Ocean Heat History is lazy, query-cached, and independent from reef stress and field observations', async ({ page }, testInfo) => {
  const oceanRequests = [];
  page.on('request', request => {
    if (request.url().includes('/data/reef-condition/ocean-heat-history/')) oceanRequests.push(request.url());
    expect(request.url()).not.toContain('coralreefwatch.noaa.gov');
  });
  await page.route('**/data/reef-condition/field-observations.json', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(fixture)
  }));

  await openReefCondition(page, testInfo);
  const metric = page.locator('#reefSurveyMetric');
  await expect(metric.locator('optgroup[label="Observed condition"] option')).toHaveCount(9);
  await expect(metric.locator('optgroup[label="Environmental pressure"] option')).toHaveCount(2);
  expect(oceanRequests).toHaveLength(0);

  await metric.selectOption('oceanHeatHistory');
  await expect(page.locator('[data-reef-condition-raster-legend]')).toContainText('OCEAN HEAT HISTORY');
  await expect(page.locator('[data-reef-condition-raster-legend]')).toContainText('Recent decade · 2016–2025');
  await expect(page.locator('[data-reef-condition-raster-legend]')).toContainText('Worst marine heatwave category');
  for (const category of ['No marine heatwave', 'Moderate', 'Strong', 'Severe', 'Extreme', 'Beyond extreme']) {
    await expect(page.locator('[data-reef-condition-raster-legend]')).toContainText(category);
  }
  await expect(page.locator('[data-reef-condition-raster-note]')).toContainText('not a direct observation of reef bleaching or coral mortality');
  await expect.poll(() => oceanRequests.some(url => url.endsWith('/metadata.json'))).toBe(true);
  await expect.poll(() => oceanRequests.some(url => /\/tiles\//.test(url))).toBe(true);
  expect(oceanRequests.filter(url => url.endsWith('/metadata.json'))).toHaveLength(1);
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().providerId))
    .toBe('noaa-crw-ocean-heat-history');
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().layerVisible)).toBe(true);

  if (testInfo.project.name.includes('mobile')) {
    await page.getByRole('button', { name: 'Map layers' }).click();
  }
  await page.evaluate(() => window.__DIVEATLAS_TEST__.map.fire('click', { latlng: window.L.latLng(-5.7, 131) }));
  const popup = page.locator('.reef-condition-ocean-heat-popup').last();
  await expect(popup).toBeVisible();
  const oceanPopupWidth = await popup.evaluate(element => element.getBoundingClientRect().width);
  expect(oceanPopupWidth).toBeCloseTo(testInfo.project.name.includes('mobile') ? 320 : 360, 0);
  await expect(popup).toContainText('Ocean heat history');
  await expect(popup).toContainText('Peak severity');
  await expect(popup).toContainText('Heatwave days');
  await expect(popup).toContainText('Strong+ days');
  await expect(popup).toContainText('Severe+ days');
  await expect(popup).toContainText('Longest event');
  await expect(popup).toContainText('NOAA Coral Reef Watch');
  await expect.poll(() => oceanRequests.filter(url => /\/query\//.test(url)).length).toBe(1);
  await page.evaluate(() => window.__DIVEATLAS_TEST__.map.fire('click', { latlng: window.L.latLng(-5.7, 131) }));
  await expect.poll(() => oceanRequests.filter(url => /\/query\//.test(url)).length).toBe(1);

  if (testInfo.project.name.includes('mobile')) {
    const layout = await popup.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const panel = document.getElementById('bioLegend');
      const panelRect = panel.getBoundingClientRect();
      const overlapWidth = Math.max(0, Math.min(rect.right, panelRect.right) - Math.max(rect.left, panelRect.left));
      const overlapHeight = Math.max(0, Math.min(rect.bottom, panelRect.bottom) - Math.max(rect.top, panelRect.top));
      return {
        left: rect.left, right: rect.right, width: rect.width, viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth, panelCollapsed: panel.classList.contains('is-collapsed'),
        panelOverlap: overlapWidth * overlapHeight
      };
    });
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(layout.viewport);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport);
    expect(layout.panelCollapsed).toBe(true);
    expect(layout.panelOverlap).toBe(0);
    await expect(popup).toContainText('Source');
    await page.getByRole('button', { name: 'Map layers' }).click();
  }

  await metric.selectOption('thermalStressHistory');
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().providerId))
    .toBe('noaa-crw-thermal-history');
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().layerVisible)).toBe(true);
  await expect(page.locator('[data-reef-condition-raster-legend]')).toContainText('THERMAL STRESS HISTORY');
  await expect(page.locator('[data-reef-condition-raster-note]')).toContainText('reef-focused accumulated heat stress');

  await metric.selectOption('liveCoralCoverPct');
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().providerId)).toBe('field-observations');
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().markerCount)).toBe(fixture.records.length);
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().surveyLayerVisible)).toBe(true);

  await metric.selectOption('oceanHeatHistory');
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().providerId))
    .toBe('noaa-crw-ocean-heat-history');
  await expect(page.locator('[data-reef-condition-raster-legend]')).toContainText('OCEAN HEAT HISTORY');
  await expect(page.locator('[data-reef-condition-raster-legend]')).not.toContainText('THERMAL STRESS HISTORY');
  expect(oceanRequests.filter(url => url.endsWith('/metadata.json'))).toHaveLength(1);
});
