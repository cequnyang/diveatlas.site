const { test, expect } = require('@playwright/test');
const {
  addDiveSiteAtScreenPoint,
  addFixture,
  clickFixture,
  fixturePoint,
  mapState,
  openMap,
  resetActionCount,
  setMapView,
  waitForClickResolution
} = require('./support');

test.beforeEach(async ({ page }) => openMap(page));

async function stabilizeDiveRatingScreenshot(page, { minimumPopupHeight = 0 } = {}) {
  await page.addStyleTag({
    content: [
      '.dive-popup-rating__value { width:120px !important; min-width:120px !important; visibility:hidden !important; }',
      minimumPopupHeight ? `.leaflet-popup.dive-site-popup { min-height:${minimumPopupHeight}px !important; }` : ''
    ].join('\n')
  });
}

async function expectMapViewUnchanged(page, before, after) {
  expect(after.zoom).toBe(before.zoom);
  const displacementPx = await page.evaluate(([start, end]) => {
    const map = window.__DIVEATLAS_TEST__.map;
    const a = map.project(window.L.latLng(start.lat, start.lng), start.zoom);
    const b = map.project(window.L.latLng(end.lat, end.lng), end.zoom);
    return a.distanceTo(b);
  }, [before.center, after.center]);
  // Leaflet rounds its pixel origin, which can change getCenter by a fraction of a pixel.
  expect(displacementPx).toBeLessThanOrEqual(1);
}

test('aggregate Coral marker zooms and never opens details', async ({ page }) => {
  await addFixture(page, 'aggregate', { id: 'coral-aggregate', lat: -5.7, lng: 131, count: 12 });
  await resetActionCount(page);
  const before = await mapState(page);
  await clickFixture(page, 'coral-aggregate');
  await expect.poll(async () => (await mapState(page)).zoom).toBeGreaterThan(before.zoom);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  expect(await page.evaluate(() => window.__DIVEATLAS_TEST__.getActionCount())).toBe(1);
});

test('individual Coral feature opens details without aggregate zoom', async ({ page }) => {
  await setMapView(page, -5.7, 131, 14);
  await addFixture(page, 'coral-point', { id: 'coral-point', lat: -5.7, lng: 131 });
  const before = await mapState(page);
  await clickFixture(page, 'coral-point');
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  const after = await mapState(page);
  await expectMapViewUnchanged(page, before, after);
  expect(after.popup.type).toBe('species');
  expect(await page.evaluate(() => window.__DIVEATLAS_TEST__.getActionCount())).toBe(1);
});

test('Dive cluster zooms and never opens a single-site popup', async ({ page }) => {
  await addFixture(page, 'dive-aggregate', { id: 'dive-aggregate', lat: -5.7, lng: 131, count: 8 });
  const before = await mapState(page);
  await clickFixture(page, 'dive-aggregate');
  await expect.poll(async () => (await mapState(page)).zoom).toBeGreaterThan(before.zoom);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  expect(await page.evaluate(() => window.__DIVEATLAS_TEST__.getActionCount())).toBe(1);
});

