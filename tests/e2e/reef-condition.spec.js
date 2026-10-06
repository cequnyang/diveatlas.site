'use strict';

const { test, expect } = require('@playwright/test');
const { openMap } = require('./support');

async function openReefView(page, testInfo) {
  if (testInfo.project.name.includes('mobile')) {
    if (await page.locator('#bioLegend').evaluate(element => element.classList.contains('is-collapsed'))) {
      await page.locator('#bioLegendTitle').click();
    }
    await page.locator('.environment-segment-group').evaluate(group => { group.scrollLeft = group.scrollWidth; });
  }
  await page.locator('.environment-segment').filter({
    has:page.locator('input[name="environmentView"][value="reef-survey-condition"]')
  }).click();
  await expect(page.locator('#reefSurveyConditionControls')).toBeVisible();
}

test('Reef Condition stays lazy and exposes only the supported NOAA pressure metrics', async ({ page }, testInfo) => {
  const requests = [];
  page.on('request', request => {
    if (/reef-survey-condition-view\.js|\/data\/reef-condition\//.test(request.url())) requests.push(request.url());
  });
  await openMap(page);
  expect(requests).toEqual([]);

  await openReefView(page, testInfo);
  const metrics = page.locator('#reefSurveyMetric');
  await expect(metrics.locator('optgroup[label="Environmental pressure"] option')).toHaveCount(2);
  await expect(metrics.locator('optgroup[data-local-research-metrics]')).toHaveCount(0);
  await expect(metrics).toHaveValue('oceanHeatHistory');
  await expect(page.locator('[data-reef-condition-raster-legend]')).toContainText('OCEAN HEAT HISTORY');
  await expect(page.locator('[data-reef-survey-error]')).toBeHidden();
  await expect.poll(() => requests.filter(url => url.endsWith('/metadata.json')).length).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().layerVisible)).toBe(true);
  expect(requests.some(url => url.endsWith('/field-observations.json'))).toBe(false);

  await metrics.selectOption('thermalStressHistory');
  await expect(page.locator('[data-reef-condition-raster-legend]')).toContainText('THERMAL STRESS HISTORY');
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().providerId))
    .toBe('noaa-crw-thermal-history');
  expect(requests.some(url => url.endsWith('/field-observations.json'))).toBe(false);
});

test('Reef Condition never falls back to development survey fixtures', async ({ page }, testInfo) => {
  const fixtureRequests = [];
  page.on('request', request => {
    if (/mock-raja-ampat\.json|data\/\.build\/reef_condition|field-observations\.json/.test(request.url())) {
      fixtureRequests.push(request.url());
    }
  });
  await openMap(page);
  await openReefView(page, testInfo);
  await expect(page.locator('[data-reef-survey-error]')).toBeHidden();
  await expect(page.locator('#reefSurveyMetric')).toHaveValue('oceanHeatHistory');
  expect(fixtureRequests).toEqual([]);
});
