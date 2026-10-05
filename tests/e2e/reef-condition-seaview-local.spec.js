const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { openMap } = require('./support');

const SCREENSHOT_DIR = path.resolve('data/.build/reef_condition/seaview/screenshots');
const CANONICAL_BUNDLE = path.resolve('data/.build/reef_condition/seaview/canonical.json.gz');
test.setTimeout(120_000);

function screenshotName(testInfo, name) {
  const platform = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
  return path.join(SCREENSHOT_DIR, `${platform}-${name}.png`);
}

async function moveMap(page, lat, lon, zoom) {
  await page.evaluate(() => { window.__DIVEATLAS_TEST__.map.closePopup(); });
  await page.evaluate(([nextLat, nextLon, nextZoom]) => {
    window.__DIVEATLAS_TEST__.setView(nextLat, nextLon, nextZoom);
  }, [lat, lon, zoom]);
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getState().zoom)).toBe(zoom);
}

async function openReefCondition(page, mobile) {
  if (mobile) {
    if (await page.locator('#bioLegend').evaluate(element => element.classList.contains('is-collapsed'))) {
      await page.locator('#bioLegendTitle').click();
    }
    await page.locator('.environment-segment-group').evaluate(group => { group.scrollLeft = group.scrollWidth; });
  }
  const tab = page.locator('input[name="environmentView"][value="reef-survey-condition"]');
  await page.locator('.environment-segment').filter({ has: tab }).click();
  await page.getByRole('button', { name: 'Map layers' }).click();
  await expect(page.locator('#reefSurveyMetric')).toBeVisible();
}

test('Seaview selectors are absent when local research mode is not enabled', async ({ page }, testInfo) => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const requests = [];
  page.on('request', request => {
    if (/reef-condition-local-research|\.build\/reef_condition\/seaview/i.test(request.url())) requests.push(request.url());
  });
  await openMap(page, { url: '/?__diveatlas_test=1&lat=0&lng=0&z=2' });
  await openReefCondition(page, testInfo.project.name.includes('mobile'));
  const metric = page.locator('#reefSurveyMetric');
  await expect(metric.locator('option[value="seaviewHardCoralCoverPct"]')).toHaveCount(0);
  await expect(metric.locator('option[value="seaviewMacroalgaeCoverPct"]')).toHaveCount(0);
  expect(requests).toEqual([]);
  await page.screenshot({ path: screenshotName(testInfo, 'production-seaview-absent'), animations: 'disabled' });
});

