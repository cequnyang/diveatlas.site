const { test, expect } = require('@playwright/test');
// Headless Chromium normally hides native scrollbars, masking header gaps.
test.use({ launchOptions:{ ignoreDefaultArgs:['--hide-scrollbars'] } });

test('glass popup interactions do not reach the map underneath', async ({ page, hasTouch }) => {
  const { openMap, setMapView, mapState, waitForClickResolution } = require('./support');
  await openMap(page);
  await setMapView(page, -5.7, 131, 10);
  await page.evaluate(() => window.__DIVEATLAS_TEST__.setLegendCollapsed(true));
  await page.evaluate(() => window.__DIVEATLAS_TEST__.map.openPopup('<p>Popup interaction boundary</p>', [-5.7, 131], { autoPan:false }));
  const popup = page.locator('.leaflet-popup');
  await expect(popup).toBeVisible();
  await popup.locator('.leaflet-popup-content').evaluate(el => {
    const button = document.createElement('button');
    button.id = 'panel-interaction-probe';
    button.textContent = 'Panel control';
    button.onclick = () => button.dataset.clicked = 'true';
    el.prepend(button);
  });
  // Mobile placement may finish panning the sheet into its safe viewport.
  // Measure the interaction only after that opening movement settles.
  await waitForClickResolution(page);
  const button = page.locator('#panel-interaction-probe');
  const bounds = await button.boundingBox();
  const point = { x:bounds.x + bounds.width / 2, y:bounds.y + bounds.height / 2 };
  // Put a real geographic hover target directly beneath the panel control.
  await page.evaluate(point => {
    const api = window.__DIVEATLAS_TEST__;
    const rect = document.getElementById('map').getBoundingClientRect();
    const latlng = api.latLngAt(point.x - rect.left, point.y - rect.top);
    api.addCoralGrid(latlng.lat, latlng.lng, 'under-panel');
    api.clearActionCount();
  }, point);
  const before = await mapState(page);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('.leaflet-tooltip:visible')).toHaveCount(0);
  if (hasTouch) await button.tap(); else await button.click();
  await expect(button).toHaveAttribute('data-clicked', 'true');
  await page.mouse.wheel(0, 300);
  await waitForClickResolution(page);
  const after = await mapState(page);
  expect(after.center).toEqual(before.center);
  expect(after.zoom).toBe(before.zoom);
  expect(after.actionCount).toBe(0);
  expect(after.popup?.owner).toBe(before.popup?.owner);
  await expect(page.locator('.leaflet-tooltip:visible')).toHaveCount(0);
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('global-coral-map-tutorial-suppressed-v1', '1');
    localStorage.setItem('diveatlas-tutorial-seen-v1', '1');
    localStorage.setItem('global-coral-map-theme', 'light');
  });
  await page.route('https://**', route => route.abort());
  await page.route('**/api/auth/me', route => route.fulfill({ json:{ user:null } }));
  await page.route('**/plain-page-fixture.html', route => route.fulfill({
    contentType:'text/html',
    body:'<!doctype html><html><head><title>Plain document</title><link rel="stylesheet" href="/assets/site-header.css?v=1"><script src="/js/site-header.js?v=1" defer></script></head><body><main><h1>Plain document</h1></main></body></html>'
  }));
});

test('welcome offers real destination and month paths without blocking the map', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.goto('/');
  const welcome = page.locator('#mapWelcome');
  await expect(welcome).toBeVisible();
  await expect(page.locator('#tutorialBackdrop')).toBeHidden();
  await expect(page.locator('#bioLegendTitle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#mapWelcomeSearch')).toBeVisible();
  // This checks the real map control outside the panel, not a synthetic click
  // through an overlay. Welcome must remain nonmodal on both viewport sizes.
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Current location', exact: true })).toBeVisible();
  await expect(welcome).toBeVisible();
  await welcome.locator('[data-action="month"]').click();
  await page.locator('#mapWelcomeMonth').selectOption('4');
  await welcome.locator('[data-action="next"]').click();
  await welcome.locator('[data-action="apply"]').click();
  await expect(welcome).toBeHidden();
  await expect(page.locator('#diveExperienceMonth')).toHaveValue('4');
  await expect(page.getByRole('button', { name: 'Current location', exact: true })).toBeVisible();
  await expect(page.locator('input[name="environmentView"][value="dive-experience-outlook"]')).toBeChecked();
  await expect(page.locator('#bioLegendTitle')).toHaveAttribute('aria-expanded', 'false');
});

test('welcome hides the month path when Outlook is disabled and keeps map and guide access', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('global-coral-map-tutorial-suppressed-v1');
    window.DIVEATLAS_FEATURE_FLAGS = { diveExperienceOutlook: false };
  });
  await page.goto('/');
  const welcome = page.locator('#mapWelcome');
  await expect(welcome).toBeVisible();
  await expect(welcome.locator('[data-action="month"]')).toBeHidden();
  await expect(page.locator('#mapWelcomeMonthPanel')).toBeHidden();
  await expect(welcome.locator('[data-action="destination"]')).toBeVisible();
  await expect(welcome.locator('[data-action="browse"]')).toBeVisible();
  await welcome.locator('[data-action="language"]').click();
  await page.locator('#languageDropdown [data-language="zh"]').click();
  await expect(page.locator('#languageDropdown')).toBeHidden();
  await expect(welcome.locator('[data-action="month"]')).toBeHidden();
  await welcome.locator('[data-action="guide"]').click();
  await expect(welcome).toBeHidden();
  await expect(page.locator('#tutorialBackdrop')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tutorialBackdrop')).toBeHidden();
  await expect(welcome).toBeVisible();
  await expect(welcome.locator('[data-action="month"]')).toBeHidden();
  await welcome.locator('[data-action="next"]').click();
  await expect(page.locator('#mapWelcomeReviewPanel')).toBeVisible();
  await expect(page.locator('#mapWelcomeMonthPanel')).toBeHidden();
  await welcome.locator('[data-action="apply"]').click();
  await expect(welcome).toBeHidden();
});

