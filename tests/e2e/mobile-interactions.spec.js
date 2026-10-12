const { test, expect } = require('@playwright/test');
const {
  addFixture,
  clickFixture,
  mapState,
  openMap,
  resetActionCount,
  setMapView,
  waitForClickResolution
} = require('./support');

test.beforeEach(async ({ page }, testInfo) => openMap(page, {
  disableLegendAutoCollapse: testInfo.title !== 'mobile layer rows toggle across the row and the collapsed bar shrinks after idle'
}));

async function swipeRightOn(page, selector) {
  await page.locator(selector).evaluate(panel => {
    const rect = panel.getBoundingClientRect();
    const start = new Touch({ identifier:7, target:panel, clientX:rect.left + 30, clientY:200 });
    const end = new Touch({ identifier:7, target:panel, clientX:rect.left + 120, clientY:204 });
    panel.dispatchEvent(new TouchEvent('touchstart', {
      bubbles:true, cancelable:true, touches:[start], targetTouches:[start], changedTouches:[start]
    }));
    panel.dispatchEvent(new TouchEvent('touchend', {
      bubbles:true, cancelable:true, touches:[], targetTouches:[], changedTouches:[end]
    }));
  });
}

async function expectTitleAtDrawerInset(drawer, titleSelector, inset) {
  const titleOffset = await drawer.evaluate((panel, selector) => {
    const title = panel.querySelector(selector);
    return title.getBoundingClientRect().left - panel.getBoundingClientRect().left;
  }, titleSelector);
  expect(titleOffset).toBeCloseTo(inset, 0);
}

async function expectPointerCenteredInExposedMap(page) {
  await expect.poll(() => page.evaluate(() => {
    const marker = document.querySelector('.map-click-location-marker');
    const map = document.querySelector('#map');
    const sheet = document.querySelector('.leaflet-popup.diveatlas-mobile-sheet, .leaflet-popup.dive-conditions-rating-sheet');
    const header = document.querySelector('#topMenuBar');
    if (!marker || !map || !sheet || !header) return Infinity;
    const markerBounds = marker.getBoundingClientRect();
    const mapBounds = map.getBoundingClientRect();
    const visibleTop = Math.max(mapBounds.top, header.getBoundingClientRect().bottom);
    const visibleBottom = Math.min(mapBounds.bottom, sheet.getBoundingClientRect().top);
    return Math.hypot(
      markerBounds.left + markerBounds.width / 2 - (mapBounds.left + mapBounds.width / 2),
      markerBounds.bottom - (visibleTop + (visibleBottom - visibleTop) / 2)
    );
  })).toBeLessThan(6);
}

test('language selector opens as a half-width page that slides in from the right', async ({ page }) => {
  const trigger = page.locator('#languageMenuButton');
  const languagePage = page.locator('#languageDropdown');

  await expect(trigger.locator('#languageMenuLabel')).toBeHidden();
  await expect(trigger.locator('.language-globe-icon')).toBeVisible();
  await expect(trigger.locator('.language-chevron-icon')).toBeHidden();
  expect(await page.evaluate(() => {
    const language = document.querySelector('#languageMenuButton').getBoundingClientRect();
    const menu = document.querySelector('#topMenuButton').getBoundingClientRect();
    return menu.left - language.right;
  })).toBeLessThanOrEqual(8);
  await expect(trigger.locator('.language-globe-icon circle')).toHaveAttribute('stroke-width', '2');
  await trigger.click();
  await expect(languagePage).toBeVisible();
  await expect(languagePage).toHaveClass(/is-open/);
  const languageHeader = languagePage.locator('.language-page-header');
  await expect(languageHeader).toBeVisible();
  await expect(languagePage.locator('.language-page-back')).toHaveCount(0);
  await expectTitleAtDrawerInset(languagePage, '.language-page-header > span', 21);
  await expect.poll(() => languageHeader.evaluate(node => node.getBoundingClientRect().top)).toBeLessThanOrEqual(8);
  await expect.poll(() => languagePage.evaluate(node =>
    Math.abs(node.getBoundingClientRect().left - document.documentElement.clientWidth / 2)
  )).toBeLessThan(1);
  const pageBounds = await languagePage.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { left:rect.left, right:rect.right, width:rect.width, viewport:document.documentElement.clientWidth };
  });
  expect(Math.abs(pageBounds.right - pageBounds.viewport)).toBeLessThan(1);
  expect(Math.abs(pageBounds.width - pageBounds.viewport / 2)).toBeLessThan(1);
  expect(Math.abs(pageBounds.left - pageBounds.viewport / 2)).toBeLessThan(1);

  await languagePage.locator('[data-language="es"]').click();
  await expect(page.locator('#langSelect')).toHaveValue('es');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(languagePage).toBeHidden({ timeout:1_000 });
  await trigger.click();
  await expect(languagePage).toHaveClass(/is-open/);
  await swipeRightOn(page, '#languageDropdown');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(languagePage).toBeHidden({ timeout:1_000 });
});

