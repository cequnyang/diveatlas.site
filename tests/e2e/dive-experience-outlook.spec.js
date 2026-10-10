'use strict';

const { test, expect } = require('@playwright/test');
const { openMap, setMapView } = require('./support');

async function setLegendCollapsed(page, collapsed) {
  const isCollapsed = await page.locator('#bioLegend').evaluate(node => node.classList.contains('is-collapsed'));
  if (isCollapsed !== collapsed) await page.locator('#bioLegendTitle').click();
}

async function waitForMapInteractionWindow(page) {
  await expect.poll(() => page.evaluate(() => {
    const state = window.__DIVEATLAS_TEST__.getState();
    return !state.pendingInteraction && !state.activePointerGesture && performance.now() >= state.suppressedUntil;
  })).toBe(true);
}

test('Dive Experience Outlook loads the selected month on demand and explains a selected cell', async ({ page }) => {
  const outlookRequests = [];
  page.on('request', request => {
    if (request.url().includes('/js/dive-experience-outlook-map.js') ||
        request.url().includes('/data/dive-experience-outlook/')) outlookRequests.push(request.url());
  });

  await openMap(page);
  expect(outlookRequests).toEqual([]);
  const month = await page.locator('#diveExperienceMonth').inputValue();
  const monthAsset = `month-${String(month).padStart(2, '0')}.bin.gz`;
  await setMapView(page, -5.7, 131, 7);
  await setLegendCollapsed(page, false);
  await page.locator('.environment-segment-group').evaluate(track => { track.scrollLeft = 0; });
  const activationStarted = Date.now();
  await page.locator('.environment-segment').filter({
    has:page.locator('input[name="environmentView"][value="dive-experience-outlook"]')
  }).click();
  await expect(page.locator('#diveExperienceOutlookPanel')).toBeVisible();
  await expect(page.locator('#diveExperienceOutlookStatus')).toContainText('Historical monthly outlook');
  if (test.info().project.name === 'mobile-touch-chromium') {
    const panelLayout = await page.evaluate(() => {
      const panel = document.querySelector('#diveExperienceOutlookPanel');
      const month = document.querySelector('#diveExperienceMonth');
      const panelRect = panel.getBoundingClientRect();
      const monthRect = month.getBoundingClientRect();
      return {
        panelHasHorizontalOverflow:panel.scrollWidth > panel.clientWidth,
        monthVisible:getComputedStyle(month).visibility !== 'hidden' && monthRect.width > 0,
        monthFitsPanel:monthRect.left >= panelRect.left && monthRect.right <= panelRect.right
      };
    });
    expect(panelLayout.panelHasHorizontalOverflow).toBe(false);
    expect(panelLayout.monthVisible).toBe(true);
    expect(panelLayout.monthFitsPanel).toBe(true);
  }
  await expect.poll(() => outlookRequests.some(url => url.endsWith('/manifest.json'))).toBe(true);
  await expect.poll(() => outlookRequests.some(url => url.endsWith(`/${monthAsset}`))).toBe(true);
  expect(outlookRequests.filter(url => /month-\d{2}\.bin\.gz$/.test(url))).toEqual(
    expect.arrayContaining([expect.stringContaining(`/${monthAsset}`)])
  );
  expect(outlookRequests.filter(url => /month-\d{2}\.bin\.gz$/.test(url))).toHaveLength(1);
  await expect.poll(() => page.evaluate(() => window.DiveAtlasDiveExperienceMap?.getRenderDiagnostics().tileCount || 0)).toBeGreaterThan(0);
  const activationMs = Date.now() - activationStarted;
  await expect(page.locator('.dive-experience-outlook-scale-labels')).toContainText('ChallengingFairGoodExcellent');
  await expect(page.locator('#diveExperienceOutlookPanel')).toContainText('not a dive-safety rating');
  await setLegendCollapsed(page, true);
  await page.evaluate(() => {
    const layer = Object.values(window.__DIVEATLAS_TEST__.map._layers)
      .find(candidate => candidate.options?.className === 'dive-experience-outlook-grid');
    window.__diveExperienceRedrawsAfterActivation = 0;
    const redraw = layer.redraw;
    layer.redraw = function (...args) {
      window.__diveExperienceRedrawsAfterActivation += 1;
      return redraw.apply(this, args);
    };
  });

  const popupStarted = Date.now();
  if (test.info().project.name === 'mobile-touch-chromium') {
    const tapPoint = await page.evaluate(() => {
      const map = window.__DIVEATLAS_TEST__.map;
      const container = map.getContainer();
      const bounds = container.getBoundingClientRect();
      const size = map.getSize();
      const center = { x:size.x / 2, y:size.y / 2 };
      const offsets = [];
      for (let radius = 8; radius <= 48; radius += 8) {
        for (const [dx, dy] of [[radius,0],[-radius,0],[0,radius],[0,-radius],
          [radius,radius],[-radius,radius],[radius,-radius],[-radius,-radius]]) offsets.push([dx,dy]);
      }
      offsets.sort((a,b) => a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2);
      for (const [dx,dy] of offsets) {
        const x = center.x + dx;
        const y = center.y + dy;
        const screenX = bounds.left + x;
        const screenY = bounds.top + y;
        if (screenX < 0 || screenX >= innerWidth || screenY < 0 || screenY >= innerHeight) continue;
        const element = document.elementFromPoint(screenX, screenY);
        if (element?.closest('.leaflet-marker-pane .leaflet-interactive, .leaflet-marker-icon, .map-count-cluster, .leaflet-popup, button, a, input')) continue;
        const location = map.containerPointToLatLng([x,y]);
        return { x:screenX, y:screenY, lat:location.lat, lng:location.lng };
      }
      return null;
    });
    expect(tapPoint).not.toBeNull();
    await page.touchscreen.tap(tapPoint.x, tapPoint.y);
  } else {
    await waitForMapInteractionWindow(page);
    const interaction = await page.evaluate(() => window.__DIVEATLAS_TEST__.resolveMapInteraction({ lat:-5.7, lng:131 }));
    expect(interaction).toBe('dive-experience-outlook-location-selected');
    await expect(page.locator('#diveExperienceOutlookStatus')).toContainText('Historical monthly outlook', { timeout:10000 });
  }
  const popup = page.locator('.dive-experience-popup-content');
  await expect(popup).toBeVisible({ timeout:15000 });
  expect(await page.evaluate(() => window.__diveExperienceRedrawsAfterActivation)).toBe(0);
  const popupLatencyMs = Date.now() - popupStarted;
  const popupHeading = popup.locator('.dive-conditions-popup-title');
  await expect(popupHeading).toHaveAttribute('aria-label', 'DiveAtlas Rating');
  await expect(popupHeading.locator('.dive-brand-rating-logo')).toBeVisible();
  await page.locator('html').evaluate(node => { node.dataset.theme = 'light'; });
  await expect.poll(() => popupHeading.evaluate(node => getComputedStyle(node).color)).toMatch(/^rgb\(/);
  const lightHeadingColor = await popupHeading.evaluate(node => getComputedStyle(node).color);
  await page.locator('html').evaluate(node => { node.dataset.theme = 'dark'; });
  await expect.poll(() => popupHeading.evaluate(node => getComputedStyle(node).color))
    .not.toBe(lightHeadingColor);
  const darkHeadingColor = await popupHeading.evaluate(node => getComputedStyle(node).color);
  await page.locator('html').evaluate(node => { node.dataset.theme = 'light'; });
  await expect.poll(() => popupHeading.evaluate(node => getComputedStyle(node).color))
    .toBe(lightHeadingColor);
  expect(darkHeadingColor).not.toBe(lightHeadingColor);
  await expect(popup).toContainText('Confidence:');
  await expect(popup).toContainText(/\d+ of 7 dimensions available/);
  await expect(popup).toContainText('Dive Conditions');
  await expect(popup).toContainText('Reef habitat & coral evidence');
  const scoreBefore = await popup.locator('.dive-experience-main-score').innerText();
  const scoreInfoPopover = page.locator('.dive-experience-popup-info-popover');
  await popup.locator('.dive-experience-score-info > summary').click();
  await expect(scoreInfoPopover).toBeVisible();
  await scoreInfoPopover.locator('.dive-experience-dimension-details > summary').click();
  const fishBefore = await scoreInfoPopover.locator('.dive-experience-dimension-row').filter({ hasText:'Fish abundance outlook' }).innerText();
  const thermalBefore = await scoreInfoPopover.locator('.dive-experience-dimension-row').filter({ hasText:'Thermal stress history' }).innerText();
  await expect(scoreInfoPopover).toContainText('positive recorded survey units');
  await expect(scoreInfoPopover).toContainText('Missing source data or fewer than six valid annual values leaves the dimension unavailable.');
  expect(await page.locator('.dive-experience-dimension-list').innerText()).not.toMatch(/fish\s*\/\s*100\s*m/i);
  if (test.info().project.name === 'mobile-touch-chromium') {
    await page.setViewportSize({ width:320, height:640 });
    await page.evaluate(() => window.__DIVEATLAS_TEST__.map.invalidateSize({ animate:false }));
    const popupLayout = await page.evaluate(() => {
      const popup = document.querySelector('.leaflet-popup.dive-conditions-popup');
      const content = popup.querySelector('.leaflet-popup-content');
      const close = popup.querySelector('.dive-conditions-popup-close');
      const popupRect = popup.getBoundingClientRect();
      const closeRect = close.getBoundingClientRect();
      const evidence = popup.querySelector('.dive-experience-evidence-line');
      return {
        popupInsideViewport:popupRect.left >= 0 && popupRect.right <= innerWidth && popupRect.top >= 0 && popupRect.bottom <= innerHeight,
        popupHeightRatio:popupRect.height / innerHeight,
        closeReachable:closeRect.top >= 0 && closeRect.bottom <= innerHeight && closeRect.left >= 0 && closeRect.right <= innerWidth,
        horizontalOverflow:content.scrollWidth > content.clientWidth,
        contentAllowsVerticalScroll:['auto', 'scroll'].includes(getComputedStyle(content).overflowY),
        evidenceHeight:evidence.getBoundingClientRect().height
      };
    });
    expect(popupLayout.popupInsideViewport).toBe(true);
    expect(popupLayout.popupHeightRatio).toBeLessThan(0.85);
    expect(popupLayout.closeReachable).toBe(true);
    expect(popupLayout.horizontalOverflow).toBe(false);
    expect(popupLayout.contentAllowsVerticalScroll).toBe(true);
    expect(popupLayout.evidenceHeight).toBeLessThanOrEqual(40);
  }

  await setLegendCollapsed(page, false);
  const centerBefore = await page.evaluate(() => {
    const center = window.__DIVEATLAS_TEST__.map.getCenter();
    return { lat:center.lat, lng:center.lng, zoom:window.__DIVEATLAS_TEST__.map.getZoom() };
  });
  const monthSwitchStarted = Date.now();
  await page.locator('#diveExperienceMonth').selectOption('7');
  await expect(page.locator('#diveExperienceMonth')).toHaveValue('7');
  await expect.poll(() => outlookRequests.some(url => url.endsWith('/month-07.bin.gz'))).toBe(true);
  await expect(popup).toContainText('July');
  const monthSwitchMs = Date.now() - monthSwitchStarted;
  await expect(popup.locator('.dive-experience-main-score')).toBeVisible();
  const scoreAfter = await popup.locator('.dive-experience-main-score').innerText();
  expect(scoreAfter).not.toBe(scoreBefore);
  await setLegendCollapsed(page, true);
  await popup.locator('.dive-experience-score-info > summary').click();
  await expect(scoreInfoPopover).toBeVisible();
  await scoreInfoPopover.locator('.dive-experience-dimension-details > summary').click();
  const fishAfter = await scoreInfoPopover.locator('.dive-experience-dimension-row').filter({ hasText:'Fish abundance outlook' }).innerText();
  const thermalAfter = await scoreInfoPopover.locator('.dive-experience-dimension-row').filter({ hasText:'Thermal stress history' }).innerText();
  expect(fishAfter).toBe(fishBefore);
  expect(thermalAfter).toBe(thermalBefore);
  await setLegendCollapsed(page, false);
  for (const allMonth of Array.from({ length:12 }, (_, index) => index + 1).filter(value => ![7, Number(month)].includes(value))) {
    const asset = `month-${String(allMonth).padStart(2, '0')}.bin.gz`;
    await page.locator('#diveExperienceMonth').selectOption(String(allMonth));
    await expect(page.locator('#diveExperienceMonth')).toHaveValue(String(allMonth));
    await expect.poll(() => outlookRequests.some(url => url.endsWith(`/${asset}`))).toBe(true);
    await expect(popup.locator('.dive-experience-main-score')).toBeVisible();
  }
  const loadedMonths = [...new Set(outlookRequests.map(url => url.match(/month-(\d{2})\.bin\.gz$/)?.[1]).filter(Boolean))].sort();
  expect(loadedMonths).toEqual(Array.from({ length:12 }, (_, index) => String(index + 1).padStart(2, '0')));
  const centerAfter = await page.evaluate(() => {
    const center = window.__DIVEATLAS_TEST__.map.getCenter();
    return { lat:center.lat, lng:center.lng, zoom:window.__DIVEATLAS_TEST__.map.getZoom() };
  });
  expect(centerAfter.lat).toBeCloseTo(centerBefore.lat, 7);
  expect(centerAfter.lng).toBeCloseTo(centerBefore.lng, 7);
  expect(centerAfter.zoom).toBe(centerBefore.zoom);
  const diagnostics = await page.evaluate(() => window.DiveAtlasDiveExperienceMap?.getRenderDiagnostics() || null);
  expect(diagnostics?.tileCount).toBeGreaterThan(0);
  expect(diagnostics?.maxTileRenderMs).toBeGreaterThanOrEqual(0);
  const runtimeAssetBytes = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter(entry => entry.name.includes('/data/dive-experience-outlook/'))
    .reduce((total, entry) => total + (entry.transferSize || 0), 0));
  console.log('Dive Experience Outlook browser measurements:', JSON.stringify({
    initialOutlookRequests:0, firstActivationMs:activationMs, popupLatencyMs, monthSwitchMs,
    fetchedMonthAssets:outlookRequests.filter(url => /month-\d{2}\.bin\.gz$/.test(url)).length,
    runtimeAssetTransferBytes:runtimeAssetBytes, tileRender:diagnostics
  }));
});

