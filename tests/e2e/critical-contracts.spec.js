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
  expect(popupWidth).toBeCloseTo(page.viewportSize().width <= 720 ? page.viewportSize().width : 360, 0);
  const after = await mapState(page);
  expect(after.popup.type).toBe('dive');
  await expect(page.locator('.dive-popup-rating__label')).toHaveAttribute('aria-label', 'DiveAtlas Rating');
  await expect(page.locator('.dive-popup-rating__label .dive-brand-rating-logo')).toBeVisible();
  await expect(page.locator('.dive-popup-rating__value')).not.toHaveAttribute('data-status', 'loading', { timeout: 30_000 });
  const ratingValue = page.locator('.dive-popup-rating__value');
  const currentMonth = await page.evaluate(() => new Intl.DateTimeFormat('en', { month:'short' }).format(new Date()));
  await expect(ratingValue).toContainText(currentMonth);
  await expect(ratingValue).toContainText(/\d+ · (Challenging|Fair|Good|Excellent)/);
  await expect(ratingValue).not.toContainText('nearby estimate');
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
  expect(popupState.arrowSide).toBe('top');
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

test('popup near the bottom edge flips above its anchor when below has no space', async ({ page }) => {
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

test('popup remains attached when zoom keeps its anchor inside the usable viewport', async ({ page }) => {
  await setMapView(page, -5.7, 131, 14);
  await addFixture(page, 'dive-site', { id: 'visible-anchor', lat: -5.7, lng: 131 });
  await clickFixture(page, 'visible-anchor');
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  const initialZoom = await page.evaluate(() => window.__DIVEATLAS_TEST__.map.getZoom());
  await page.evaluate(zoom => window.__DIVEATLAS_TEST__.map.setZoom(zoom, { animate:false }), initialZoom - 1);
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.map.getZoom())).toBeLessThan(initialZoom);
  await expect.poll(async () => (await mapState(page)).popup?.owner).toContain('visible-anchor');
  expect((await mapState(page)).popup.lifecycle).toBe('open');
  await page.evaluate(zoom => window.__DIVEATLAS_TEST__.map.setZoom(zoom, { animate:false }), initialZoom);
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.map.getZoom())).toBe(initialZoom);
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

