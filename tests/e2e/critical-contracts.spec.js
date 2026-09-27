const { test, expect } = require('@playwright/test');
const {
  addDiveSiteAtScreenPoint,
  addFixture,
  clickFixture,
  expectNoPopup,
  fixturePoint,
  mapState,
  openMap,
  resetActionCount,
  setMapView,
  waitForClickResolution
} = require('./support');

test.beforeEach(async ({ page }) => openMap(page));

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
  expect(after.zoom).toBe(before.zoom);
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
  await setMapView(page, -5.7, 131, 14);
  await addFixture(page, 'dive-site', { id: 'dive-single', lat: -5.7, lng: 131 });
  await clickFixture(page, 'dive-single');
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  expect((await mapState(page)).popup.type).toBe('dive');
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
  expect((await mapState(page)).zoom).toBe(before.zoom);
  expect((await mapState(page)).popup.type).toBe('fish');
});

test('hidden Coral grid geometry is not clickable after its layer is turned off', async ({ page }) => {
  await addFixture(page, 'coral-grid', { id: 'hidden-grid', lat: -5.7, lng: 131 });
  const point = await fixturePoint(page, 'hidden-grid');
  await expect(page.locator('#speciesLayerToggle')).toBeChecked();
  await page.locator('label[for="speciesLayerToggle"]').click();
  await page.mouse.click(point.x, point.y);
  await expectNoPopup(page);
});

test('empty-ocean left click does not open Depth Inspection', async ({ page }) => {
  const map = page.locator('#map');
  const bounds = await map.boundingBox();
  await page.mouse.click(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.48);
  await expectNoPopup(page);
});

test('desktop right click on ocean opens Depth Inspection', async ({ page }) => {
  const map = page.locator('#map');
  const bounds = await map.boundingBox();
  await page.mouse.click(bounds.x + bounds.width * 0.52, bounds.y + bounds.height * 0.48, { button: 'right' });
  await expect(page.locator('.leaflet-popup')).toBeVisible({ timeout: 5000 });
  expect((await mapState(page)).popup.type).toBe('depth');
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
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  const state = await mapState(page);
  expect(state.popup.below).toBe(false);
  expect(state.popup.arrowSide).toBe('bottom');
  await expect(page.locator('.leaflet-popup')).toHaveScreenshot('popup-above-anchor.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.12
  });
});

test('popup remains open after internal boundary auto-pan', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 360 });
  await page.evaluate(() => window.__DIVEATLAS_TEST__.map.invalidateSize({ animate: false }));
  const map = await page.locator('#map').boundingBox();
  await addDiveSiteAtScreenPoint(page, 'popup-autopan', map.width * 0.86, map.height * 0.50);
  const before = await mapState(page);
  const point = await fixturePoint(page, 'popup-autopan');
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  await expect.poll(async () => (await mapState(page)).popup?.type).toBe('dive');
  const after = await mapState(page);
  expect(after.popup).not.toBeNull();
  expect(after.zoom).toBe(before.zoom);
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
  await clickFixture(page, 'coral-representation');
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  expect((await mapState(page)).popup.type).toBe('coral-grid');
  await setMapView(page, -5.7, 131, 14);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0, { timeout: 4000 });
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
  await expect.poll(async () => (await mapState(page)).popup?.lifecycle).toBe('closing');
  const closing = await mapState(page);
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