test('main menu opens as a half-width page from the right on mobile', async ({ page }) => {
  const trigger = page.locator('#topMenuButton');
  const menuPage = page.locator('#topMenuDropdown');

  await trigger.click();
  await expect(menuPage).toBeVisible();
  await expect(menuPage).toHaveClass(/is-open/);
  const menuHeader = menuPage.locator('.top-menu-page-header');
  await expect(menuHeader).toBeVisible();
  await expect(menuPage.locator('.top-menu-page-back')).toHaveCount(0);
  await expect(menuPage.locator('a.top-menu-dropdown-item[href="/dive-sites/"]')).toBeHidden();
  await expect(menuPage.locator('a.top-menu-dropdown-item[href="/regions/"]')).toBeHidden();
  await expect(menuPage.locator('#aboutMenuItem')).toBeVisible();
  await expect(menuPage.locator('#contactMenuItem')).toBeVisible();
  await expectTitleAtDrawerInset(menuPage, '#topMenuPageTitle', 15);
  await expect.poll(() => menuHeader.evaluate(node => node.getBoundingClientRect().top)).toBeLessThanOrEqual(8);
  const menuVersion = menuPage.locator('.top-menu-version');
  const versionBottomGap = await menuPage.evaluate(node => {
    const panelBottom = node.getBoundingClientRect().bottom;
    const versionBottom = node.querySelector('.top-menu-version').getBoundingClientRect().bottom;
    return panelBottom - versionBottom;
  });
  expect(versionBottomGap).toBeLessThanOrEqual(24);
  await expect.poll(() => menuPage.evaluate(node =>
    Math.abs(node.getBoundingClientRect().left - document.documentElement.clientWidth / 2)
  )).toBeLessThan(1);
  const pageBounds = await menuPage.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { left:rect.left, right:rect.right, width:rect.width, viewport:document.documentElement.clientWidth };
  });
  expect(Math.abs(pageBounds.right - pageBounds.viewport)).toBeLessThan(1);
  expect(Math.abs(pageBounds.width - pageBounds.viewport / 2)).toBeLessThan(1);
  expect(Math.abs(pageBounds.left - pageBounds.viewport / 2)).toBeLessThan(1);

  await swipeRightOn(page, '#topMenuDropdown');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(menuPage).toBeHidden({ timeout:1_000 });
  await trigger.click();
  await expect(menuPage).toHaveClass(/is-open/);
  await menuPage.locator('#aboutMenuItem').click();
  const aboutModal = page.locator('#aboutInfoModal');
  await expect(aboutModal).toBeVisible();
  await expect(menuPage).toBeHidden({ timeout:1_000 });
  await expect(aboutModal.locator('[role="dialog"]')).toHaveAttribute('aria-modal', 'true');
  await expect(aboutModal.locator('#aboutInfoContent')).toContainText('DiveAtlas is an interactive map');
  await page.keyboard.press('Escape');
  await expect(aboutModal).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('mobile layer rows toggle across the row and the collapsed bar shrinks after idle', async ({ page }) => {
  const panel = page.locator('#bioLegend');
  const title = page.locator('#bioLegendTitle');
  const terrain = page.locator('#terrainLayerToggle');
  const label = page.locator('#terrainLegendLabel');

  await expect(panel).toHaveClass(/is-collapsed/);
  await expect(panel).not.toHaveClass(/is-mobile-auto-collapsed/);
  await title.click();
  await expect(panel).not.toHaveClass(/is-collapsed/);
  const layerScrollStyle = await page.locator('#bioLegendLayers').evaluate(node => ({
    overflowY: getComputedStyle(node).overflowY,
    scrollbarWidth: getComputedStyle(node).scrollbarWidth
  }));
  expect(layerScrollStyle.overflowY).toBe('auto');
  expect(layerScrollStyle.scrollbarWidth).toBe('none');
  expect(await label.evaluate(node => getComputedStyle(node).fontSize)).toBe('18px');
  await page.waitForTimeout(6_200);
  await expect(panel).not.toHaveClass(/is-collapsed/);

  const terrainWasChecked = await terrain.isChecked();
  await label.click();
  await expect(terrain).toHaveJSProperty('checked', !terrainWasChecked);
  await label.click();
  await expect(terrain).toHaveJSProperty('checked', terrainWasChecked);

  const expandedPosition = await panel.evaluate(node => {
    const { x, y } = node.getBoundingClientRect();
    return { x, y };
  });
  await title.click();
  await expect(panel).toHaveClass(/is-collapsed/);
  await expect(panel).not.toHaveClass(/is-mobile-auto-collapsed/);
  const collapsedPosition = await panel.evaluate(node => {
    const { x, y } = node.getBoundingClientRect();
    return { x, y };
  });
  expect(Math.abs(collapsedPosition.x - expandedPosition.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(collapsedPosition.y - expandedPosition.y)).toBeLessThanOrEqual(1);

  await expect(panel).toHaveClass(/is-mobile-auto-collapsed/, { timeout: 8_000 });
  const compactSize = await panel.evaluate(node => {
    const box = node.getBoundingClientRect();
    return { width: box.width, height: box.height, radius: getComputedStyle(node).borderRadius };
  });
  expect(compactSize.width).toBe(48);
  expect(compactSize.height).toBe(48);
  expect(compactSize.radius).toBe('50%');

  // The circle restores the compact bar; a second tap opens the full panel.
  await title.click();
  await expect(panel).toHaveClass(/is-collapsed/);
  await expect(panel).not.toHaveClass(/is-mobile-auto-collapsed/);
  await expect(page.locator('#bioLegendLayers')).toBeHidden();
  expect(await panel.evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThan(48);

  await title.click();
  await expect(panel).not.toHaveClass(/is-collapsed/);
  await expect(panel).not.toHaveClass(/is-mobile-auto-collapsed/);
  await expect(panel).toHaveClass(/mobile-layers-panel-expanding/);
  await expect(page.locator('#bioLegendDragHandle')).toBeHidden();
  const expandingContents = await page.locator('#bioLegendLayers').evaluate(node => ({
    transition: getComputedStyle(node).transitionProperty,
    opacity: getComputedStyle(node).opacity
  }));
  expect(expandingContents.transition).toBe('none');
  expect(expandingContents.opacity).toBe('1');
  await expect.poll(() => panel.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThan(48);
  await expect(panel).not.toHaveClass(/mobile-layers-panel-expanding/);
  await expect(page.locator('#bioLegendDragHandle')).toBeVisible();
  await expect(page.locator('#bioLegendLayers')).toBeVisible();
  await page.setViewportSize({ width: 900, height: 900 });
  const desktopTerrainState = await terrain.isChecked();
  await label.click();
  await expect(terrain).toHaveJSProperty('checked', desktopTerrainState);
});

test('expanding the full mobile layer panel closes any open map sheet', async ({ page }) => {
  await setMapView(page, -5.7, 131, 14);
  await addFixture(page, 'dive-site', { id:'sheet-before-layers-panel', lat:-5.7, lng:131 });
  await clickFixture(page, 'sheet-before-layers-panel');
  await expect(page.locator('.leaflet-popup.diveatlas-mobile-sheet')).toBeVisible();

  await page.locator('#bioLegendTitle').click();

  await expect(page.locator('#bioLegend')).not.toHaveClass(/is-collapsed/);
  await expect(page.locator('.leaflet-popup.diveatlas-mobile-sheet, .leaflet-popup.dive-conditions-rating-sheet')).toHaveCount(0);
});

test('Waves remains reachable on mobile, fits the panel, and follows the map theme', async ({ page }) => {
  if (await page.locator('#bioLegend').evaluate(node => node.classList.contains('is-collapsed'))) {
    await page.locator('#bioLegendTitle').click();
  }
  await page.locator('.environment-segment-group').evaluate(track => { track.scrollLeft = track.scrollWidth; });
  await page.locator('.environment-segment').filter({ has: page.locator('input[name="environmentView"][value="waves"]') }).click();
  await expect(page.locator('#wavesControls')).toBeVisible();
  await expect(page.locator('#wavesStatus')).toHaveAttribute('data-state', 'ready');
  const light = await page.evaluate(() => {
    const panel = document.querySelector('#bioLegend').getBoundingClientRect();
    const track = document.querySelector('.environment-segment-group');
    const tileLayer = document.querySelector('.waves-tiles');
    return {
      panelWidth: panel.width,
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: track.scrollWidth,
      visibleWidth: track.clientWidth,
      selectedWaves: document.querySelector('input[name="environmentView"][value="waves"]').checked,
      mapFilter: getComputedStyle(tileLayer).filter,
      mapOpacity: getComputedStyle(tileLayer).opacity
    };
  });
  expect(light.panelWidth).toBeLessThanOrEqual(light.viewportWidth - 16);
  expect(light.scrollWidth).toBeGreaterThan(light.visibleWidth);
  expect(light.selectedWaves).toBe(true);

  await page.locator('html').evaluate(node => { node.dataset.theme = 'dark'; });
  const dark = await page.locator('.waves-tiles').evaluate(node => ({
    mapFilter: getComputedStyle(node).filter,
    mapOpacity: getComputedStyle(node).opacity
  }));
  expect(dark.mapFilter).not.toBe(light.mapFilter);
  expect(dark.mapOpacity).not.toBe(light.mapOpacity);

  await page.locator('.environment-segment').filter({ has: page.locator('input[name="environmentView"][value="default"]') }).click();
  await expect(page.locator('.waves-tiles')).toHaveCount(0);
  await expect(page.locator('#wavesControls')).toBeHidden();
});

async function mapCenterScreenPoint(page) {
  const bounds = await page.locator('#map').boundingBox();
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

async function dispatchTouchSequence(page, { duration = 100, moveBy = null, secondPointer = false } = {}) {
  const point = await mapCenterScreenPoint(page);
  await page.evaluate(async ({ x, y, duration, moveBy, secondPointer }) => {
    const target = document.getElementById('map');
    const dispatch = (type, pointerId, clientX, clientY) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'touch',
      isPrimary: pointerId === 1,
      clientX,
      clientY,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1
    }));

    dispatch('pointerdown', 1, x, y);
    if (secondPointer) dispatch('pointerdown', 2, x + 30, y);
    if (moveBy) dispatch('pointermove', 1, x + moveBy.x, y + moveBy.y);
    await new Promise(resolve => setTimeout(resolve, duration));
    dispatch('pointerup', 1, x + (moveBy?.x || 0), y + (moveBy?.y || 0));
    if (secondPointer) dispatch('pointerup', 2, x + 30, y);
  }, { ...point, duration, moveBy, secondPointer });
}

test('mobile aggregate Coral tap zooms once and does not open details', async ({ page }) => {
  await addFixture(page, 'aggregate', { id: 'mobile-coral-aggregate', lat: -5.7, lng: 131, count: 7 });
  await resetActionCount(page);
  const before = await mapState(page);
  const map = await page.locator('#map').boundingBox();
  await page.touchscreen.tap(map.x + map.width / 2, map.y + map.height / 2);
  await expect.poll(async () => (await mapState(page)).zoom).toBeGreaterThan(before.zoom);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  expect(await page.evaluate(() => window.__DIVEATLAS_TEST__.getActionCount())).toBe(1);
});

test('mobile short tap on empty ocean does not open Depth Inspection', async ({ page }) => {
  const map = await page.locator('#map').boundingBox();
  await page.touchscreen.tap(map.x + map.width * 0.58, map.y + map.height * 0.5);
  await waitForClickResolution(page);
  // The neutral startup map must not turn a short tap into a depth inspection.
  expect((await mapState(page)).popup?.type).not.toBe('depth');
});

test('mobile location feedback stays wide and centers its selected point after a failed lookup', async ({ page }) => {
  await page.route('**/js/tides/runtime.js*', route => route.abort());
  await page.locator('#bioLegendTitle').click();
  const tideSegment = page.locator('.environment-segment').filter({
    has: page.locator('input[name="environmentView"][value="tide"]')
  });
  await tideSegment.scrollIntoViewIfNeeded();
  await tideSegment.click();
  await expect(page.locator('input[name="environmentView"][value="tide"]')).toBeChecked();

  await page.evaluate(() => {
    const map = window.__DIVEATLAS_TEST__.map;
    const latlng = window.L.latLng(-5.7, 131);
    map.fire('click', { latlng, containerPoint: map.latLngToContainerPoint(latlng) });
  });

  const marker = page.locator('.map-click-location-marker');
  const tooltip = page.locator('.leaflet-tooltip.map-click-location-status-tooltip');
  await expect(marker).toBeVisible();
  await expect(tooltip).toContainText('Data could not be loaded for this location.');
  await expect(tooltip).toBeVisible();

  const geometry = await page.evaluate(() => {
    const marker = document.querySelector('.map-click-location-marker');
    const tooltip = document.querySelector('.leaflet-tooltip.map-click-location-status-tooltip');
    const map = document.querySelector('#map');
    const header = document.querySelector('#topMenuBar');
    const markerBounds = marker.getBoundingClientRect();
    const tooltipBounds = tooltip.getBoundingClientRect();
    const mapBounds = map.getBoundingClientRect();
    const visibleTop = Math.max(mapBounds.top, header.getBoundingClientRect().bottom);
    return {
      markerCenterX: markerBounds.left + markerBounds.width / 2,
      markerAnchorY: markerBounds.bottom,
      mapCenterX: mapBounds.left + mapBounds.width / 2,
      visibleCenterY: (visibleTop + mapBounds.bottom) / 2,
      tooltipWidth: tooltipBounds.width,
      viewportWidth: document.documentElement.clientWidth
    };
  });
  expect(Math.abs(geometry.markerCenterX - geometry.mapCenterX)).toBeLessThan(6);
  expect(Math.abs(geometry.markerAnchorY - geometry.visibleCenterY)).toBeLessThan(6);
  expect(geometry.tooltipWidth).toBeGreaterThanOrEqual(220);
  expect(geometry.tooltipWidth).toBeLessThanOrEqual(geometry.viewportWidth - 32);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
});

test('mobile long press on empty ocean opens Depth Inspection', async ({ page }) => {
  // Use the neutral terrain view so this hold exercises the empty-map
  // Depth Inspection fallback.
  if (await page.locator('#bioLegend').evaluate(node => node.classList.contains('is-collapsed'))) {
    await page.locator('#bioLegendTitle').click();
  }
  const terrainSegment = page.locator('.environment-segment').filter({ has: page.locator('input[name="environmentView"][value="default"]') });
  await terrainSegment.scrollIntoViewIfNeeded();
  await terrainSegment.click();
  await expect(page.locator('input[name="environmentView"][value="default"]')).toBeChecked();
  await dispatchTouchSequence(page, { duration: 720 });
  await expect(page.locator('.leaflet-popup')).toBeVisible({ timeout: 5000 });
  expect((await mapState(page)).popup.type).toBe('depth');
});

test('resizing any mobile sheet recenters the pointer in the exposed map', async ({ page }) => {
  await dispatchTouchSequence(page, { duration:720 });
  const sheet = page.locator('.leaflet-popup.diveatlas-mobile-sheet');
  await expect(sheet).toBeVisible();
  await expectPointerCenteredInExposedMap(page);
  const initialHeight = await sheet.evaluate(node => node.getBoundingClientRect().height);

  await sheet.locator('.leaflet-popup-content').evaluate(content => {
    const addedContent = document.createElement('div');
    addedContent.dataset.testSheetExpansion = 'true';
    addedContent.style.height = '360px';
    content.append(addedContent);
  });
  await expect.poll(() => sheet.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThan(initialHeight + 100);
  await expectPointerCenteredInExposedMap(page);

  await sheet.locator('[data-test-sheet-expansion]').evaluate(node => node.remove());
  await expect.poll(() => sheet.evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(initialHeight + 100);
  await expectPointerCenteredInExposedMap(page);
});

test('touch drag cancels long press and does not open a popup', async ({ page }) => {
  await dispatchTouchSequence(page, { duration: 720, moveBy: { x: 34, y: 3 } });
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
});

test('multi-touch gesture cancels long press and does not open a popup', async ({ page }) => {
  await dispatchTouchSequence(page, { duration: 720, secondPointer: true });
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
});

test('a single touch on an individual Coral feature opens details once', async ({ page }) => {
  await setMapView(page, -5.7, 131, 14);
  await addFixture(page, 'coral-point', { id: 'mobile-coral-point', lat: -5.7, lng: 131 });
  await resetActionCount(page);
  const map = await page.locator('#map').boundingBox();
  await page.touchscreen.tap(map.x + map.width / 2, map.y + map.height / 2);
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  expect((await mapState(page)).popup.type).toBe('species');
  expect(await page.evaluate(() => window.__DIVEATLAS_TEST__.getActionCount())).toBe(1);
});