test('grid popup stays attached when Coral changes from grid to point representation', async ({ page }) => {
  await addFixture(page, 'coral-grid', { id: 'coral-representation', lat: -5.7, lng: 131 });
  const before = await mapState(page);
  await clickFixture(page, 'coral-representation');
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  const afterOpen = await mapState(page);
  expect(afterOpen.popup.type).toBe('coral-grid');
  await expectMapViewUnchanged(page, before, afterOpen);
  await setMapView(page, -5.7, 131, 14);
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  await expect.poll(async () => (await mapState(page)).popup?.owner).toContain('coral-representation');
  expect((await mapState(page)).popup.type).toBe('coral-grid');
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

test('compact share state round-trips aliases, map layers, selections, coordinates, and flow', async ({ page }) => {
  const result = await page.evaluate(() => {
    const source = {
      center: { lat:-0.55081, lng:130.70196 },
      zoom:15,
      layers:{ contours:false, currents:false, terrain:false, reef:true, species:false, fish:false, dive:true },
      view:'temperature',
      popup:{ layer:'currents', lat:-0.55297, lng:130.69799 },
      popupFlow:'ru',
      selections:{ month:7, temperatureDepth:0, currentDepth:'20' }
    };
    const serialized = window.__DIVEATLAS_TEST__.serializeShareState(source);
    const parsed = window.__DIVEATLAS_TEST__.parseShareUrl(`https://diveatlas.test/?${serialized}`);
    const reserialized = window.__DIVEATLAS_TEST__.serializeShareState(parsed);
    return { serialized, parsed, reserialized };
  });

  const params = new URLSearchParams(result.serialized);
  expect(params.get('g')).toMatch(/^[0-9a-z]{20}$/);
  expect(params.get('l')).toBe('r,d');
  expect(params.get('v')).toBe('t');
  expect(params.get('p')).toBe('c');
  expect(params.get('f')).toBe('ru');
  expect(params.get('m')).toBe('7');
  expect(params.get('td')).toBe('0');
  expect(params.get('cd')).toBe('20');
  for (const longKey of ['lat', 'lng', 'layers', 'view', 'popup', 'plat', 'plng', 'flow', 'month', 'temperatureDepth', 'currentDepth']) {
    expect(params.has(longKey), `${longKey} should use its compact representation`).toBe(false);
  }

  expect(result.parsed.center.lat).toBeCloseTo(-0.55081, 5);
  expect(result.parsed.center.lng).toBeCloseTo(130.70196, 5);
  expect(result.parsed.popup.layer).toBe('currents');
  expect(result.parsed.popup.lat).toBeCloseTo(-0.55297, 5);
  expect(result.parsed.popup.lng).toBeCloseTo(130.69799, 5);
  expect(result.parsed.layers).toMatchObject({ reef:true, dive:true, species:false });
  expect(result.parsed.view).toBe('temperature');
  expect(result.parsed.selections).toMatchObject({ month:7, temperatureDepth:0, currentDepth:'20' });
  expect(result.reserialized).toBe(result.serialized);
});

test('share preview shortens long site summaries and saves only after a share action', async ({ page }) => {
  await setMapView(page, -5.7, 131, 14);
  await addFixture(page, 'dive-site', { id: 'long-share-summary', lat: -5.7, lng: 131 });
  await clickFixture(page, 'long-share-summary');
  const sitePopup = page.locator('.leaflet-popup.dive-site-popup');
  await expect(sitePopup).toBeVisible();
  const longSummary = 'The SSI MyDiveGuide profile snapshot reports a maximum depth of 20 meters and lists advanced difficulty for this remote reef dive site.';
  await sitePopup.locator('.leaflet-popup-content').evaluate((content, text) => {
    let summary = content.querySelector('.dive-popup-summary');
    if (!summary) {
      summary = document.createElement('div');
      summary.className = 'dive-popup-summary';
      content.append(summary);
    }
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    summary.replaceChildren(paragraph);
  }, longSummary);

  const previewRequests = [];
  await page.route('https://share.diveatlas.site/map-preview-upload/**', async route => {
    const request = route.request();
    previewRequests.push({ method:request.method(), url:request.url() });
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status:204, headers:{
        'Access-Control-Allow-Origin':'*',
        'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers':'Content-Type'
      } });
    }
    const renderFallback = new URL(request.url()).searchParams.get('render') === '1';
    return route.fulfill({
      status:request.method() === 'POST' || renderFallback ? 201 : 404,
      headers:{ 'Access-Control-Allow-Origin':'*' }
    });
  });

  const sheetShareButton = sitePopup.locator('.diveatlas-sheet-share-button');
  if (await sheetShareButton.count()) await sheetShareButton.click();
  else await page.locator('#shareMapButton').click();
  const dialog = page.getByRole('dialog', { name:'Share' });
  await expect(dialog).toBeVisible();
  const preview = page.locator('#sharePreviewPopupData');
  await expect(preview).toBeVisible();
  const compactSummary = await preview.locator('li').filter({ hasText:'The SSI MyDiveGuide' }).first().innerText();
  expect(Array.from(compactSummary).length).toBeLessThanOrEqual(72);
  expect(compactSummary).toMatch(/…$/);
  expect(compactSummary).not.toBe(longSummary);
  expect(await preview.locator('li').count()).toBeLessThanOrEqual(6);
  const previewBounds = await page.evaluate(() => {
    const frame = document.querySelector('#sharePreviewFrame').getBoundingClientRect();
    const card = document.querySelector('#sharePreviewPopupData').getBoundingClientRect();
    return { frame, card, scrollHeight:document.querySelector('#sharePreviewPopupData').scrollHeight,
      clientHeight:document.querySelector('#sharePreviewPopupData').clientHeight };
  });
  expect(previewBounds.card.left).toBeGreaterThanOrEqual(previewBounds.frame.left);
  expect(previewBounds.card.right).toBeLessThanOrEqual(previewBounds.frame.right);
  expect(previewBounds.card.top).toBeGreaterThanOrEqual(previewBounds.frame.top);
  expect(previewBounds.card.bottom).toBeLessThanOrEqual(previewBounds.frame.bottom);
  expect(previewBounds.scrollHeight).toBeLessThanOrEqual(previewBounds.clientHeight);
  expect(previewRequests).toEqual([]);

  await dialog.getByRole('button', { name:'Copy link' }).click();
  await expect.poll(() => previewRequests.some(request => request.method === 'GET')).toBe(true);
  await expect.poll(() => previewRequests.some(request => request.method === 'POST' || new URL(request.url).searchParams.get('render') === '1')).toBe(true);
});