test('welcome carries the live map area and month through one guide', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.goto('/?__diveatlas_test=1');
  const welcome = page.locator('#mapWelcome');
  await expect(welcome.locator('[data-action="apply"]')).toBeHidden();
  const before = await page.evaluate(() => window.__DIVEATLAS_TEST__.map.getCenter());
  const x = page.viewportSize().width > 600 ? 760 : 100;
  await page.mouse.move(x,160);await page.mouse.down();
  await page.mouse.move(x + 70,210,{steps:12});await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.map.getCenter().lng)).not.toBe(before.lng);
  await welcome.locator('[data-action="next"]').click();
  await expect(page.locator('#mapWelcomeMonthPanel')).toBeVisible();
  await page.locator('#mapWelcomeMonth').selectOption('4');
  const panelPreference = await page.evaluate(() => localStorage.getItem('global-coral-map-legend-collapsed-v1'));
  await welcome.locator('[data-action="guide"]').click();
  await expect(page.locator('#tutorialBackdrop')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#mapWelcomeMonthPanel')).toBeVisible();
  await expect(page.locator('#mapWelcomeMonth')).toHaveValue('4');
  expect(await page.evaluate(() => localStorage.getItem('global-coral-map-legend-collapsed-v1'))).toBe(panelPreference);
  await welcome.locator('[data-action="next"]').click();
  await expect(page.locator('#mapWelcomeMonthValue')).toHaveText('April');
  await welcome.locator('[data-action="back"]').click();
  await expect(page.locator('#mapWelcomeMonth')).toHaveValue('4');
  await welcome.locator('[data-action="next"]').click();
  const selectedArea = await page.evaluate(() => window.__DIVEATLAS_TEST__.map.getCenter());
  await expect(page.locator('#mapWelcomeReviewPanel')).toContainText(selectedArea.lng.toFixed(2));
  await welcome.locator('[data-action="apply"]').click();
  await expect(welcome).toBeHidden();
  await expect(page.locator('#diveExperienceMonth')).toHaveValue('4');
  const center = await page.evaluate(() => window.__DIVEATLAS_TEST__.map.getCenter());
  expect(center.lat).toBeCloseTo(selectedArea.lat,5);
  expect(center.lng).toBeCloseTo(selectedArea.lng,5);
  expect(new URL(page.url()).pathname).toBe('/');
});

for (const selection of ['pointer','keyboard']) {
test(`welcome searches inline and selects on the real map with ${selection}`, async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.goto('/?__diveatlas_test=1');
  const input = page.locator('#mapWelcomeSearch');
  const guideBeforeSearch = await page.locator('#mapWelcome').boundingBox();
  await input.fill('Raja Ampat');
  const first = page.locator('#diveSearchResultsScroll [role="option"]').first();
  await expect(first).toBeVisible({timeout:15000});
  const guideWithResults = await page.locator('#mapWelcome').boundingBox();
  expect(guideWithResults.height).toBeCloseTo(guideBeforeSearch.height,0);
  expect(guideWithResults.y).toBeCloseTo(guideBeforeSearch.y,0);
  await expect(page.locator('#mapWelcomeSearchPanel')).toHaveCount(0);
  const menu = await page.locator('#diveSearchResults').boundingBox();
  const viewport = page.viewportSize();
  expect(menu.y).toBeGreaterThanOrEqual(0);
  expect(menu.y + menu.height).toBeLessThanOrEqual(viewport.height);
  await expect(input).toBeFocused();
  await expect(page.locator('#diveSearchInput')).toHaveValue('');
  await expect(first).toHaveAttribute('data-area-key',/region:/);
  await expect(first).not.toHaveAttribute('data-site-index',/.+/);
  const selected = await first.getAttribute('data-area-key');
  const target = await page.evaluate(key => {
    const area = window.DiveAtlasAreaSearch.build(window.DIVE_SITES_DATA,window.DIVE_SITE_SEARCH_LOCATIONS).find(area => area.key === key);
    return window.DiveAtlasAreaSearch.bounds(area.points);
  },selected);
  if (selection === 'keyboard') {
    await input.press('Escape');
    await expect(page.locator('#diveSearchResults')).toBeHidden();
    await expect(page.locator('#mapWelcome')).toBeVisible();
    await input.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant','dive-search-result-0');
    await input.press('Enter');
  } else await first.click();
  await expect(page.locator('#diveSearchResults')).toBeHidden();
  await expect(input).toBeFocused();
  await expect.poll(() => page.evaluate(bounds => bounds.every(point => window.__DIVEATLAS_TEST__.map.getBounds().contains(point)),target)).toBe(true);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  await page.locator('#mapWelcome [data-action="next"]').click();
  await expect(page.locator('#mapWelcomeMonthPanel')).toBeVisible();
  await page.locator('#mapWelcome [data-action="back"]').click();
  await expect(page.locator('#mapWelcomeDestinationPanel')).toBeVisible();
});
}

for (const areaInput of ['guide','header']) {
test(`welcome area selection cancels pending site details through ${areaInput} and completes the guide`, async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.goto('/?__diveatlas_test=1');
  // Warm the catalogue before making the two competing selections. Waiting
  // after the second selection exercises both the 200ms and 950ms callbacks.
  const guide = page.locator('#mapWelcomeSearch');
  await guide.fill('Raja Ampat');
  await expect(page.locator('#diveSearchResults [data-area-key]').first()).toBeVisible({timeout:15000});
  await guide.press('Escape');
  if (await page.locator('#diveSearchToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#diveSearchToggle').click();
  const header = page.locator('#diveSearchInput');
  await header.fill('Bali');
  await page.locator('#diveSearchResults [data-site-index]').first().click();
  if (areaInput === 'guide') await guide.fill('Raja Ampat');
  else {
    await header.fill('Raja Ampat');
    await page.locator('#diveSearchResults [data-search-mode="areas"]').click();
  }
  await page.locator('#diveSearchResults [data-area-key]').first().click();
  const selectedView = await page.evaluate(() => {
    const map = window.__DIVEATLAS_TEST__.map;return {lat:map.getCenter().lat,lng:map.getCenter().lng,zoom:map.getZoom()};
  });
  await page.waitForTimeout(1300);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  const settledView = await page.evaluate(() => {
    const map = window.__DIVEATLAS_TEST__.map;return {lat:map.getCenter().lat,lng:map.getCenter().lng,zoom:map.getZoom()};
  });
  for (const key of ['lat','lng','zoom']) expect(settledView[key]).toBeCloseTo(selectedView[key],5);
  const frame = page.locator('#mapWelcome');
  await frame.locator('[data-action="next"]').click();
  await page.locator('#mapWelcomeMonth').click();
  await page.locator('#mapWelcomeMonth-wheel-option-3').click();
  await frame.locator('[data-action="next"]').click();
  await expect(page.locator('#mapWelcomeMonthValue')).toHaveText('April');
  await frame.locator('[data-action="apply"]').click();
  await expect(frame).toBeHidden();
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
});
}