test('local Seaview metrics render site observations, resolve repeats, and switch providers cleanly', async ({ page }, testInfo) => {
  test.skip(!fs.existsSync(CANONICAL_BUNDLE), 'The ignored local Seaview research bundle is not present in this checkout.');
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const requests = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/\.build\/reef_condition\/seaview/i.test(request.url())) requests.push(request.url());
  });
  const mobile = testInfo.project.name.includes('mobile');
  const flagUrl = '/?__diveatlas_test=1&reefConditionLocalResearch=1&lat=0&lng=0&z=2';
  await openMap(page, { url: flagUrl });
  await openReefCondition(page, mobile);

  const metric = page.locator('#reefSurveyMetric');
  await expect(metric.locator('optgroup[data-local-research-metrics] option[value="seaviewHardCoralCoverPct"]')).toHaveCount(1);
  await expect(metric.locator('option[value="seaviewHardCoralCoverPct"]')).toHaveText('Hard Coral Cover');
  await expect(metric.locator('option[value="seaviewMacroalgaeCoverPct"]')).toHaveText('Macroalgae Cover');
  expect(requests.filter(url => /metadata\.json|canonical\.json\.gz/.test(url))).toEqual([],
    'opening Reef Condition registers the local metrics without fetching their data');

  const heapBeforeActivation = await page.evaluate(() => performance.memory?.usedJSHeapSize || null);
  const firstActivationStart = await page.evaluate(() => performance.now());
  await metric.selectOption('seaviewHardCoralCoverPct');
  await expect(page.locator('[data-reef-survey-dataset-status]')).toHaveText('Seaview Survey · Local research');
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().recordCount)).toBe(860);
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().markerCount)).toBe(579);
  const firstActivationMs = await page.evaluate(start => performance.now() - start, firstActivationStart);
  const heapAfterActivation = await page.evaluate(() => performance.memory?.usedJSHeapSize || null);
  const globalHard = await page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState());
  expect(globalHard.providerId).toBe('seaview-local-research');
  expect(globalHard.sourceSiteCount).toBe(579);
  expect(globalHard.siteObservationCount).toBe(579);
  expect(globalHard.uniqueMarkerKeyCount).toBe(579);
  expect(globalHard.sourceMetadata.dateRange).toEqual({ from: '2012-09-16', to: '2018-06-18' });
  expect(globalHard.sourceMetadata.licenseDisplay).toBe('License under clarification — local evaluation only');
  expect(globalHard.visibleMarkerCount).toBeGreaterThan(0);
  await expect(page.locator('[data-reef-survey-legend]')).toContainText('0–10%');
  await expect(page.locator('[data-reef-survey-legend]')).toContainText('75–100%');
  await expect(page.locator('[data-reef-survey-legend]')).toContainText('Most observations are from 2012–2018');
  expect(requests.filter(url => url.endsWith('/metadata.json'))).toHaveLength(1);
  expect(requests.filter(url => url.endsWith('/canonical.json.gz'))).toHaveLength(1);
  await page.screenshot({ path: screenshotName(testInfo, 'hard-coral-global'), animations: 'disabled' });

  const repeated = globalHard.siteObservationPreview.find(site => site.sourceSiteId === '10001');
  expect(repeated).toBeTruthy();
  expect(repeated.repeatCount).toBe(4);
  expect(repeated.metrics.hardCoralCover.status).toBe('unique');
  expect(repeated.metrics.macroalgaeCover.status).toBe('unique');
  expect(repeated.metrics.hardCoralCover.observationDate).toBe(repeated.metrics.macroalgaeCover.observationDate);
  expect(repeated.metrics.hardCoralCover.ageDays).toBeGreaterThan(3000);

  if (!mobile) {
    const globalVisibleCount = globalHard.visibleMarkerCount;
    await moveMap(page, 23, -74, 5);
    const atlantic = await page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState());
    await page.screenshot({ path: screenshotName(testInfo, 'hard-coral-caribbean-bermuda'), animations: 'disabled' });

    await moveMap(page, -18, 147, 6);
    const greatBarrierVisible = await page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().visibleMarkerCount);
    await page.screenshot({ path: screenshotName(testInfo, 'hard-coral-great-barrier-reef'), animations: 'disabled' });
    await moveMap(page, -3.5, 130, 5);
    const coralTriangleVisible = await page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().visibleMarkerCount);
    await page.screenshot({ path: screenshotName(testInfo, 'hard-coral-coral-triangle'), animations: 'disabled' });
    await moveMap(page, -15, 146, 8);
    const denseLocalVisible = await page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().visibleMarkerCount);
    await page.screenshot({ path: screenshotName(testInfo, 'hard-coral-dense-local'), animations: 'disabled' });

    await moveMap(page, repeated.lat + 0.12, repeated.lon, 11);
    await page.getByRole('button', { name: 'Map layers' }).click();
    expect(await page.evaluate(siteId => window.__DIVEATLAS_TEST__.openReefSurveySourceSitePopup(siteId), repeated.sourceSiteId)).toBe(true);
    const popup = page.locator('.reef-survey-popup');
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('HARD CORAL COVER');
    await expect(popup).toContainText('Observed');
    await expect(popup).toContainText('Data age');
    await expect(popup).toContainText('Seaview Survey');
    await expect(popup).toContainText('License under clarification — local evaluation only');
    await expect(popup).toContainText('4 surveys');
    await page.screenshot({ path: screenshotName(testInfo, 'hard-coral-repeat-site-popup'), animations: 'disabled' });

    await page.getByRole('button', { name: 'Map layers' }).click();
    const switchStart = await page.evaluate(() => performance.now());
    await metric.selectOption('seaviewMacroalgaeCoverPct');
    await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().metric)).toBe('seaviewMacroalgaeCoverPct');
    const metricSwitchMs = await page.evaluate(start => performance.now() - start, switchStart);
    expect(requests.filter(url => url.endsWith('/metadata.json'))).toHaveLength(1);
    expect(requests.filter(url => url.endsWith('/canonical.json.gz'))).toHaveLength(1);
    await moveMap(page, 0, 0, 2);
    await page.screenshot({ path: screenshotName(testInfo, 'macroalgae-global'), animations: 'disabled' });
    await moveMap(page, -15, 146, 7);
    await page.screenshot({ path: screenshotName(testInfo, 'macroalgae-dense-region'), animations: 'disabled' });
    await moveMap(page, repeated.lat + 0.12, repeated.lon, 11);
    await page.getByRole('button', { name: 'Map layers' }).click();
    expect(await page.evaluate(siteId => window.__DIVEATLAS_TEST__.openReefSurveySourceSitePopup(siteId), repeated.sourceSiteId)).toBe(true);
    await expect(page.locator('.reef-survey-popup')).toContainText('MACROALGAE COVER');
    await expect(page.locator('.reef-survey-popup')).toContainText('Data age');
    await page.screenshot({ path: screenshotName(testInfo, 'macroalgae-repeat-site-popup'), animations: 'disabled' });

    await page.getByRole('button', { name: 'Map layers' }).click();
    await metric.selectOption('oceanHeatHistory');
    await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().providerId)).toBe('noaa-crw-ocean-heat-history');
    let switched = await page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState());
    expect(switched.surveyLayerVisible).toBe(false);
    expect(switched.markerCount).toBe(0);
    await metric.selectOption('thermalStressHistory');
    await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().providerId)).toBe('noaa-crw-thermal-history');
    await metric.selectOption('liveCoralCoverPct');
    await expect(page.locator('[data-reef-survey-dataset-status]')).toHaveText('Unavailable');
    await expect(page.locator('[data-reef-survey-error]')).toBeVisible();
    const restoredSeaviewStart = await page.evaluate(() => performance.now());
    await metric.selectOption('seaviewHardCoralCoverPct');
    await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().markerCount)).toBe(579);
    const restoredSeaviewMs = await page.evaluate(start => performance.now() - start, restoredSeaviewStart);

    console.log(JSON.stringify({
      project: testInfo.project.name,
      events: globalHard.recordCount,
      sites: globalHard.sourceSiteCount,
      globalVisibleSiteMarkers: globalVisibleCount,
      atlanticVisibleSiteMarkers: atlantic.visibleMarkerCount,
      greatBarrierVisibleSiteMarkers: greatBarrierVisible,
      coralTriangleVisibleSiteMarkers: coralTriangleVisible,
      denseLocalVisibleSiteMarkers: denseLocalVisible,
      repeatExample: {
        sourceSiteId: repeated.sourceSiteId,
        repeats: repeated.repeatCount,
        hardCoralObservationDate: repeated.metrics.hardCoralCover.observationDate,
        macroalgaeObservationDate: repeated.metrics.macroalgaeCover.observationDate,
        hardCoralValue: repeated.metrics.hardCoralCover.value,
        macroalgaeValue: repeated.metrics.macroalgaeCover.value
      },
      firstActivationMs: Math.round(firstActivationMs),
      browserHeapDeltaBytes: heapBeforeActivation == null || heapAfterActivation == null
        ? null
        : heapAfterActivation - heapBeforeActivation,
      metricSwitchMs: Math.round(metricSwitchMs),
      restoredSeaviewMs: Math.round(restoredSeaviewMs),
      browserHeapBytes: await page.evaluate(() => performance.memory?.usedJSHeapSize || null),
      localResources: await page.evaluate(() => performance.getEntriesByType('resource')
        .filter(entry => entry.name.includes('/data/.build/reef_condition/seaview/'))
        .map(entry => ({ url: new URL(entry.name).pathname, encodedBytes: entry.encodedBodySize, decodedBytes: entry.decodedBodySize, durationMs: Math.round(entry.duration) }))),
      requestCount: requests.length
    }));
  } else {
    const popupSite = globalHard.siteObservationPreview.find(site => site.sourceSiteId === '10001');
    await moveMap(page, popupSite.lat + 0.22, popupSite.lon, 11);
    await page.getByRole('button', { name: 'Map layers' }).click();
    expect(await page.evaluate(siteId => window.__DIVEATLAS_TEST__.openReefSurveySourceSitePopup(siteId), popupSite.sourceSiteId)).toBe(true);
    const popup = page.locator('.reef-survey-popup');
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('License under clarification — local evaluation only');
    await expect(popup).toContainText('https://doi.org/10.1038/s41597-020-00698-6');
    await expect(popup).toContainText('Data age');
    const popupBounds = await popup.boundingBox();
    expect(popupBounds.x).toBeGreaterThanOrEqual(0);
    expect(popupBounds.y).toBeGreaterThanOrEqual(0);
    expect(popupBounds.y + popupBounds.height).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));
    expect(popupBounds.x + popupBounds.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
    const collapsedLayersBounds = await page.locator('#bioLegend').boundingBox();
    expect(popupBounds.y + popupBounds.height).toBeLessThanOrEqual(collapsedLayersBounds.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
    await page.screenshot({ path: screenshotName(testInfo, 'hard-coral-mobile-popup'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Map layers' }).click();
    await metric.selectOption('seaviewMacroalgaeCoverPct');
    await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().metric)).toBe('seaviewMacroalgaeCoverPct');
    await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().markerCount)).toBe(579);
    expect(requests.filter(url => url.endsWith('/metadata.json'))).toHaveLength(1);
    expect(requests.filter(url => url.endsWith('/canonical.json.gz'))).toHaveLength(1);
    await page.getByRole('button', { name: 'Map layers' }).click();
    await page.evaluate(() => { window.__DIVEATLAS_TEST__.map.closePopup(); });
    await moveMap(page, 0, 0, 2);
    await page.screenshot({ path: screenshotName(testInfo, 'macroalgae-global'), animations: 'disabled' });
  }
  expect(errors).toEqual([]);
});
