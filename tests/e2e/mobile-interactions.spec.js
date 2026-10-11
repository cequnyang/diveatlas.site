const { test, expect } = require('@playwright/test');
const {
  addFixture,
  mapState,
  openMap,
  resetActionCount,
  setMapView,
  waitForClickResolution
} = require('./support');

test.beforeEach(async ({ page }, testInfo) => openMap(page, {
  disableLegendAutoCollapse: testInfo.title !== 'mobile layer rows toggle across the row and the collapsed bar shrinks after idle'
}));

test('mobile layer rows toggle across the row and the collapsed bar shrinks after idle', async ({ page }) => {
  const panel = page.locator('#bioLegend');
  const title = page.locator('#bioLegendTitle');
  const terrain = page.locator('#terrainLayerToggle');
  const label = page.locator('#terrainLegendLabel');

  await expect(panel).toHaveClass(/is-collapsed/);
  await expect(panel).not.toHaveClass(/is-mobile-auto-collapsed/);
  await title.click();
  await expect(panel).not.toHaveClass(/is-collapsed/);
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

  await title.click();
  await expect(panel).not.toHaveClass(/is-collapsed/);
  await page.setViewportSize({ width: 900, height: 900 });
  const desktopTerrainState = await terrain.isChecked();
  await label.click();
  await expect(terrain).toHaveJSProperty('checked', desktopTerrainState);
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
