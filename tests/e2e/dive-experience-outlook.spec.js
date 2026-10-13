'use strict';

const { test, expect } = require('@playwright/test');
const { openMap, setMapView, waitForMapInteractionWindow, waitForMapMovementToSettle } = require('./support');

async function setLegendCollapsed(page, collapsed) {
  const panel = page.locator('#bioLegend');
  const isCollapsed = await panel.evaluate(node => node.classList.contains('is-collapsed'));
  if (isCollapsed !== collapsed) {
    // This suite covers language updates, while dedicated interaction tests
    // cover pointer activation of the title. Use the button's click handler
    // directly so unrelated panel reflow cannot block the localization loop.
    await panel.locator('#bioLegendTitle').evaluate(button => button.click());
    await expect.poll(() => panel.evaluate(node => node.classList.contains('is-collapsed'))).toBe(collapsed);

    await expect(panel.locator('#bioLegendTitle')).toHaveAttribute('aria-expanded', collapsed ? 'false' : 'true');
    if (collapsed) await expect(panel.locator('#bioLegendLayers')).toBeHidden();
    else await expect(panel.locator('#bioLegendLayers')).toBeVisible();
  }
}

async function reopenDiveExperiencePopup(page) {
  const popup = page.locator('.dive-experience-popup-content');
  await setLegendCollapsed(page, true);
  await waitForMapMovementToSettle(page);
  await waitForMapInteractionWindow(page);
  const result = await page.evaluate(() => {
    window.__DIVEATLAS_TEST__.map.closePopup();
    return window.__DIVEATLAS_TEST__.resolveMapInteraction({ lat:-5.7, lng:131 });
  });
  expect(result).toBe('dive-experience-outlook-location-selected');
  await waitForMapMovementToSettle(page);
  await waitForMapInteractionWindow(page);
  await expect(popup).toBeVisible();
}

test('Dive Experience Outlook can be disabled for a staged rollout', async ({ page }) => {
  await openMap(page, { url:'/?__diveatlas_test=1&lat=-5.7&lng=131&z=7&diveExperienceOutlook=0' });
  await expect(page.locator('[data-dive-experience-outlook]')).toBeHidden();
  await expect(page.locator('#environmentViewSelect option[value="dive-experience-outlook"]')).toHaveCount(0);
  expect(page.url()).toContain('diveExperienceOutlook=0');
});