async function recordedAreaExtent(page,name) {
  // Independently inspect the recorded points, not the bounds helper used by
  // production fitting. Normalize world copies for dateline-spanning areas.
  return page.evaluate(name => {
    const map = window.__DIVEATLAS_TEST__.map, center = map.getCenter(), size = map.getSize();
    const locations = window.DIVE_SITE_SEARCH_LOCATIONS.bySiteId;
    const rows = window.DIVE_SITES_DATA.filter(site => name === 'Pacific Ocean'
      ? (locations[String(site[12])]?.oceanArea || []).includes(name) : site[9] === name);
    const outside = rows.filter(site => {
      const lng = Number(site[2]) + 360*Math.round((center.lng-Number(site[2]))/360);
      const point = map.latLngToContainerPoint([Number(site[1]),lng]);
      return point.x < 0 || point.x > size.x || point.y < 0 || point.y > size.y;
    });
    return {total:rows.length,outside:outside.length,zoom:map.getZoom(),minZoom:map.getMinZoom()};
  },name);
}

for (const name of ['Pacific Ocean','Fiji']) {
test(`welcome area fit includes every recorded location for ${name}`, async ({ page },testInfo) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.goto('/?__diveatlas_test=1');
  await page.locator('#mapWelcomeSearch').fill(name);
  await page.locator('#diveSearchResults [data-area-key]').first().click();
  const extent = await recordedAreaExtent(page,name);
  await testInfo.attach('area-extent',{body:JSON.stringify(extent),contentType:'application/json'});
  expect(extent.total).toBeGreaterThan(0);
  expect(extent.outside).toBe(0);
  expect(extent.minZoom).toBeCloseTo(Math.min(2,extent.zoom),5);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  await expect(page.locator('#mapWelcome')).toBeVisible();
});
}

for (const viewport of [{width:844,height:390},{width:568,height:320}]) {
test(`welcome large area fits in landscape ${viewport.width}x${viewport.height} and restores the normal zoom floor`, async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.setViewportSize(viewport);
  await page.goto('/?__diveatlas_test=1');
  await page.locator('#mapWelcomeSearch').fill('Pacific Ocean');
  await page.locator('#diveSearchResults [data-area-key]').first().click();
  expect((await recordedAreaExtent(page,'Pacific Ocean')).outside).toBe(0);
  for (let clicks=0;clicks<3 && await page.evaluate(() => window.__DIVEATLAS_TEST__.map.getZoom()) < 2;clicks++) {
    await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  }
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.map.getMinZoom())).toBe(2);
  await expect(page.locator('#mapWelcome')).toBeVisible();
});
}

test('top site selection still opens details and restores normal zoom limits after a large area overview', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.goto('/?__diveatlas_test=1');
  await page.locator('#mapWelcomeSearch').fill('Pacific Ocean');
  await page.locator('#diveSearchResults [data-area-key]').first().click();
  if (await page.locator('#diveSearchToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#diveSearchToggle').click();
  await page.locator('#diveSearchInput').fill('Bali');
  await page.locator('#diveSearchInput').press('ArrowDown');
  await expect(page.locator('#diveSearchResults [data-site-index]').first()).toBeVisible({timeout:15000});
  await page.locator('#diveSearchInput').press('ArrowDown');
  await page.locator('#diveSearchInput').press('Enter');
  await expect(page.locator('.leaflet-popup').first()).toBeVisible({timeout:15000});
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.map.getMinZoom())).toBe(2);
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.map.getZoom())).toBeGreaterThanOrEqual(12);
});

test('welcome keeps destination and month frames equal and reuses the layer month wheel', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.goto('/');
  const frame = page.locator('#mapWelcome');
  const destination = await frame.boundingBox();
  await frame.locator('[data-action="next"]').click();
  const month = await frame.boundingBox();
  for (const dimension of ['x','y','width','height']) expect(month[dimension]).toBeCloseTo(destination[dimension],0);
  const select = page.locator('#mapWelcomeMonth');
  await select.click();
  const wheel = page.locator('.temperature-scroll-wheel[aria-labelledby="mapWelcomeMonth-wheel-heading"]');
  await expect(wheel).toBeVisible();
  await wheel.getByRole('option',{name:'April',exact:true}).click();
  await expect(select).toHaveValue('4');
  await expect(wheel).toBeHidden();
  await select.press('ArrowDown');
  await expect(wheel).toBeVisible();
  await expect(select).toHaveValue('5');
  await page.locator('#mapWelcomeMonth-wheel-list').press('Escape');
  await expect(wheel).toBeHidden();
  await expect(frame).toBeVisible();
  await select.click();
  // The native wheel overlaps the footer; dismiss from the exposed step bar.
  await frame.locator('[data-action="month"]').click();
  await expect(wheel).toBeHidden();
  await frame.locator('[data-action="guide"]').click();
  await expect(wheel).toBeHidden();
  await page.locator('#tutorialClose').click();
  await expect(select).toHaveValue('5');
  await expect(frame).toHaveCSS('width',`${destination.width}px`);
});