test('individual Dive site opens its details popup', async ({ page }) => {
  const photosScriptUrl = await page.evaluate(() => performance.getEntriesByType('resource')
    .map(entry => entry.name).find(url => url.includes('/datasets/dive-site-photos.js')));
  expect(photosScriptUrl, 'the app-owned dive-site photo metadata should load').toBeTruthy();
  expect(new URL(photosScriptUrl).origin, 'photo metadata stays on the Pages origin').toBe(new URL(page.url()).origin);
  await setMapView(page, -5.7, 131, 14);
  await addFixture(page, 'dive-site', { id: 'dive-single', lat: -5.7, lng: 131 });
  const before = await mapState(page);
  await clickFixture(page, 'dive-single');
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  const popupWidth = await page.locator('.leaflet-popup').evaluate(element => element.getBoundingClientRect().width);
  expect(popupWidth).toBeCloseTo(page.viewportSize().width <= 720 ? 320 : 360, 0);
  const after = await mapState(page);
  expect(after.popup.type).toBe('dive');
  await expect(page.locator('.dive-popup-rating__label')).toHaveAttribute('aria-label', 'DiveAtlas Rating');
  await expect(page.locator('.dive-popup-rating__label .dive-brand-rating-logo')).toBeVisible();
  await expect(page.locator('.dive-popup-rating__value')).not.toHaveAttribute('data-status', 'loading', { timeout: 30_000 });
  const ratingValue = page.locator('.dive-popup-rating__value');
  await expect(ratingValue).toContainText('Oct');
  await expect(ratingValue).toContainText(/\d+ · (Challenging|Fair|Good|Excellent)/);
  await expect(ratingValue).not.toContainText('nearby estimate');
  await page.evaluate(() => {
    window.__DIVEATLAS_TEST__.selectEnvironmentalView('dive-experience-outlook');
    const month = document.getElementById('diveExperienceMonth');
    month.value = '6';
    month.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await clickFixture(page, 'dive-single');
  await expect(ratingValue).toContainText('Jun');
  await page.evaluate(() => {
    window.__DIVEATLAS_TEST__.selectEnvironmentalView('water-clarity');
    const month = document.getElementById('waterClarityMonth');
    month.value = '8';
    month.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await clickFixture(page, 'dive-single');
  await expect(ratingValue).toContainText('Aug');
  for (const [view, selector, month, label] of [
    ['temperature', 'temperatureMonth', '9', 'Sep'],
    ['currents', 'currentsMonth', '7', 'Jul'],
    ['waves', 'wavesMonth', '4', 'Apr']
  ]) {
    await page.evaluate(([nextView, selectId, nextMonth]) => {
      window.__DIVEATLAS_TEST__.selectEnvironmentalView(nextView);
      const monthSelect = document.getElementById(selectId);
      monthSelect.value = nextMonth;
      monthSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }, [view, selector, month]);
    await clickFixture(page, 'dive-single');
    await expect(ratingValue).toContainText(label);
  }
  await page.evaluate(() => window.__DIVEATLAS_TEST__.selectEnvironmentalView('tide'));
  await clickFixture(page, 'dive-single');
  const localMonth = await page.evaluate(() => new Intl.DateTimeFormat('en', { month:'short' }).format(new Date()));
  await expect(ratingValue).toContainText(localMonth);
  await expectMapViewUnchanged(page, before, after);
});

test('Fish aggregate zooms instead of opening a details popup', async ({ page }) => {
  await addFixture(page, 'fish-aggregate', { id: 'fish-aggregate', lat: -5.7, lng: 131, count: 9 });
  const before = await mapState(page);
  await clickFixture(page, 'fish-aggregate');
  await expect.poll(async () => (await mapState(page)).zoom).toBeGreaterThan(before.zoom);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
});

test('individual Fish feature opens details without aggregate zoom', async ({ page }) => {
  await setMapView(page, -5.7, 131, 14);
  await addFixture(page, 'fish-point', { id: 'fish-single', lat: -5.7, lng: 131 });
  const before = await mapState(page);
  await clickFixture(page, 'fish-single');
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  const after = await mapState(page);
  await expectMapViewUnchanged(page, before, after);
  expect(after.popup.type).toBe('fish');
});

test('hidden Coral grid geometry is not clickable after its layer is turned off', async ({ page }) => {
  await addFixture(page, 'coral-grid', { id: 'hidden-grid', lat: -5.7, lng: 131 });
  const point = await fixturePoint(page, 'hidden-grid');
  await expect(page.locator('#speciesLayerToggle')).toBeChecked();
  await page.locator('label[for="speciesLayerToggle"]').click();
  await page.mouse.click(point.x, point.y);
  await waitForClickResolution(page);
  // This contract is specifically that disabling Coral removes Coral-grid
  // hit targets, regardless of any map inspection state.
  expect((await mapState(page)).popup?.type).not.toBe('coral-grid');
});

test('empty-ocean left click does not open Depth Inspection', async ({ page }) => {
  const map = page.locator('#map');
  const bounds = await map.boundingBox();
  await page.mouse.click(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.48);
  await waitForClickResolution(page);
  // Left click must not start the right-click-only depth inspection flow.
  expect((await mapState(page)).popup?.type).not.toBe('depth');
});

test('desktop right click on ocean opens Depth Inspection', async ({ page }) => {
  const map = page.locator('#map');
  const bounds = await map.boundingBox();
  const before = await mapState(page);
  await page.mouse.click(bounds.x + bounds.width * 0.52, bounds.y + bounds.height * 0.48, { button: 'right' });
  await expect(page.locator('.leaflet-popup')).toBeVisible({ timeout: 5000 });
  const after = await mapState(page);
  expect(after.popup.type).toBe('depth');
  await expectMapViewUnchanged(page, before, after);
});

test('right click outside the map keeps normal browser context-menu behavior', async ({ page }) => {
  const prevented = await page.locator('#topMenuBar').evaluate(element => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
});

test('hover tooltip near top edge appears below and never moves the map', async ({ page }) => {
  const map = await page.locator('#map').boundingBox();
  await addDiveSiteAtScreenPoint(page, 'hover-top', map.width * 0.55, 68);
  const before = await mapState(page);
  const point = await fixturePoint(page, 'hover-top');
  await page.mouse.move(point.x, point.y);
  const tooltip = page.locator('.leaflet-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveClass(/leaflet-tooltip-bottom/);
  const afterHover = await mapState(page);
  expect(afterHover.center).toEqual(before.center);
  expect(afterHover.zoom).toBe(before.zoom);
  await expect(tooltip).toHaveScreenshot('hover-tooltip-below-top-edge.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.12
  });
  await page.mouse.move(map.x + map.width - 40, map.y + map.height - 45);
  await expect(tooltip).toHaveCount(0);
  expect((await mapState(page)).center).toEqual(before.center);
});

test('top-edge popup is below its anchor on its first visible frame', async ({ page }) => {
  const map = await page.locator('#map').boundingBox();
  await addDiveSiteAtScreenPoint(page, 'popup-top', map.width * 0.52, 68);
  const point = await fixturePoint(page, 'popup-top');
  await page.mouse.click(point.x, point.y);
  const popup = page.locator('.leaflet-popup');
  await expect(popup).toBeVisible();
  await expect(popup).toHaveClass(/diveatlas-popup-below/);
  const state = await mapState(page);
  expect(state.popup.arrowSide).toBe('top');
  const firstVisible = await page.evaluate(() => window.__firstVisiblePopup || null);
  if (firstVisible) {
    expect(firstVisible.className).toContain('diveatlas-popup-below');
    expect(firstVisible.arrowSide).toBe('top');
  }
  await stabilizeDiveRatingScreenshot(page, { minimumPopupHeight:165 });
  await expect(popup).toHaveScreenshot('popup-below-anchor.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.12
  });
});

test('right-edge popup shifts its body while its anchor remains fixed', async ({ page }) => {
  const map = await page.locator('#map').boundingBox();
  await addDiveSiteAtScreenPoint(page, 'popup-right', map.width - 8, map.height * 0.46);
  const pointBefore = await fixturePoint(page, 'popup-right');
  await page.mouse.click(pointBefore.x, pointBefore.y);
  const popup = page.locator('.leaflet-popup');
  await expect(popup).toBeVisible();
  const bounds = await popup.boundingBox();
  const mapBounds = await page.locator('#map').boundingBox();
  const pointAfter = await fixturePoint(page, 'popup-right');
  expect(bounds.x).toBeGreaterThanOrEqual(mapBounds.x - 1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(mapBounds.x + mapBounds.width + 1);
  expect(Math.abs(pointAfter.x - pointBefore.x)).toBeLessThan(1);
  const popupState = (await mapState(page)).popup;
  expect(popupState.arrowSide).toBe('bottom');
  expect(Math.abs(popupState.arrowX - popupState.anchorX)).toBeLessThan(14);
  await stabilizeDiveRatingScreenshot(page);
  await expect(popup).toHaveScreenshot('popup-shifted-from-right-edge.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.12
  });
});

test('left-edge popup shifts its body while its anchor remains fixed', async ({ page }) => {
  const map = await page.locator('#map').boundingBox();
  await addDiveSiteAtScreenPoint(page, 'popup-left', 8, map.height * 0.46);
  const pointBefore = await fixturePoint(page, 'popup-left');
  await page.mouse.click(pointBefore.x, pointBefore.y);
  const popup = page.locator('.leaflet-popup');
  await expect(popup).toBeVisible();
  const bounds = await popup.boundingBox();
  const mapBounds = await page.locator('#map').boundingBox();
  const pointAfter = await fixturePoint(page, 'popup-left');
  expect(bounds.x).toBeGreaterThanOrEqual(mapBounds.x - 1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(mapBounds.x + mapBounds.width + 1);
  expect(Math.abs(pointAfter.x - pointBefore.x)).toBeLessThan(1);
  const popupState = (await mapState(page)).popup;
  expect(Math.abs(popupState.arrowX - popupState.anchorX)).toBeLessThan(14);
});

test('popup near the bottom edge stays above its anchor', async ({ page }) => {
  const map = await page.locator('#map').boundingBox();
  await addDiveSiteAtScreenPoint(page, 'popup-bottom', map.width * 0.52, map.height - 25);
  const point = await fixturePoint(page, 'popup-bottom');
  await page.mouse.click(point.x, point.y);
  const popup = page.locator('.leaflet-popup');
  await expect(popup).toBeVisible();
  const state = await mapState(page);
  expect(state.popup.below).toBe(false);
  expect(state.popup.arrowSide).toBe('bottom');
  const popupBounds = await popup.boundingBox();
  const mapBounds = await page.locator('#map').boundingBox();
  expect(popupBounds.y).toBeGreaterThanOrEqual(mapBounds.y - 1);
  expect(popupBounds.y + popupBounds.height).toBeLessThanOrEqual(mapBounds.y + mapBounds.height + 1);
});

test('opening a boundary popup never moves the map view', async ({ page }) => {
  const map = await page.locator('#map').boundingBox();
  await addDiveSiteAtScreenPoint(page, 'popup-autopan', map.width * 0.86, map.height * 0.50);
  const before = await mapState(page);
  const point = await fixturePoint(page, 'popup-autopan');
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  await expect.poll(async () => (await mapState(page)).popup?.type).toBe('dive');
  const after = await mapState(page);
  expect(after.popup).not.toBeNull();
  await expectMapViewUnchanged(page, before, after);
});

test('popup closes when user navigation moves its anchor outside the usable viewport', async ({ page }) => {
  await setMapView(page, -5.7, 131, 14);
  await addFixture(page, 'dive-site', { id: 'anchor-owner', lat: -5.7, lng: 131 });
  await clickFixture(page, 'anchor-owner');
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  await setMapView(page, -40, 10, 5);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0, { timeout: 4000 });
});

test('popup remains attached when user navigation keeps its anchor visible', async ({ page }) => {
  await setMapView(page, -5.7, 131, 14);
  await addFixture(page, 'dive-site', { id: 'visible-anchor', lat: -5.7, lng: 131 });
  await clickFixture(page, 'visible-anchor');
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  await setMapView(page, -5.7, 131.04, 14);
  await expect.poll(async () => (await mapState(page)).popup?.owner).toContain('visible-anchor');
  expect((await mapState(page)).popup.lifecycle).toBe('open');
});

test('turning the owning Coral layer off closes its popup and clears hover state', async ({ page }) => {
  await setMapView(page, -5.7, 131, 14);
  await addFixture(page, 'coral-point', { id: 'coral-owner', lat: -5.7, lng: 131 });
  await clickFixture(page, 'coral-owner');
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  await expect(page.locator('#speciesLayerToggle')).toBeChecked();
  await page.locator('label[for="speciesLayerToggle"]').click();
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
});

test('grid popup is invalidated when Coral changes from grid to point representation', async ({ page }) => {
  await addFixture(page, 'coral-grid', { id: 'coral-representation', lat: -5.7, lng: 131 });
  const before = await mapState(page);
  await clickFixture(page, 'coral-representation');
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  const afterOpen = await mapState(page);
  expect(afterOpen.popup.type).toBe('coral-grid');
  await expectMapViewUnchanged(page, before, afterOpen);
  await setMapView(page, -5.7, 131, 14);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0, { timeout: 4000 });
});

test('Coral overlay grid popup takes priority over tab map queries', async ({ page }) => {
  await setMapView(page, -5.7, 131, 9);
  await addFixture(page, 'coral-grid', { id: 'coral-priority', lat: -5.7, lng: 131 });

  for (const view of ['tide', 'currents', 'dive-experience-outlook', 'reef-survey-condition']) {
    const selected = await page.evaluate(value =>
      window.__DIVEATLAS_TEST__.selectEnvironmentalView(value), view);
    expect(selected, `could not select ${view}`).toBe(true);
    await expect(page.locator('.leaflet-popup')).toHaveCount(0);
    await clickFixture(page, 'coral-priority');
    await waitForClickResolution(page);
    await expect(page.locator('.leaflet-popup:visible')).toHaveCount(1);
    expect((await mapState(page)).popup.type).toBe('coral-grid');
  }
});

test('Reef extent popup takes priority over Reef Condition map queries', async ({ page }) => {
  await setMapView(page, -5.7, 131, 9);
  await page.evaluate(() => window.__DIVEATLAS_TEST__.addReefArea(-5.7, 131, 'reef-priority'));
  expect(await page.evaluate(() =>
    window.__DIVEATLAS_TEST__.selectEnvironmentalView('reef-survey-condition'))).toBe(true);
  await page.evaluate(() => {
    const map = window.__DIVEATLAS_TEST__.map;
    const latlng = window.L.latLng(-5.7, 131);
    map.fire('click', { latlng, containerPoint: map.latLngToContainerPoint(latlng) });
  });
  await waitForClickResolution(page);
  await expect(page.locator('.leaflet-popup:visible')).toHaveCount(1);
  expect((await mapState(page)).popup.type).toBe('reef');
  await expect(page.locator('.leaflet-popup:visible')).toContainText('Coral reef extent');
});

test('Reef raster popup is available below vector zoom while a tab is selected', async ({ page }) => {
  // This contract checks raster hit testing and popup priority, not public R2
  // availability; keep the fixture deterministic so network latency cannot
  // prevent the interaction from being exercised.
  const opaqueTile = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=',
    'base64'
  );
  await page.route('**/reef_tiles/**', route => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: opaqueTile
  }));
  await setMapView(page, -0.04395, 127.08984, 5);
  await page.evaluate(() => window.__DIVEATLAS_TEST__.setLayerVisibility('reef', true));
  expect(await page.evaluate(() =>
    window.__DIVEATLAS_TEST__.selectEnvironmentalView('reef-survey-condition'))).toBe(true);
  await page.waitForFunction(() => {
    const map = window.__DIVEATLAS_TEST__.map;
    const point = map.latLngToContainerPoint([-0.04395, 127.08984]);
    const rect = map.getContainer().getBoundingClientRect();
    const clientX = rect.left + point.x;
    const clientY = rect.top + point.y;
    return [...map.getContainer().querySelectorAll('.reef-raster-tiles .leaflet-tile')].some(tile => {
      const tileRect = tile.getBoundingClientRect();
      return tile.complete && clientX >= tileRect.left && clientX < tileRect.right &&
        clientY >= tileRect.top && clientY < tileRect.bottom;
    });
  });
  await page.evaluate(() => {
    const map = window.__DIVEATLAS_TEST__.map;
    const latlng = window.L.latLng(-0.04395, 127.08984);
    map.fire('click', { latlng, containerPoint: map.latLngToContainerPoint(latlng) });
  });
  await waitForClickResolution(page);
  await expect(page.locator('.leaflet-popup:visible')).toHaveCount(1);
  expect((await mapState(page)).popup.type).toBe('reef');
});