test('Dive Experience panel, popup, and info tooltip follow every supported language', async ({ page }, testInfo) => {
  // Mobile reopens the popup after each locale change; the full 14-language
  // pass needs more than Playwright's default 30-second budget on CI.
  test.setTimeout(90_000);
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
  if (page.viewportSize().width <= 720) {
    const sheetWidths = await page.locator('.leaflet-popup.dive-conditions-rating-sheet').evaluate(node => {
      const content = node.querySelector('.leaflet-popup-content');
      const wrapper = node.querySelector('.leaflet-popup-content-wrapper');
      return {
        sheet:node.getBoundingClientRect().width,
        wrapper:wrapper.getBoundingClientRect().width,
        content:content.getBoundingClientRect().width
      };
    });
    expect(sheetWidths.wrapper).toBeGreaterThanOrEqual(sheetWidths.sheet - 1);
    expect(sheetWidths.content).toBeGreaterThanOrEqual(sheetWidths.wrapper - 2);
  }

  for (const language of Object.keys(tabLabels)) {
    if (language !== 'en') {
      await page.locator('#languageMenuButton').click();
      await page.locator(`#languageDropdown [data-language="${language}"]`).click();
      if (page.viewportSize().width <= 720) await reopenDiveExperiencePopup(page);
    }
    await expect(page.locator('#diveExperienceOutlookPanel h2')).toHaveAttribute('aria-label', 'DiveAtlas Rating');
    await expect(popup.locator('.dive-conditions-popup-title')).toHaveAttribute('aria-label', 'DiveAtlas Rating');
    await expect(page.locator('#environmentDiveExperienceLabel')).toHaveAttribute('aria-label', 'DiveAtlas Rating');
    for (const selector of ['#diveExperienceOutlookPanel h2', '.dive-conditions-popup-title', '#environmentDiveExperienceLabel']) {
      const logo = page.locator(`${selector} .dive-brand-rating-logo`);
      await expect(logo).toHaveCount(1);
      await expect(logo.locator('image')).toHaveAttribute('href', 'assets/diveatlas-logo.svg?v=3');
    }
    await expect(page.locator('#environmentViewSelect option[value="dive-experience-outlook"]')).toHaveText(tabLabels[language]);
    const layout = await page.evaluate(() => {
      const panel = document.querySelector('#diveExperienceOutlookPanel');
      const popup = document.querySelector('.leaflet-popup');
      const popupContent = document.querySelector('.leaflet-popup-content');
      return { panelOverflow:panel.scrollWidth > panel.clientWidth, popupOverflow:popupContent.scrollWidth > popupContent.clientWidth, popupWidth:popup.getBoundingClientRect().width };
    });
    expect(layout).toMatchObject({ panelOverflow:false, popupOverflow:false });
    expect(layout.popupWidth).toBeLessThanOrEqual(page.viewportSize().width);
    expect(layout.popupWidth).toBeGreaterThanOrEqual(testInfo.project.name.includes('mobile') ? 300 : 340);
    await setLegendCollapsed(page, true);
    await expect(page.locator('#bioLegendCollapsedSummary')).toContainText(`${tabLabels[language]} ·`);
    await setLegendCollapsed(page, false);
  }
  if (page.viewportSize().width <= 720) {
    await setLegendCollapsed(page, true);
    await expect(page.locator('.leaflet-popup.dive-conditions-rating-sheet')).toHaveCount(0);
    await reopenDiveExperiencePopup(page);
  }
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

test('expanded Dive Experience month chart stays inside safe area and previews other months with pointer input', async ({ page }, testInfo) => {
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
  const sheet = page.locator('.leaflet-popup.dive-conditions-rating-sheet');
  const collapsedHeightLimits = await sheet.evaluate(node => {
    const content = node.querySelector('.leaflet-popup-content');
    return {
      sheet:parseFloat(getComputedStyle(node).maxHeight),
      content:parseFloat(getComputedStyle(content).maxHeight)
    };
  });
  await popup.locator('.dive-experience-compare-button').click();
  await expect(popup.locator('.dive-experience-month-chart')).toBeVisible({ timeout:30000 });
  if (await sheet.isVisible()) {
    const viewportHeight = page.viewportSize().height;
    const expectPointerCenteredInExposedMap = async () => {
      await expect.poll(() => page.evaluate(() => {
        const marker = document.querySelector('.map-click-location-marker');
        const map = document.querySelector('#map');
        const sheetElement = document.querySelector('.leaflet-popup.dive-conditions-rating-sheet');
        const header = document.querySelector('#topMenuBar');
        if (!marker || !map || !sheetElement || !header) return Infinity;
        const markerBounds = marker.getBoundingClientRect();
        const mapBounds = map.getBoundingClientRect();
        const sheetBounds = sheetElement.getBoundingClientRect();
        const visibleTop = Math.max(mapBounds.top, header.getBoundingClientRect().bottom);
        const visibleBottom = Math.min(mapBounds.bottom, sheetBounds.top);
        return Math.hypot(
          markerBounds.left + markerBounds.width / 2 - (mapBounds.left + mapBounds.width / 2),
          markerBounds.bottom - (visibleTop + (visibleBottom - visibleTop) / 2)
        );
      })).toBeLessThan(6);
    };
    const geometry = await sheet.evaluate(node => {
      const popupContent = node.querySelector('.leaflet-popup-content');
      const chart = node.querySelector('.dive-experience-month-chart');
      const sheetBounds = node.getBoundingClientRect();
      const contentBounds = popupContent.getBoundingClientRect();
      const chartBounds = chart.getBoundingClientRect();
      return {
        sheetBottom:sheetBounds.bottom,
        contentTop:contentBounds.top,
        contentBottom:contentBounds.bottom,
        contentScrollHeight:popupContent.scrollHeight,
        sheetMaxHeight:parseFloat(getComputedStyle(node).maxHeight),
        contentMaxHeight:parseFloat(getComputedStyle(popupContent).maxHeight),
        chartTop:chartBounds.top,
        chartBottom:chartBounds.bottom
      };
    });
    expect(geometry.sheetMaxHeight).toBeGreaterThan(collapsedHeightLimits.sheet);
    expect(geometry.contentMaxHeight).toBeGreaterThan(collapsedHeightLimits.content);
    expect(geometry.sheetBottom).toBeLessThanOrEqual(viewportHeight + 1);
    expect(geometry.contentTop).toBeGreaterThanOrEqual(0);
    expect(geometry.contentBottom).toBeLessThanOrEqual(viewportHeight + 1);
    expect(geometry.contentScrollHeight).toBeGreaterThanOrEqual(geometry.chartBottom - geometry.contentTop);
    await expectPointerCenteredInExposedMap();
    await page.locator('.dive-experience-month-chart').scrollIntoViewIfNeeded();
    const chart = page.locator('.dive-experience-month-chart');
    await expect(chart).toBeInViewport();
    const sheetMonthBeforeInspection = await page.locator('#diveExperienceMonth').inputValue();
    const chartPointForMonth = index => chart.evaluate((node, monthIndex) => {
      const point = node.createSVGPoint();
      point.x = Number(node.dataset.plotLeft) + monthIndex * Number(node.dataset.barStep) + Number(node.dataset.barWidth) / 2;
      point.y = Number(node.dataset.plotTop) + Number(node.dataset.plotHeight) / 2;
      const screen = point.matrixTransform(node.getScreenCTM());
      return { x:screen.x, y:screen.y };
    }, index);
    const firstMonthPoint = await chartPointForMonth(0);
    if (testInfo.project.name === 'mobile-touch-chromium') {
      await page.touchscreen.tap(firstMonthPoint.x, firstMonthPoint.y);
    } else {
      await page.mouse.click(firstMonthPoint.x, firstMonthPoint.y);
    }
    const inspection = chart.locator('.dive-experience-month-inspection');
    await expect(inspection).toHaveAttribute('visibility', 'visible');
    await expect(chart).toHaveAttribute('data-selected-index', '0');
    await expect(chart).toHaveAttribute('aria-label', /January.*Dive Conditions/);

    const lastMonthPoint = await chartPointForMonth(11);
    await chart.dispatchEvent('pointermove', {
      pointerId:1, pointerType:'touch', isPrimary:true,
      clientX:lastMonthPoint.x, clientY:lastMonthPoint.y, buttons:1
    });
    await expect(chart).toHaveAttribute('data-selected-index', '11');
    await expect(chart).toHaveAttribute('aria-label', /December.*Dive Conditions/);
    await expect(page.locator('#diveExperienceMonth')).toHaveValue(sheetMonthBeforeInspection);

    const outsidePoint = await popup.locator('.dive-experience-month-comparison-caption').boundingBox();
    if (testInfo.project.name === 'mobile-touch-chromium') {
      await page.touchscreen.tap(outsidePoint.x + outsidePoint.width / 2, outsidePoint.y + outsidePoint.height / 2);
    } else {
      await page.mouse.click(outsidePoint.x + outsidePoint.width / 2, outsidePoint.y + outsidePoint.height / 2);
    }
    await expect(inspection).toHaveAttribute('visibility', 'hidden');
    await expect(page.locator('#diveExperienceMonth')).toHaveValue(sheetMonthBeforeInspection);

    await popup.locator('.dive-experience-compare-button').click();
    await expect(popup.locator('.dive-experience-month-chart')).toBeHidden();
    await expectPointerCenteredInExposedMap();
  } else {
    const bounds = await page.evaluate(() => window.__DIVEATLAS_TEST__.getState().popup);
    expect(bounds.bounds.top).toBeGreaterThanOrEqual(bounds.safeBounds.top - 1);
    expect(bounds.bounds.bottom).toBeLessThanOrEqual(bounds.safeBounds.bottom + 1);
  }
});
