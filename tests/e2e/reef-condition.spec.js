const { test, expect } = require('@playwright/test');
const zlib = require('node:zlib');
const fixture = require('../fixtures/reef-condition/mock-raja-ampat.json');
const { openMap, setMapView } = require('./support');

test('Reef Condition loads injected test surveys on demand and reuses markers', async ({ page }, testInfo) => {
  page.on('pageerror', error => console.error('Page error:', error));
  const requests = [];
  page.on('request', request => {
    if (request.url().includes('reef-survey-condition-view.js') || request.url().includes('reef-condition-provider.js') || request.url().includes('field-observations.json') || request.url().includes('mock-raja-ampat.json')) requests.push(request.url());
  });
  await page.route('**/data/reef-condition/field-observations.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }));
  await openMap(page);
  if (testInfo.project.name.includes('mobile')) {
    if (await page.locator('#bioLegend').evaluate(element => element.classList.contains('is-collapsed'))) {
      await page.locator('#bioLegendTitle').click();
    }
    await page.locator('.environment-segment-group').evaluate(group => { group.scrollLeft = group.scrollWidth; });
  }
  const tab = page.locator('input[name="environmentView"][value="reef-survey-condition"]');
  await expect(tab).toHaveCount(1);
  await expect(page.locator('#reefSurveyConditionControls')).toBeHidden();
  expect(requests).toEqual([]);

  await page.locator('.environment-segment').filter({ has: tab }).click();
  await expect(page.locator('#reefSurveyConditionControls')).toBeVisible();
  await expect(page.locator('[data-reef-survey-dataset-status]')).toHaveText('DiveAtlas synthetic fixture');
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().recordCount)).toBe(30);
  expect(requests.filter(url => url.includes('reef-survey-condition-view.js'))).toHaveLength(1);
  expect(requests.filter(url => url.includes('reef-condition-provider.js'))).toHaveLength(1);
  expect(requests.filter(url => url.includes('field-observations.json'))).toHaveLength(1);
  expect(requests.some(url => url.includes('mock-raja-ampat.json'))).toBe(false);
  await page.getByRole('button', { name: 'Map layers' }).click();
  await expect(page.locator('[data-reef-survey-metric]')).toHaveValue('liveCoralCoverPct');
  await expect(page.locator('[data-reef-survey-legend]')).toContainText('Live coral cover');

  await setMapView(page, -0.558, 130.679, 11);
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().markerCount)).toBe(30);
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().layerVisible)).toBe(true);
  await expect(page.locator('#map canvas').first()).toBeVisible();

  const initialColors = await page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().markerColors);
  await page.locator('[data-reef-survey-metric]').selectOption('bleachingPct');
  const changed = await page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState());
  expect(changed.metric).toBe('bleachingPct');
  expect(changed.markerColors).not.toEqual(initialColors);
  await page.getByRole('button', { name: 'Map layers' }).click();
  expect(await page.evaluate(() => window.__DIVEATLAS_TEST__.openReefSurveyPopup('Cape Kri'))).toBe(true);
  await expect(page.locator('.reef-survey-popup')).toBeVisible();
  await expect(page.locator('.reef-survey-popup')).toContainText('Cape Kri');
  await expect(page.locator('.reef-survey-popup')).toContainText('May 2023');
  await expect(page.locator('.reef-survey-popup')).toContainText('DiveAtlas synthetic fixture');
  await expect(page.locator('.reef-survey-popup')).toContainText('Disease');
  await expect(page.locator('.reef-survey-popup')).toContainText('—');
  await expect(page.locator('.reef-survey-popup')).not.toContainText('Disease 0%');

  await page.getByRole('button', { name: 'Map layers' }).click();
  const reef = page.locator('#reefLayerToggle');
  const coral = page.locator('#speciesLayerToggle');
  await expect(reef).toBeEnabled();
  await expect(coral).toBeEnabled();
  await page.locator('label[for="speciesLayerToggle"]').click();
  await expect(coral).toBeChecked();
  await page.locator('label[for="reefLayerToggle"]').click();
  await expect(reef).not.toBeChecked();
  await page.locator('label[for="reefLayerToggle"]').click();
  await page.locator('label[for="speciesLayerToggle"]').click();

  await page.locator('#environmentViewSelect').selectOption('terrain');
  await expect(page.locator('#reefSurveyConditionControls')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().layerVisible)).toBe(false);
  await page.locator('#environmentViewSelect').selectOption('reef-survey-condition');
  await expect(page.locator('#reefSurveyConditionControls')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().layerVisible)).toBe(true);
  expect(requests.filter(url => url.includes('reef-survey-condition-view.js'))).toHaveLength(1);
  expect(requests.filter(url => url.includes('field-observations.json'))).toHaveLength(1);
});

test('missing production Reef Condition data shows unavailable and never falls back to test fixtures', async ({ page }, testInfo) => {
  const requested = [];
  page.on('request', request => {
    if (request.url().includes('field-observations.json') || request.url().includes('mock-raja-ampat.json') || request.url().includes('.build/')) requested.push(request.url());
  });
  await openMap(page, { url: '/?__diveatlas_test=1&lat=-5.7&lng=131&z=7' });
  if (testInfo.project.name.includes('mobile')) {
    if (await page.locator('#bioLegend').evaluate(element => element.classList.contains('is-collapsed'))) {
      await page.locator('#bioLegendTitle').click();
    }
    await page.locator('.environment-segment-group').evaluate(group => { group.scrollLeft = group.scrollWidth; });
  }
  const tab = page.locator('input[name="environmentView"][value="reef-survey-condition"]');
  await page.locator('.environment-segment').filter({ has: tab }).click();
  await expect(page.locator('[data-reef-survey-dataset-status]')).toHaveText('Unavailable');
  await expect(page.locator('[data-reef-survey-error]')).toBeVisible();
  const state = await page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState());
  expect(state.recordCount).toBe(0);
  expect(state.markerCount).toBe(0);
  expect(state.layerVisible).toBe(false);
  expect(requested.some(url => url.includes('field-observations.json'))).toBe(true);
  expect(requested.some(url => url.includes('mock-raja-ampat.json') || url.includes('.build/'))).toBe(false);
});