test('Dive Experience Outlook can be disabled for a staged rollout', async ({ page }) => {
  await openMap(page, { url:'/?__diveatlas_test=1&lat=-5.7&lng=131&z=7&diveExperienceOutlook=0' });
  await expect(page.locator('[data-dive-experience-outlook]')).toBeHidden();
  await expect(page.locator('#environmentViewSelect option[value="dive-experience-outlook"]')).toHaveCount(0);
  expect(page.url()).toContain('diveExperienceOutlook=0');
});

test('Dive Experience panel, popup, and info tooltip follow every supported language', async ({ page }, testInfo) => {
  await openMap(page);
  await setLegendCollapsed(page, false);
  await page.locator('.environment-segment').filter({
    has:page.locator('input[name="environmentView"][value="dive-experience-outlook"]')
  }).click();
  await expect(page.locator('#diveExperienceOutlookStatus')).toContainText('Historical monthly outlook');
  const tabLabels = {
    en:'Dive Experience', zh:'潜水体验', ja:'ダイビング体験', fr:'Plongée', de:'Taucherlebnis',
    nl:'Duikervaring', it:'Esperienza subacquea', ru:'Дайвинг', pt:'Mergulho', sv:'Dykning',
    no:'Dykking', es:'Buceo', ko:'다이빙 경험', id:'Pengalaman menyelam'
  };
  await expect(page.locator('#diveExperienceOutlookPanel')).toBeVisible();
  await expect(page.locator('#diveExperienceOutlookStatus')).toContainText('Historical monthly outlook');
  await waitForMapInteractionWindow(page);
  const interaction = await page.evaluate(() => window.__DIVEATLAS_TEST__.resolveMapInteraction({ lat:-5.7, lng:131 }));
  expect(interaction).toBe('dive-experience-outlook-location-selected');
  const popup = page.locator('.dive-experience-popup-content');
  await expect(popup).toBeVisible();

  for (const language of Object.keys(tabLabels)) {
    if (language !== 'en') {
      await page.locator('#languageMenuButton').click();
      await page.locator(`#languageDropdown [data-language="${language}"]`).click();
    }
    await expect(page.locator('#diveExperienceOutlookPanel h2')).toHaveAttribute('aria-label', 'DiveAtlas Rating');
    await expect(popup.locator('.dive-conditions-popup-title')).toHaveAttribute('aria-label', 'DiveAtlas Rating');
    await expect(page.locator('#environmentDiveExperienceLabel')).toHaveAttribute('aria-label', 'DiveAtlas Rating');
    for (const selector of ['#diveExperienceOutlookPanel h2', '.dive-conditions-popup-title', '#environmentDiveExperienceLabel']) {
      const logo = page.locator(`${selector} .dive-brand-rating-logo`);
      await expect(logo).toHaveCount(1);
      await expect(logo.locator('image')).toHaveAttribute('href', 'assets/diveatlas-logo.svg?v=2');
    }
    await expect(page.locator('#environmentViewSelect option[value="dive-experience-outlook"]')).toHaveText(tabLabels[language]);
    const layout = await page.evaluate(() => {
      const panel = document.querySelector('#diveExperienceOutlookPanel');
      const popup = document.querySelector('.leaflet-popup');
      const popupContent = document.querySelector('.leaflet-popup-content');
      return { panelOverflow:panel.scrollWidth > panel.clientWidth, popupOverflow:popupContent.scrollWidth > popupContent.clientWidth, popupWidth:popup.getBoundingClientRect().width };
    });
    expect(layout).toMatchObject({ panelOverflow:false, popupOverflow:false, popupWidth:testInfo.project.name.includes('mobile') ? 320 : 360 });
    await setLegendCollapsed(page, true);
    await expect(page.locator('#bioLegendCollapsedSummary')).toContainText(`${tabLabels[language]} ·`);
    await setLegendCollapsed(page, false);
  }
  if (page.viewportSize().width <= 720) await setLegendCollapsed(page, true);
  await page.locator('.dive-experience-score-info > summary').click();
  await expect(page.locator('.dive-experience-popup-info-popover')).toBeVisible();
  await expect(page.locator('.dive-experience-popup-info-popover')).toContainText('Prospek historis bulanan');
});