test('legacy long-form share URLs remain readable and preserve a site popup flow', async ({ page }) => {
  const parsed = await page.evaluate(() => window.__DIVEATLAS_TEST__.parseShareUrl(
    'https://diveatlas.test/?lat=-0.550810&lng=130.701964&z=15&layers=reef,dive&view=dive-experience-outlook&site=site-123&popup=currents&plat=-0.552975&plng=130.697998&flow=sru&month=7&currentDepth=20'
  ));

  expect(parsed.center.lat).toBeCloseTo(-0.55081, 5);
  expect(parsed.center.lng).toBeCloseTo(130.701964, 5);
  expect(parsed.layers).toMatchObject({ reef:true, dive:true });
  expect(parsed.view).toBe('dive-experience-outlook');
  expect(parsed.popup).toEqual({ layer:'currents', lat:-0.552975, lng:130.697998 });
  expect(parsed.requestedSiteId).toBe('site-123');
  expect(parsed.popupFlow).toMatchObject({ id:'sru', parentLayer:'dive-rating', childLayer:'currents', siteAncestor:true });

  const reserialized = new URLSearchParams(await page.evaluate(state =>
    window.__DIVEATLAS_TEST__.serializeShareState(state, { includeSite:false }), parsed
  ));
  expect(reserialized.get('f')).toBe('sru');
  expect(reserialized.get('p')).toBe('c');
  expect(reserialized.get('g')).toMatch(/^[0-9a-z]{20}$/);
});

test('all supported popup flow codes decode to their declared parent and child', async ({ page }) => {
  const flows = [
    ['rt', 'dive-rating', 'temperature', false], ['rc', 'dive-rating', 'water-clarity', false],
    ['ru', 'dive-rating', 'currents', false], ['rw', 'dive-rating', 'waves', false],
    ['ct', 'dive-conditions', 'temperature', false], ['cc', 'dive-conditions', 'water-clarity', false],
    ['cu', 'dive-conditions', 'currents', false], ['cw', 'dive-conditions', 'waves', false],
    ['srt', 'dive-rating', 'temperature', true], ['src', 'dive-rating', 'water-clarity', true],
    ['sru', 'dive-rating', 'currents', true], ['srw', 'dive-rating', 'waves', true],
    ['sct', 'dive-conditions', 'temperature', true], ['scc', 'dive-conditions', 'water-clarity', true],
    ['scu', 'dive-conditions', 'currents', true], ['scw', 'dive-conditions', 'waves', true]
  ];
  const decoded = await page.evaluate(cases => cases.map(([id, parentLayer, childLayer, siteAncestor]) => {
    const coordinateQuery = new URLSearchParams(window.__DIVEATLAS_TEST__.serializeShareState({
      center:{ lat:0, lng:0 }, popup:{ layer:childLayer, lat:0, lng:0 }, zoom:8, layers:{}
    }));
    const params = new URLSearchParams({ p:coordinateQuery.get('p'), f:id, g:coordinateQuery.get('g') });
    if (siteAncestor) params.set('s', 'site-123');
    const state = window.__DIVEATLAS_TEST__.parseShareUrl(`https://diveatlas.test/?${params}`);
    return { expected:{ id, parentLayer, childLayer, siteAncestor }, actual:state.popupFlow || null };
  }), flows);

  for (const { expected, actual } of decoded) {
    expect(actual).toMatchObject(expected);
  }
});

test('invalid packed coordinates fall back to valid legacy coordinates', async ({ page }) => {
  const parsed = await page.evaluate(() => window.__DIVEATLAS_TEST__.parseShareUrl(
    'https://diveatlas.test/?g=invalid&lat=0&lng=180&z=8&popup=currents&plat=-90&plng=-180'
  ));

  expect(parsed.center).toEqual({ lat:0, lng:180 });
  expect(parsed.popup).toEqual({ layer:'currents', lat:-90, lng:-180 });
});

test('packed coordinates retain zero and geographic boundary values within quantization precision', async ({ page }) => {
  const results = await page.evaluate(() => {
    const serialize = window.__DIVEATLAS_TEST__.serializeShareState;
    const parse = window.__DIVEATLAS_TEST__.parseShareUrl;
    return [[0, 0], [90, 180], [-90, -180], [12.345678, 179.999999]].map(([lat, lng]) => {
      const query = serialize({ center:{ lat, lng }, zoom:8, layers:{} });
      return { expected:{ lat, lng }, actual:parse(`https://diveatlas.test/?${query}`).center };
    });
  });

  for (const { expected, actual } of results) {
    expect(actual.lat).toBeCloseTo(expected.lat, 4);
    const normalizedLongitude = ((expected.lng + 180) % 360 + 360) % 360 - 180;
    expect(actual.lng).toBeCloseTo(normalizedLongitude, 4);
  }
});