test('welcome shares the saved month with Layers and keeps it through language changes', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('global-coral-map-tutorial-suppressed-v1');
    localStorage.setItem('global-coral-map-dive-experience-month-v1','9');
  });
  await page.goto('/?__diveatlas_test=1');
  await page.evaluate(() => window.__DIVEATLAS_TEST__.selectEnvironmentalView('dive-experience-outlook'));
  const month = page.locator('#mapWelcomeMonth');
  await expect(month).toHaveValue('9');
  await page.locator('#mapWelcome [data-action="next"]').click();
  await month.selectOption('4');
  await expect(page.locator('#diveExperienceMonth')).toHaveValue('4');
  await expect(page.locator('#bioLegendCollapsedSummary')).toContainText('Apr');
  await expect(page.locator('#diveExperienceLegendMonth')).toHaveText('April');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('global-coral-map-dive-experience-month-v1'))).toBe('4');
  await page.locator('#diveExperienceMonth').selectOption('7',{force:true});
  await expect(month).toHaveValue('7');
  await expect(page.locator('#bioLegendCollapsedSummary')).toContainText('Jul');
  await page.locator('#mapWelcome [data-action="next"]').click();
  const language = page.locator('#mapWelcome [data-action="language"]');
  await language.click();
  await expect(language).toHaveAttribute('aria-expanded','true');
  await page.locator('#languageDropdown [data-language="fr"]').click();
  await expect(language).toHaveAttribute('aria-expanded','false');
  await expect(language).toBeFocused();
  await expect(month).toHaveValue('7');
  await expect(page.locator('#mapWelcomeMonthValue')).toHaveText('juillet');
  await expect(page.locator('#mapWelcomeReviewPanel .map-welcome-destination-value')).toContainText(/\d,\d{2}°/);
});

test('welcome controls and the shared month wheel follow the map theme without moving the frame', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.goto('/');
  const frame = page.locator('#mapWelcome');
  await frame.locator('[data-action="next"]').click();
  const before = await frame.boundingBox();
  await page.locator('#mapWelcomeMonth').click();
  const wheel = page.locator('.temperature-scroll-wheel:not([hidden])');
  const light = await wheel.evaluate(element => getComputedStyle(element).backgroundColor);
  await page.locator('#themeBtn').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.locator('#mapWelcomeMonth').click();
  await expect.poll(() => wheel.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(light);
  for (const dimension of ['x','y','width','height']) expect((await frame.boundingBox())[dimension]).toBeCloseTo(before[dimension],0);
  await page.locator('#mapWelcomeMonth-wheel-list').press('Escape');
  await expect(frame).toBeVisible();
  await expect(page.locator('#mapWelcomeMonth')).toBeFocused();
});

test('welcome immediately saves suppression and follows changes from another tab', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.goto('/');
  await page.locator('#mapWelcomeSuppress').check();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('global-coral-map-tutorial-suppressed-v1'))).toBe('1');
  const other = await page.context().newPage();
  await other.goto('/plain-page-fixture.html');
  await other.evaluate(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await expect(page.locator('#mapWelcomeSuppress')).not.toBeChecked();
  await other.close();
});

test('header destination selection keeps native site details separate from guide area search', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.goto('/');
  if (await page.locator('#diveSearchToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#diveSearchToggle').click();
  const header = page.locator('#diveSearchInput');
  await header.fill('Bali');
  await page.locator('#diveSearchResults [role="option"]').first().click();
  await expect(page.locator('#mapWelcomeSearch')).toHaveValue('');
  await expect(page.locator('.leaflet-popup').first()).toBeVisible({timeout:15000});
  await expect(header).toBeFocused();
  await expect(page.locator('#mapWelcome')).toBeVisible();
});