test('Dive Experience popup reports the selected cell outlook and supporting evidence', async ({ page }) => {
  await openMap(page, { url:'/?__diveatlas_test=1&lat=69.53125&lng=-23.46875&z=7' });
  await setLegendCollapsed(page, false);
  await page.locator('.environment-segment-group').evaluate(track => { track.scrollLeft = 0; });
  await page.locator('.environment-segment').filter({
    has:page.locator('input[name="environmentView"][value="dive-experience-outlook"]')
  }).click();
  await expect(page.locator('#diveExperienceOutlookStatus')).toContainText('Historical monthly outlook');
  await expect.poll(() => page.evaluate(() => window.DiveAtlasDiveExperienceMap?.getRenderDiagnostics().tileCount || 0)).toBeGreaterThan(0);
  await setLegendCollapsed(page, true);
  await waitForMapInteractionWindow(page);
  const interaction = await page.evaluate(() => window.__DIVEATLAS_TEST__.resolveMapInteraction({ lat:69.53125, lng:-23.46875 }));
  expect(interaction).toBe('dive-experience-outlook-location-selected');
  const popup = page.locator('.dive-experience-popup-content');
  await expect(popup).toBeVisible();
  await expect(popup.locator('.dive-conditions-popup-region')).toHaveText('Greenland · Denmark · Europe');
  const selectedCell = await page.evaluate(async () => {
    const store = window.DiveAtlasDiveExperienceMap.createDataStore();
    return store.sample({ lat:69.53125, lng:-23.46875 }, Number(document.querySelector('#diveExperienceMonth').value));
  });
  expect(selectedCell?.score).not.toBeNull();
  await expect(popup.locator('.dive-experience-main-score')).toContainText(`${selectedCell.score}/100`);
  await expect(popup.locator('.dive-experience-evidence-line')).toContainText(`${selectedCell.activeDimensionCount} of 7 dimensions available`);
  await expect(popup.locator('.dive-experience-subscore').first()).toContainText(`${selectedCell.diveConditionsScore} ·`);
  const australiaPoint = { lat:-28.536, lng:137.505 };
  await waitForMapInteractionWindow(page);
  expect(await page.evaluate(({ lat, lng }) => window.__DIVEATLAS_TEST__.resolveMapInteraction({ lat, lng }), australiaPoint))
    .toBe('dive-experience-outlook-location-selected');
  await expect(popup.locator('.dive-conditions-popup-region')).toHaveText('Australia · Oceania');
  const indonesiaPoint = { lat:-4.303, lng:124.629 };
  await waitForMapInteractionWindow(page);
  expect(await page.evaluate(({ lat, lng }) => window.__DIVEATLAS_TEST__.resolveMapInteraction({ lat, lng }), indonesiaPoint))
    .toBe('dive-experience-outlook-location-selected');
  await expect(popup.locator('.dive-conditions-popup-region')).toHaveText('Indonesia · Asia');
  const screenshotPoints = [
    { point:{ lat:-2.285, lng:100.107 }, label:'Indonesia · Asia' },
    { point:{ lat:7.202, lng:134.547 }, label:'Palau · Oceania' },
    { point:{ lat:8.059, lng:110.127 }, label:'Vietnam · Asia' },
    { point:{ lat:4.697, lng:73.037 }, label:'Maldives · Asia' },
    { point:{ lat:13.595, lng:144.745 }, label:'Guam · United States of America · Americas' }
  ];
  for (const { point, label } of screenshotPoints) {
    await waitForMapInteractionWindow(page);
    expect(await page.evaluate(({ lat, lng }) => window.__DIVEATLAS_TEST__.resolveMapInteraction({ lat, lng }), point))
      .toBe('dive-experience-outlook-location-selected');
    await expect(popup.locator('.dive-conditions-popup-region')).toHaveText(label);
  }
});