test('rapid popup replacement leaves the newer popup in control', async ({ page }) => {
  await setMapView(page, -5.7, 131, 14);
  await addFixture(page, 'dive-site', { id: 'popup-a', lat: -5.72, lng: 130.98 });
  await addFixture(page, 'dive-site', { id: 'popup-b', lat: -5.68, lng: 131.02 });
  await clickFixture(page, 'popup-a');
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  await page.locator('.leaflet-popup-close-button').click();
  await clickFixture(page, 'popup-b');
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  await expect.poll(async () => (await mapState(page)).popup?.owner).toContain('popup-b');
  expect((await mapState(page)).popup.lifecycle).toBe('open');
});

test('popup below its anchor keeps its arrow above during dismissal', async ({ page }) => {
  const map = await page.locator('#map').boundingBox();
  await addDiveSiteAtScreenPoint(page, 'closing-arrow', map.width * 0.5, 68);
  const point = await fixturePoint(page, 'closing-arrow');
  await page.mouse.click(point.x, point.y);
  const popup = page.locator('.leaflet-popup');
  await expect(popup).toBeVisible();
  await expect(popup).toHaveClass(/diveatlas-popup-below/);
  await page.locator('.leaflet-popup-close-button').click();
  let closing;
  await expect.poll(async () => {
    closing = await mapState(page);
    return closing.popup?.lifecycle;
  }).toBe('closing');
  expect(closing.popup.below).toBe(true);
  expect(closing.popup.arrowSide).toBe('top');
});

test('one aggregate activation produces at most one semantic action', async ({ page }) => {
  await addFixture(page, 'aggregate', { id: 'single-action', lat: -5.7, lng: 131, count: 5 });
  await resetActionCount(page);
  await clickFixture(page, 'single-action', { clickCount: 1 });
  await waitForClickResolution(page);
  expect(await page.evaluate(() => window.__DIVEATLAS_TEST__.getActionCount())).toBeLessThanOrEqual(1);
});