for (const viewport of [{width:1280,height:900},{width:900,height:700},{width:681,height:866},{width:390,height:844}]) {
test(`search mode bar stays above results and filters at ${viewport.width}x${viewport.height}`, async ({ page }) => {
  await page.setViewportSize(viewport);
  await page.goto('/');
  if (await page.locator('#diveSearchToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#diveSearchToggle').click();
  await page.locator('#diveSearchInput').fill('raja');
  await expect(page.locator('#diveSearchResults [data-site-index]').first()).toBeVisible({timeout:15000});
  await page.locator('#diveSearchFilterToggle').click();
  const panel = page.locator('#diveSearchResults');
  await expect(page.locator('#diveSearchFilterControls')).toBeVisible();
  const bar = await panel.locator('.dive-search-modes').boundingBox();
  const results = await page.locator('#diveSearchResultsScroll').boundingBox();
  const filters = await page.locator('#diveSearchFilterControls').boundingBox();
  const shell = await panel.boundingBox();
  // Visibility alone misses grid items overflowing a collapsed first row.
  expect(results.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
  expect(filters.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
  for (const box of [bar,results,filters]) {
    expect(box.x).toBeGreaterThanOrEqual(shell.x);
    expect(box.x + box.width).toBeLessThanOrEqual(shell.x + shell.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(shell.y + shell.height + 1);
  }
  const stacked = await panel.evaluate(element => element.classList.contains('is-stacked'));
  if (stacked) expect(filters.y).toBeGreaterThanOrEqual(results.y + results.height - 1);
  else expect(filters.x).toBeGreaterThanOrEqual(results.x + results.width - 1);
  await panel.locator('[data-search-mode="areas"]').click();
  await expect(page.locator('#diveSearchFilterControls')).toBeHidden();
  await expect(panel.locator('[data-area-key]').first()).toBeVisible();
  await panel.locator('[data-search-mode="sites"]').click();
  await expect(panel.locator('[data-site-index]').first()).toBeVisible();
});
}

test('header offers area search with pagination and keeps ordinary site search available', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.goto('/');
  if (await page.locator('#diveSearchToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#diveSearchToggle').click();
  const input = page.locator('#diveSearchInput');
  await input.fill('Indonesia');
  const options = page.locator('#diveSearchResults [role="option"]');
  await expect(options.first()).toHaveAttribute('data-site-index',/\d+/,{timeout:15000});
  await page.locator('#diveSearchResults [data-search-mode="areas"]').click();
  await expect(options.first()).toHaveAttribute('data-area-key',/^country:/);
  await expect(page.locator('#diveSearchSuggestButton')).toBeHidden();
  const count = await options.count();
  const more = page.locator('#diveSearchResults [data-search-load-more]');
  if (await more.isVisible()) await more.click();
  else for (let index=0;index<=count;index++) await input.press('ArrowDown');
  await expect.poll(() => options.count()).toBeGreaterThan(count);
  await options.first().click();
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  await expect(page.locator('#mapWelcome')).toBeVisible();
  await input.fill('Bali');
  await expect(options.first()).toHaveAttribute('data-area-key',/.+/,{timeout:15000});
  await page.locator('#diveSearchResults [data-search-mode="sites"]').click();
  await expect(options.first()).toHaveAttribute('data-site-index',/\d+/,{timeout:15000});
});

test('welcome and header hand the same results menu between their inputs', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.goto('/');
  const guideInput = page.locator('#mapWelcomeSearch');
  const first = page.locator('#diveSearchResults [role="option"]').first();
  await guideInput.fill('Raja Ampat');
  await expect(first).toHaveAttribute('data-search-query','Raja Ampat',{timeout:15000});
  await expect(page.locator('#mapWelcomeSearchPanel')).toHaveCount(0);
  if (await page.locator('#diveSearchToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#diveSearchToggle').click();
  await page.locator('#diveSearchInput').fill('Bali');
  await expect(first).toHaveAttribute('data-search-query','Bali',{timeout:15000});
  await expect(guideInput).toHaveAttribute('aria-expanded','false');
  // On phones the header menu can cover the guide input below it.
  await page.locator('#diveSearchInput').press('Escape');
  await guideInput.click();
  await expect(first).toHaveAttribute('data-search-query','Raja Ampat',{timeout:15000});
  await expect(page.locator('#diveSearchInput')).toHaveAttribute('aria-expanded','false');
  await expect(guideInput).toBeFocused();
  await expect(page.locator('#diveSearchResults')).toHaveCount(1);
});

test('welcome inline search handles empty and cleared queries locally', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.goto('/');
  const input = page.locator('#mapWelcomeSearch');
  await input.fill('zzzxqvnomatch987654321');
  await expect(page.locator('#diveSearchResultsScroll .dive-search-empty')).toHaveText('No matching areas',{timeout:15000});
  await input.fill('');
  await expect(page.locator('#diveSearchResults')).toBeHidden();
  await expect(input).toBeFocused();
  await expect(page.locator('#diveSearchInput')).toHaveValue('');
});

test('welcome inline search reports unavailable data without moving focus', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.route('**/*dive-site-search-locations*.json.gz*', route => route.fulfill({status:503,body:'Unavailable'}));
  await page.goto('/');
  await page.locator('#mapWelcomeSearch').fill('Raja Ampat');
  await expect(page.locator('#diveSearchResultsScroll .dive-search-empty')).toHaveText('Dive-site data unavailable',{timeout:15000});
  await expect(page.locator('#mapWelcomeSearch')).toBeFocused();
  await expect(page.locator('#diveSearchResultsScroll [role="option"]')).toHaveCount(0);
});

test('welcome clearing an in-flight search discards its late results', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  let release, requested;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { requested = resolve; });
  await page.route('**/*dive-site-search-locations*.json.gz*', async route => { requested();await held;await route.continue(); });
  await page.goto('/');
  await page.locator('#mapWelcomeSearch').fill('Raja Ampat');
  await started;
  await expect(page.locator('#diveSearchResults')).toHaveAttribute('aria-busy','true');
  await page.locator('#mapWelcomeSearch').fill('');
  release();
  // The real header query proves the shared index finished loading. The old
  // welcome query must remain closed even after that same pending work resolves.
  if (await page.locator('#diveSearchToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#diveSearchToggle').click();
  await page.locator('#diveSearchInput').fill('Bali');
  await expect(page.locator('#diveSearchResults [role="option"]').first()).toBeVisible({timeout:15000});
  await expect(page.locator('#mapWelcomeSearch')).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('#mapWelcomeSearch')).toHaveValue('');
  await expect(page.locator('#diveSearchResults [role="option"]').first()).toHaveAttribute('data-search-query','Bali');
});

for (const viewport of [{width:844,height:390}, {width:568,height:320}]) {
test(`welcome search menu fits the viewport and dismisses outside in landscape ${viewport.width}x${viewport.height}`, async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.setViewportSize(viewport);
  await page.goto('/');
  const guide = await page.locator('#mapWelcome').boundingBox();
  await page.locator('#mapWelcomeSearch').fill('Raja Ampat');
  await expect(page.locator('#diveSearchResultsScroll [role="option"]').first()).toBeVisible({timeout:15000});
  const menu = await page.locator('#diveSearchResults').boundingBox();
  expect(menu.y).toBeGreaterThanOrEqual(0);
  expect(menu.y + menu.height).toBeLessThanOrEqual(viewport.height);
  expect((await page.locator('#mapWelcome').boundingBox()).height).toBeCloseTo(guide.height,0);
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await expect(page.locator('#diveSearchResults')).toBeHidden();
  await expect(page.locator('#mapWelcome')).toBeVisible();
});
test(`welcome keeps month and footer controls clickable in landscape ${viewport.width}x${viewport.height}`, async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.setViewportSize(viewport);
  await page.goto('/');
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await page.locator('#mapWelcome [data-action="next"]').click();
  // A real pointer click detects clipping that selectOption() alone misses.
  await page.locator('#mapWelcomeMonth').click();
  await page.locator('#mapWelcomeMonth-wheel-option-3').click();
  await expect(page.locator('#mapWelcomeMonth-wheel-list')).toBeHidden();
  await page.locator('#mapWelcome [data-action="guide"]').click();
  await expect(page.locator('#tutorialBackdrop')).toBeVisible();
  await page.locator('#tutorialClose').click();
  await expect(page.locator('#mapWelcomeMonth')).toHaveValue('4');
  await page.locator('#mapWelcomeSuppress').check();
  await page.locator('#mapWelcomeSuppress').uncheck();
  await page.locator('#mapWelcome [data-action="browse"]').click();
  await expect(page.locator('#mapWelcome')).toBeHidden();
});
}