test('Dive Experience still shows a local outlook when the physical-conditions service fails to load', async ({ page }) => {
  await page.route('**/js/dive-conditions-service.js*', route => route.fulfill({ status:503, body:'Unavailable' }));
  await openMap(page, { url:'/?__diveatlas_test=1&lat=-3.5&lng=131&z=7' });
  await setLegendCollapsed(page, false);
  await page.locator('.environment-segment').filter({
    has:page.locator('input[name="environmentView"][value="dive-experience-outlook"]')
  }).click();
  await expect(page.locator('#diveExperienceOutlookStatus')).toContainText('Historical monthly outlook');
  await expect.poll(() => page.evaluate(() => window.DiveAtlasDiveExperienceMap?.getRenderDiagnostics().tileCount || 0)).toBeGreaterThan(0);
  await setLegendCollapsed(page, true);
  await waitForMapInteractionWindow(page);
  expect(await page.evaluate(() => window.__DIVEATLAS_TEST__.resolveMapInteraction({ lat:-5.7, lng:131 })))
    .toBe('dive-experience-outlook-location-selected');
  const popup = page.locator('.dive-experience-popup-content');
  await expect(popup).toBeVisible();
  await expect(popup.locator('.dive-experience-main-score')).toContainText(/\d+\/100/);
  await expect(popup).not.toContainText('Some local data could not be loaded at this location.');
});