test('welcome synchronizes suppression through the guide and honors unchecking', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.goto('/');
  const welcome = page.locator('#mapWelcome');
  await page.locator('#mapWelcomeSuppress').check();
  await welcome.locator('[data-action="guide"]').click();
  await expect(page.locator('#tutorialSuppressInput')).toBeChecked();
  await page.locator('#tutorialSuppressInput').uncheck();
  await page.locator('#tutorialClose').click();
  await expect(welcome).toBeVisible();
  await expect(page.locator('#mapWelcomeSuppress')).not.toBeChecked();
  await welcome.locator('[data-action="guide"]').click();
  await page.locator('#tutorialSuppressInput').check();
  await page.locator('#tutorialClose').click();
  await expect(welcome).toBeVisible();
  await expect(page.locator('#mapWelcomeSuppress')).toBeChecked();
  await page.locator('#mapWelcomeSuppress').uncheck();
  await welcome.locator('[data-action="browse"]').click();
  expect(await page.evaluate(() => localStorage.getItem('global-coral-map-tutorial-suppressed-v1'))).toBeNull();
});

test('welcome leaves real map zoom reachable on a short phone', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.setViewportSize({width:320,height:568});
  await page.goto('/');
  await expect(page.locator('#mapWelcomeDestinationPanel')).toBeVisible();
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await expect(page.locator('#mapWelcome [data-action="next"]')).toBeVisible();
});

test('welcome keeps the selected area live when the map moves during later steps', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.goto('/?__diveatlas_test=1');
  await page.locator('#mapWelcome [data-action="next"]').click();
  await page.evaluate(() => window.__DIVEATLAS_TEST__.map.setView([10,120],6,{animate:false}));
  await expect(page.locator('#mapWelcomeMonthPanel .map-welcome-destination-value')).toContainText('10.00');
  await expect(page.locator('#mapWelcomeMonthPanel .map-welcome-destination-value')).toContainText('120.00');
  await page.locator('#mapWelcome [data-action="next"]').click();
  await expect(page.locator('#mapWelcomeReviewPanel')).toContainText('120.00');
});

test('welcome preserves suppression and the on-demand layer guide', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.goto('/');
  const welcome = page.locator('#mapWelcome');
  await expect(welcome).toBeVisible();
  await page.locator('#mapWelcomeSuppress').check();
  await welcome.locator('[data-action="browse"]').click();
  await expect(welcome).toBeHidden();
  await expect(page.locator('#bioLegendTitle')).toBeFocused();
  // Init-script order deliberately resets storage on reload, so remove that
  // fixture by checking the stored preference here, then use the suppressed
  // default fixture in the existing guide test below for the returning visit.
  expect(await page.evaluate(() => localStorage.getItem('global-coral-map-tutorial-suppressed-v1'))).toBe('1');
  await page.locator('#bioLegendTitle').click();
  await page.locator('#bioLegendOverflow > summary').click();
  await page.locator('#bioLegendGuide').click();
  await expect(page.locator('#tutorialBackdrop')).toBeVisible();
  await page.locator('#tutorialClose').click();
  await expect(page.locator('#tutorialBackdrop')).toBeHidden();
});

test('welcome opens the full layer guide only on request', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.goto('/');
  await page.locator('#mapWelcome [data-action="guide"]').click();
  await expect(page.locator('#mapWelcome')).toBeHidden();
  await expect(page.locator('#tutorialBackdrop')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tutorialBackdrop')).toBeHidden();
  await expect(page.locator('#mapWelcome')).toBeVisible();
});

test('welcome can skip directly to the real map and shared links bypass it', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('global-coral-map-tutorial-suppressed-v1'));
  await page.goto('/');
  await page.locator('#mapWelcome [data-action="browse"]').click();
  await expect(page.locator('#mapWelcome')).toBeHidden();
  expect(new URL(page.url()).pathname).toBe('/');
  await page.goto('/?lat=-0.5&lng=130&z=7');
  await expect(page.locator('#mapWelcome')).toBeHidden();
  await expect(page.locator('#tutorialBackdrop')).toBeHidden();
});

test('tutorial language and photo policy popovers escape nested glass and dismiss cleanly', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.shared-site-header')).toBeVisible();
  await expect(page.locator('#mapWelcome')).toBeHidden();
  await page.locator('#bioLegendGuide').evaluate(el => el.click());
  await expect(page.locator('#tutorialDialog')).toBeVisible();
  await page.locator('#tutorialLanguageMenuButton').click();
  const language = page.locator('#tutorialLanguageDropdown');
  await expect.poll(() => language.evaluate(el => el.matches(':popover-open'))).toBe(true);
  await expect(language).toHaveCSS('backdrop-filter', 'blur(8px) saturate(1.45)');
  await page.keyboard.press('Escape');
  await expect(language).toBeHidden();
  await page.locator('#tutorialClose').click();
  await expect(page.locator('#tutorialDialog')).toBeHidden();
  // Open the production photo form shell without submitting or requiring an
  // account; its policy control still uses the real shared form controller.
  await page.locator('#sitePhotoUploadModal').evaluate(el => el.hidden = false);
  await page.locator('#sitePhotoUploadForm').evaluate(el => el.hidden = false);
  await page.locator('#sitePhotoUploadPolicyTrigger').click();
  const policy = page.locator('#sitePhotoUploadPolicyPopover');
  await expect.poll(() => policy.evaluate(el => el.matches(':popover-open'))).toBe(true);
  await expect(policy).toHaveCSS('backdrop-filter', 'blur(8px) saturate(1.45)');
  await page.keyboard.press('Escape');
  await expect(policy).toBeHidden();
  await expect(page.locator('#sitePhotoUploadPolicyTrigger')).toBeFocused();
  await page.locator('#sitePhotoUploadCloseButton').click();
  await expect(page.locator('#sitePhotoUploadModal')).toBeHidden();
});