test('expanded Dive Experience month chart stays inside the popup safe area', async ({ page }) => {
  await page.setViewportSize({ width:390, height:640 });
  await openMap(page, { url:'/?__diveatlas_test=1&lat=-3.5&lng=131&z=7' });
  await setLegendCollapsed(page, false);
  await page.locator('.environment-segment').filter({
    has:page.locator('input[name="environmentView"][value="dive-experience-outlook"]')
  }).click();
  await setLegendCollapsed(page, true);
  await expect(page.locator('#diveExperienceOutlookStatus')).toContainText('Historical monthly outlook');
  await expect.poll(() => page.evaluate(() => window.DiveAtlasDiveExperienceMap?.getRenderDiagnostics().tileCount || 0)).toBeGreaterThan(0);
  const location = await page.evaluate(() => {
    const map = window.__DIVEATLAS_TEST__.map;
    const target = map.latLngToContainerPoint([ -5.7, 131 ]);
    return { lat:-5.7, lng:131, screenY:target.y, height:map.getSize().y };
  });
  expect(location.screenY).toBeGreaterThan(location.height * 0.65);
  await waitForMapInteractionWindow(page);
  expect(await page.evaluate(({ lat, lng }) => window.__DIVEATLAS_TEST__.resolveMapInteraction({ lat, lng }), location))
    .toBe('dive-experience-outlook-location-selected');
  const popup = page.locator('.dive-experience-popup-content');
  await expect(popup).toBeVisible();
  await popup.locator('.dive-experience-compare-button').click();
  await expect(popup.locator('.dive-experience-month-chart')).toBeVisible({ timeout:30000 });
  await expect.poll(() => page.evaluate(() => {
    const bounds = window.__DIVEATLAS_TEST__.getState().popup;
    return Boolean(bounds && bounds.bounds.top >= bounds.safeBounds.top - 1 &&
      bounds.bounds.bottom <= bounds.safeBounds.bottom + 1);
  })).toBe(true);
});