for (const path of ['/', '/dive-site.html', '/dive-sites/', '/regions/', '/destinations/', '/plain-page-fixture.html']) {
  test(`shared header layout and controls on ${path}`, async ({ page }) => {
    await page.goto(path);
    const header = page.locator('.shared-site-header');
    await expect(header).toHaveCount(1);
    await expect(header.locator('.dive-search-box')).toBeVisible();
    const bounds = await header.boundingBox();
    expect(bounds.height).toBe(42);
    await expect.poll(async () => (await header.boundingBox()).width).toBeLessThanOrEqual(page.viewportSize().width + 1);
    // Repeated mounts must retain existing nodes and their event handlers.
    const identity = await header.evaluate(el => {
      const input = el.querySelector('input');
      window.DiveAtlasHeader.mount();
      window.DiveAtlasHeader.mount();
      return input === el.querySelector('input');
    });
    expect(identity).toBe(true);
    const map = path === '/';
    if (!map) await expect(page.locator('#authMenuStatus')).toHaveText('Not signed in');
    await page.locator(map ? '#themeBtn' : '#seoThemeButton').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator(map ? '#languageMenuButton' : '#seoLanguageButton').click();
    await expect(page.locator(map ? '#languageDropdown' : '#seoLanguageDropdown')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator(map ? '#topMenuButton' : '#seoMenuButton').click();
    await expect(page.locator(map ? '#topMenuDropdown' : '#seoMenuDropdown')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.shared-site-header')).toHaveCount(1);
  });
}

test.describe('shared header native scrollbar edge', () => {
  for (const path of ['/', '/dive-site.html', '/dive-sites/', '/regions/', '/destinations/', '/plain-page-fixture.html']) {
    test(`header fills the scrollbar edge on ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('.shared-site-header')).toBeVisible();
      await page.addStyleTag({ content:'html { overflow-y:scroll !important; } * { transition:none !important; }' });
      for (const theme of ['light', 'dark']) {
        const geometry = await page.evaluate(theme => {
          document.documentElement.dataset.theme = theme;
          const root = document.documentElement;
          const header = document.querySelector('.shared-site-header').getBoundingClientRect();
          return {
            gutter:innerWidth - root.clientWidth,
            clientWidth:root.clientWidth,
            header:{ left:header.left, right:header.right, top:header.top, height:header.height },
            background:getComputedStyle(root, '::-webkit-scrollbar').backgroundImage,
            offset:getComputedStyle(root, '::-webkit-scrollbar-track').marginTop
          };
        }, theme);
        expect(geometry.header.left).toBe(0);
        expect(geometry.header.top).toBe(0);
        expect(geometry.header.right).toBeCloseTo(geometry.clientWidth, 0);
        expect(geometry.header.height).toBe(42);
        expect(geometry.background).toContain('linear-gradient');
        expect(geometry.background).toContain('42px');
        expect(geometry.offset).toBe('42px');
        if (geometry.gutter > 0) {
          // Verify where the native track/thumb actually paint, rather than
          // only checking their computed margin. The photo remains full bleed.
          const markerStyle = await page.addStyleTag({ content:`
            html:has(> body.has-shared-header)::-webkit-scrollbar-thumb {
              background:rgb(255 0 0) !important; border:0 !important; border-radius:0 !important;
            }
            html:has(> body.has-shared-header)::-webkit-scrollbar-track {
              background:rgb(0 0 255) !important;
            }` });
          const rail = await page.screenshot({ clip:{ x:geometry.clientWidth, y:0,
            width:geometry.gutter, height:page.viewportSize().height } });
          const firstPaintedRow = await page.evaluate(async base64 => {
            const image = new Image();
            image.src = `data:image/png;base64,${base64}`;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width; canvas.height = image.height;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, image.width, image.height).data;
            for (let y = 0; y < image.height; y += 1) {
              for (let x = 0; x < image.width; x += 1) {
                const offset = (y * image.width + x) * 4;
                if (pixels[offset + 1] < 10 &&
                    ((pixels[offset] > 245 && pixels[offset + 2] < 10) ||
                     (pixels[offset + 2] > 245 && pixels[offset] < 10))) return y;
              }
            }
            return -1;
          }, rail.toString('base64'));
          expect(firstPaintedRow, 'native scrolling controls begin below the fixed bar').toBeGreaterThanOrEqual(42);
          await markerStyle.evaluate(node => node.remove());
          const clip = { x:geometry.clientWidth, y:0, width:geometry.gutter, height:40 };
          const painted = await page.screenshot({ clip });
          const override = await page.addStyleTag({ content:'html:has(> body.has-shared-header)::-webkit-scrollbar { background:magenta !important; }' });
          expect(painted.equals(await page.screenshot({ clip })), 'native gutter paints the header material').toBe(false);
          await override.evaluate(el => el.remove());
        }
      }
    });
  }
});

for (const theme of ['light', 'dark']) {
  test(`overlay surface inventory has visible glass and contains map input in ${theme}`, async ({ page }) => {
    test.setTimeout(90_000);
    const { openMap, setMapView, mapState, waitForClickResolution } = require('./support');
    await openMap(page);
    await setMapView(page, -5.7, 131, 10);
    await page.evaluate(() => window.__DIVEATLAS_TEST__.setLegendCollapsed(true));
    await page.addStyleTag({ content: '* { animation:none !important; transition:none !important; }' });
    await page.evaluate(theme => {
      document.documentElement.dataset.theme = theme;
      const backing = document.createElement('div');
      backing.style.cssText = 'position:fixed;inset:0;z-index:4500;pointer-events:none;background:repeating-linear-gradient(90deg,#102030 0 2px,#fff 2px 4px)';
      document.getElementById('map').append(backing);
    }, theme);
    // This is the shell inventory, not a replacement for real open/close and
    // focus tests. Exercise each production adapter under the map event root.
    const surfaces = [
      'share-dialog', 'site-suggestion-dialog', 'contact-dialog', 'seo-dialog', 'tutorial-dialog',
      'tutorial-language-dropdown', 'temperature-scroll-wheel', 'dive-filter-options',
      'temperature-info-popover', 'dive-conditions-info-popover', 'dive-experience-info-popover',
      'site-photo-upload-policy-popover', 'dive-location-coordinate-tooltip',
      'dive-popup-sources__tooltip', 'dive-conditions-sources-tooltip',
      'top-menu-about-tooltip', 'bio-legend-overflow-menu', 'dive-layer-filter-menu',
      'dive-photo-preview', 'mobile-map-credits-panel'
    ];
    for (const className of surfaces) {
      await page.evaluate(className => {
        const surface = document.createElement('section');
        surface.id = 'overlay-audit-surface';
        surface.className = className;
        surface.style.cssText = 'position:fixed!important;inset:160px auto auto 20px!important;width:240px!important;height:180px!important;min-width:0!important;max-height:none!important;display:block!important;visibility:visible!important;opacity:1!important;z-index:5000!important;transform:none!important;margin:0!important';
        surface.innerHTML = '<button type="button">Overlay control</button>';
        surface.querySelector('button').onclick = event => event.target.dataset.clicked = 'true';
        document.getElementById('map').append(surface);
        const api = window.__DIVEATLAS_TEST__;
        const bounds = surface.getBoundingClientRect();
        const mapBounds = document.getElementById('map').getBoundingClientRect();
        const point = api.latLngAt(bounds.x + 120 - mapBounds.x, bounds.y + 90 - mapBounds.y);
        api.addCoralGrid(point.lat, point.lng, 'under-overlay-inventory');
        api.clearActionCount();
      }, className);
      const panel = page.locator('#overlay-audit-surface');
      await expect(panel, className).toHaveCSS('backdrop-filter', 'blur(8px) saturate(1.45)');
      const blurred = await panel.screenshot();
      await panel.evaluate(el => el.style.setProperty('backdrop-filter', 'none', 'important'));
      expect(blurred.equals(await panel.screenshot()), `${className} visibly blurs`).toBe(false);
      const before = await mapState(page);
      await panel.hover({ position:{ x:120, y:90 } });
      await expect(page.locator('.leaflet-tooltip:visible'), className).toHaveCount(0);
      await panel.locator('button').click();
      await expect(panel.locator('button'), className).toHaveAttribute('data-clicked', 'true');
      await panel.locator('button').press('ArrowDown');
      await page.mouse.wheel(0, 100);
      await waitForClickResolution(page);
      const after = await mapState(page);
      expect(after.center, className).toEqual(before.center);
      expect(after.zoom, className).toBe(before.zoom);
      expect(after.actionCount, className).toBe(0);
      await panel.evaluate(el => el.remove());
    }
  });

  test(`nested source popovers visibly blur in ${theme} theme`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.shared-site-header')).toBeVisible();
    await page.addStyleTag({ content: '* { transition:none !important; animation:none !important; }' });
    await page.evaluate(theme => {
      document.documentElement.dataset.theme = theme;
      const sheet = document.createElement('section');
      sheet.id = 'source-glass-fixture';
      // Exercise the production delegated handler inside a clipped backdrop
      // root, with a sharp pattern that makes actual blur measurable.
      sheet.style.cssText = 'position:fixed;z-index:5000;top:100px;left:20px;width:280px;height:300px;overflow:hidden;backdrop-filter:blur(8px);background:repeating-linear-gradient(90deg,#102030 0 2px,#fff 2px 4px)';
      sheet.innerHTML = '<details class="dive-popup-sources" style="position:absolute;bottom:10px;right:10px"><summary>Source</summary><div class="dive-popup-sources__tooltip"><a href="#source-test">Source evidence link</a><p>Dataset and provenance details</p></div></details>';
      document.body.append(sheet);
    }, theme);
    const details = page.locator('#source-glass-fixture details');
    const tooltip = details.locator('.dive-popup-sources__tooltip');
    await details.locator('summary').click();
    await expect.poll(() => tooltip.evaluate(el => el.matches(':popover-open'))).toBe(true);
    await expect(tooltip.locator('a')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const blurred = await tooltip.screenshot();
    await tooltip.evaluate(el => el.style.setProperty('backdrop-filter', 'none', 'important'));
    expect(blurred.equals(await tooltip.screenshot())).toBe(false);
    const bounds = await tooltip.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(12);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width - 12);
    await page.keyboard.press('Escape');
    await expect(details).not.toHaveAttribute('open');
    await expect(tooltip).toBeHidden();
    await details.locator('summary').click();
    await expect(tooltip).toBeVisible();
    await page.mouse.click(5, 500);
    await expect(tooltip).toBeHidden();
  });

  test(`map navigation visibly blurs the backdrop in ${theme} theme`, async ({ page, isMobile }) => {
    await page.goto('/');
    await expect(page.locator('.shared-site-header')).toBeVisible();
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // A deterministic pattern catches backdrop-root failures that computed CSS
    // cannot detect. Keep it below the real header and its native menus.
    await page.addStyleTag({ content: `*, *::before, *::after { transition:none !important; animation:none !important; } body::after { content:''; position:fixed; inset:0; z-index:1299; pointer-events:none; background:repeating-linear-gradient(90deg,#102030 0 2px,#fff 2px 4px); }` });
    await page.evaluate(() => document.fonts.ready);
    const checkBlur = async (selector, disable) => {
      const panel = page.locator(selector);
      await expect(panel).toBeVisible();
      const blurred = await panel.screenshot({ animations: 'disabled' });
      const override = await page.addStyleTag({ content: disable });
      const sharp = await panel.screenshot({ animations: 'disabled' });
      expect(blurred.equals(sharp)).toBe(false);
      expect(sharp.equals(await panel.screenshot({ animations: 'disabled' }))).toBe(true);
      await override.evaluate(el => el.remove());
      expect(blurred.equals(await panel.screenshot({ animations: 'disabled' }))).toBe(true);
    };
    await page.locator('#languageMenuButton').click();
    await checkBlur('#languageDropdown', '#languageDropdown { backdrop-filter:none !important; -webkit-backdrop-filter:none !important; }');
    await page.keyboard.press('Escape');
    await page.locator('#topMenuButton').click();
    await checkBlur('#topMenuDropdown', '#topMenuDropdown, #topMenuDropdown::before { backdrop-filter:none !important; -webkit-backdrop-filter:none !important; }');
    await page.locator('#aboutMenuItem').click();
    if (isMobile) {
      await checkBlur('#aboutInfoDialog', '#aboutInfoDialog { backdrop-filter:none !important; -webkit-backdrop-filter:none !important; }');
    } else {
      await checkBlur('#topMenuAboutTooltip', '#topMenuAboutTooltip { backdrop-filter:none !important; -webkit-backdrop-filter:none !important; }');
    }
  });
}
