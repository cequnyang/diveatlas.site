const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const { addFixture, clickFixture, closeTopMenu, openMap, openMobileSettings, openTopMenu, readTestDataAsset, setMapView } = require('./support');

const temperatureMetadata = path.resolve(__dirname, '../../data/temperature/metadata.json');
const metadataFixture = {
  purpose: 'development-validation',
  native_resolution: 1,
  asset_base: 'data/temperature/development-1deg',
  tile_template: 'woa23/monthly/{month}/{depth}/{z}/{x}/{y}.png',
  max_native_zoom: 2,
  min_native_zoom: 2,
  supported_months: [9, 10, 11],
  supported_depths_m: [20, 30, 40],
  available_slices: [[9, 20], [9, 30], [10, 30], [11, 40]],
  temperature_scale: {
    min_c: -2, max_c: 32,
    color_stops: [{ value_c: -2, color: '#1c4b8f' }, { value_c: 32, color: '#ce675e' }]
  }
};

async function installMetadataFixture(page) {
  await page.route('**/data/temperature/metadata.json', route => route.fulfill({ json: metadataFixture }));
}

async function activateTemperatureView(page) {
  await page.locator('.environment-segment').filter({
    has: page.locator('input[name="environmentView"][value="temperature"]')
  }).click();
}

test('production temperature metadata stays on Pages and supplies the supported depth choices', async ({ page }) => {
  await openMap(page);
  await setMapView(page, -5.7, 131, 4);
  const temperatureTileResponses = [];
  page.on('response', response => {
    if (response.url().includes('/woa23/monthly/') && new URL(response.url()).pathname.endsWith('.png')) {
      temperatureTileResponses.push({ url: response.url(), status: response.status() });
    }
  });
  await activateTemperatureView(page);
  await expect(page.locator('#temperatureDepth option')).toHaveCount(11);
  await page.locator('#temperatureDepth').selectOption('20');
  await expect.poll(() => temperatureTileResponses.some(({ status }) => status === 200), { timeout: 20_000 })
    .toBe(true);

  const metadataUrl = await page.evaluate(() => performance.getEntriesByType('resource')
    .map(entry => entry.name)
    .find(url => new URL(url).pathname.endsWith('/data/temperature/metadata.json')));
  expect(metadataUrl, 'the temperature metadata request should complete').toBeTruthy();
  expect(new URL(metadataUrl).origin, 'small temperature metadata stays on the Pages origin')
    .toBe(new URL(page.url()).origin);
});

test('saved month preferences keep each month selector and legend in sync on startup', async ({ page }) => {
  await openMap(page, {
    localStorage: {
      'global-coral-map-environment-month-v1': '10',
      'global-coral-map-dive-experience-month-v1': '6'
    }
  });

  for (const selector of ['#temperatureMonth', '#waterClarityMonth', '#currentsMonth', '#wavesMonth']) {
    await expect(page.locator(selector)).toHaveValue('10');
  }
  await expect(page.locator('#temperatureLegendSelection')).toContainText('Oct');
  await expect(page.locator('#temperatureLegendSlice')).toContainText('October');
  await expect(page.locator('#waterClarityLegendSelection')).toHaveText('Oct');
  await expect(page.locator('#currentsLegendSelection')).toContainText('Oct');
  await expect(page.locator('#wavesLegendSelection')).toHaveText('October');

  await expect(page.locator('#diveExperienceMonth')).toHaveValue('6');
  await expect(page.locator('#diveExperienceLegendMonth')).toHaveText('June');
});

test('temperature has zero startup requests and loads only after activation', async ({ page }) => {
  const temperatureRequests = [];
  page.on('request', request => {
    if (request.url().includes('temperature-view.js') || request.url().includes('/data/temperature/')) {
      temperatureRequests.push(request.url());
    }
  });
  await installMetadataFixture(page);
  await openMap(page);
  if (await page.locator('#bioLegend').evaluate(node => node.classList.contains('is-collapsed'))) {
    await page.locator('#bioLegendTitle').click();
  }
  expect(temperatureRequests).toEqual([]);
  await expect(page.locator('#environmentViewSelect')).toHaveValue('default');
  await expect(page.locator('input[name="environmentView"][value="dive-conditions"]')).toHaveCount(0);
  await expect(page.locator('#temperatureControls')).toBeHidden();

  await page.locator('#environmentViewSelect').selectOption('temperature');
  await expect(page.locator('#temperatureControls')).toBeVisible();
  await expect.poll(() => temperatureRequests.some(url => url.includes('/data/temperature/'))).toBe(true);
  expect(temperatureRequests.filter(url => url.includes('/data/temperature/query/'))).toEqual([]);
  expect(temperatureRequests.filter(url => url.includes('temperature-view.js'))).toHaveLength(1);
  await expect(page.locator('#environmentViewSelect')).toHaveValue('temperature');

  await page.locator('#environmentViewSelect').selectOption('default');
  await expect(page.locator('#temperatureControls')).toBeHidden();
  await expect.poll(() => page.locator('.temperature-tiles').count()).toBe(0);
  await page.locator('#environmentViewSelect').selectOption('default');
  await expect(page.locator('#environmentViewSelect')).toHaveValue('default');
});

test('Waves loads its selected month on demand and defers point climatology until requested', async ({ page }) => {
  const requests = [];
  page.on('request', request => {
    if (request.url().includes('/data/waves/')) requests.push(request.url());
  });
  await openMap(page);
  expect(requests).toEqual([]);
  await expect(page.locator('#wavesControls')).toBeHidden();

  await page.locator('#environmentViewSelect').selectOption('waves');
  await expect(page.locator('#wavesControls')).toBeVisible();
  await expect(page.locator('#wavesStatus')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('.waves-tiles')).toHaveCount(1);
  await expect.poll(() => requests.some(url => url.endsWith('/data/waves/metadata.json'))).toBe(true);
  expect(requests.filter(url => url.includes('/data/waves/query/'))).toEqual([]);

  await page.locator('#wavesMonth').selectOption('10');
  await expect(page.locator('#temperatureMonth')).toHaveValue('10');
  await clickMapCoordinate(page, -5.7, 131);
  await expect(page.locator('.waves-detail')).toBeVisible();
  await expect.poll(() => requests.some(url => url.includes('/data/waves/query/'))).toBe(true);
  await expect(page.locator('.waves-detail')).toContainText('1993–2020');
  await page.locator('#measurementUnitSwitch [data-length-unit="ft"]').click();
  await expect(page.locator('#wavesInfoResolution')).toContainText('mi');
  await expect(page.locator('#wavesMetaResolutionValue')).toContainText('mi');
  await expect(page.locator('.temperature-detail-resolution')).toContainText('mi');
  await expect(page.locator('.waves-primary-metrics')).toContainText('ft');

  await page.locator('.waves-seasonal-button').click();
  await expect(page.locator('.waves-seasonal-chart')).toBeVisible();
  expect(requests.filter(url => url.includes('/data/waves/query/')).length).toBeGreaterThan(1);

  await page.locator('#environmentViewSelect').selectOption('default');
  await expect(page.locator('#wavesControls')).toBeHidden();
  await expect(page.locator('.waves-tiles')).toHaveCount(0);
  await expect(page.locator('.waves-detail')).toHaveCount(0);
});

test('Water Clarity loads on demand, synchronizes month selection, and reports missing assets', async ({ page }) => {
  const clarityRequests = [];
  page.on('request', request => {
    if (request.url().includes('water-clarity-view.js') || request.url().includes('/data/water_clarity/')) {
      clarityRequests.push(request.url());
    }
  });
  await page.route('**/data/water_clarity/metadata.json', route => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'development fixture: production data not generated' })
  }));

  await openMap(page);
  expect(clarityRequests).toEqual([]);
  await expect(page.locator('#waterClarityControls')).toBeHidden();

  const before = await page.evaluate(() => {
    const center = window.__DIVEATLAS_TEST__.map.getCenter();
    return { lat: center.lat, lng: center.lng, zoom: window.__DIVEATLAS_TEST__.map.getZoom() };
  });
  await page.locator('#environmentViewSelect').selectOption('water-clarity');
  await expect(page.locator('#waterClarityControls')).toBeVisible();
  await expect(page.locator('#waterClarityStatus')).toHaveAttribute('data-state', 'unavailable');
  expect(clarityRequests.filter(url => url.includes('water-clarity-view.js'))).toHaveLength(1);
  expect(clarityRequests.filter(url => url.includes('/data/water_clarity/metadata.json'))).toHaveLength(1);

  await page.locator('#waterClarityMonth').selectOption('10');
  await expect(page.locator('#temperatureMonth')).toHaveValue('10');
  const after = await page.evaluate(() => {
    const center = window.__DIVEATLAS_TEST__.map.getCenter();
    return { lat: center.lat, lng: center.lng, zoom: window.__DIVEATLAS_TEST__.map.getZoom() };
  });
  expect(after).toEqual(before);

  await page.locator('#environmentViewSelect').selectOption('default');
  await expect(page.locator('#waterClarityControls')).toBeHidden();
  await expect(page.locator('.water-clarity-tiles')).toHaveCount(0);
});

test('Water Clarity click popup renders a local numeric chunk with the current labels', async ({ page }) => {
  const values = Buffer.alloc(12, 255);
  values[8] = 30;
  const metadata = {
    format: 'diveatlas-water-clarity', format_version: 1, designation: 'development-validation',
    generated_at_utc: 'fixture', climatology_period: '2016-2025', source_resolution_km: 4,
    available_months: Array.from({ length: 12 }, (_, index) => index + 1),
    grid: { latitude_count: 1, longitude_count: 1, latitude_first_center: 0.5,
      longitude_first_center: 0.5, latitude_step_degrees: 1, longitude_step_degrees: 1 },
    value_encoding: { scale_m: 0.5, missing_sentinel: 255 },
    query: { chunk_degrees: 10, chunks: [{ row: 0, column: 0, file: 'r00_c00.u8.gz',
      row_start: 0, column_start: 0, rows: 1, columns: 1 }] },
    rendering: { tile_template: 'tiles/{month}/{z}/{x}/{y}.png', min_native_zoom: 5,
      max_native_zoom: 5, opacity: 0.58 }
  };
  // This test uses synthetic water-clarity data; its tile bytes must not depend
  // on a large terrain tile that is intentionally absent from Git.
  const tile = fs.readFileSync(path.resolve(__dirname, '../../assets/favicon-light.png'));
  await page.route('**/data/water_clarity/metadata.json', route => route.fulfill({ json: metadata }));
  await page.route('**/data/water_clarity/query/chunks/r00_c00.u8.gz**', route => route.fulfill({
    status: 200, contentType: 'application/gzip', body: gzipSync(values)
  }));
  await page.route('**/data/water_clarity/tiles/**', route => route.fulfill({
    status: 200, contentType: 'image/png', body: tile
  }));

  await openMap(page);
  await page.evaluate(() => window.__DIVEATLAS_TEST__.setView(0.5, 0.5, 5));
  await page.locator('#environmentViewSelect').selectOption('water-clarity');
  await expect(page.locator('#waterClarityStatus')).toBeHidden();
  await page.locator('#waterClarityMonth').selectOption('9');
  await clickMapCoordinate(page, 0.5, 0.5);
  const popup = page.locator('.water-clarity-popup');
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('Water Clarity');
  await expect(popup).toContainText('15 m');
  await expect(popup).toContainText('Clarity Level');
  await expect(popup).toContainText('Moderate');
  await expect(popup).toContainText('Copernicus Marine');
  await page.locator('#measurementUnitSwitch [data-length-unit="ft"]').click();
  await expect(page.locator('#waterClarityLowThreshold')).toHaveText('<16 ft');
  await expect(page.locator('#waterClarityResolutionValue')).toHaveText('~2.5 mi');
  await expect(page.locator('#waterClarityInfoResolutionValue')).toHaveText('~2.5 mi');
  await expect(popup).toContainText('49 ft');
  await expect(popup).toContainText('2.5 mi');
});

test('Layers palette follows the active site theme without changing its layout', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMap(page);
  await page.evaluate(() => {
    const controls = document.querySelector('#temperatureControls');
    controls.hidden = false;
    controls.inert = false;
    controls.setAttribute('aria-hidden', 'false');
    controls.classList.add('is-open');
  });
  await page.locator('#temperatureInfoAbout').click();
  const popover = page.locator('#temperatureInfoPopover');
  await expect(popover).toBeVisible();
  await expect(popover).toHaveAttribute('data-theme', 'light');
  await expect(popover).toHaveCSS('background-color', 'rgb(247, 249, 252)');

  const light = await page.evaluate(() => {
    const selectors = ['#bioLegend', '#bioLegendHeading', '.environment-segment-group', '#temperatureDepth', '.temperature-legend-card', '.bio-legend-row', '.layer-toggle-switch'];
    const geometry = selectors.map(selector => {
      const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { selector, x, y, width, height };
    });
    const panel = document.querySelector('#bioLegend');
    const style = getComputedStyle(panel);
    return { geometry, primary: style.getPropertyValue('--text-primary').trim(), scheme: style.colorScheme, surface: style.backgroundImage };
  });
  expect(light.primary).toBe('#202b3a');
  expect(light.scheme).toBe('light');

  await page.locator('#temperatureInfoAbout').click();
  // The map theme transition waits for basemap readiness; this test isolates the panel's existing root theme hook.
  await page.locator('html').evaluate(node => { node.dataset.theme = 'dark'; });
  await page.locator('#temperatureInfoAbout').click();
  await expect(popover).toHaveAttribute('data-theme', 'dark');
  await expect(popover).toHaveCSS('background-color', 'rgb(32, 33, 36)');
  const dark = await page.evaluate(() => {
    const selectors = ['#bioLegend', '#bioLegendHeading', '.environment-segment-group', '#temperatureDepth', '.temperature-legend-card', '.bio-legend-row', '.layer-toggle-switch'];
    const geometry = selectors.map(selector => {
      const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { selector, x, y, width, height };
    });
    const panel = document.querySelector('#bioLegend');
    const style = getComputedStyle(panel);
    return { geometry, primary: style.getPropertyValue('--text-primary').trim(), scheme: style.colorScheme, surface: style.backgroundImage };
  });
  expect(dark.primary).toBe('#f4f6fa');
  expect(dark.scheme).toBe('dark');
  expect(dark.geometry).toEqual(light.geometry);
  expect(dark.surface).not.toBe(light.surface);

  await page.locator('#temperatureInfoAbout').click();
  await page.locator('html').evaluate(node => { node.dataset.theme = 'light'; });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(260);
  if (await page.locator('#bioLegend').evaluate(node => node.classList.contains('is-collapsed'))) {
    await page.locator('#bioLegendTitle').click();
    await expect(page.locator('#bioLegend')).not.toHaveClass(/is-collapsed/);
  }
  const mobileLight = await page.locator('#bioLegend').evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height, primary: getComputedStyle(node).getPropertyValue('--text-primary').trim() };
  });
  await page.locator('html').evaluate(node => { node.dataset.theme = 'dark'; });
  const mobileDark = await page.locator('#bioLegend').evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height, primary: getComputedStyle(node).getPropertyValue('--text-primary').trim() };
  });
  expect(mobileLight.width).toBeLessThanOrEqual(366);
  expect(mobileLight.primary).toBe('#202b3a');
  expect(mobileDark.width).toBe(mobileLight.width);
  expect(mobileDark.primary).toBe('#f4f6fa');
});

test('Coral, Fish, and Dive legend swatches keep their colors below and at Z3', async ({ page }) => {
  await openMap(page);

  const readSwatchStyles = () => page.evaluate(() => {
    const symbols = {
      coral: '#speciesLegendSymbol',
      fish: '#fishLegendSymbol',
      dive: '#diveLegendSymbol'
    };
    return Object.fromEntries(Object.entries(symbols).map(([name, selector]) => {
      const style = getComputedStyle(document.querySelector(selector));
      return [name, {
        opacity: style.opacity,
        filter: style.filter,
        backgroundColor: style.backgroundColor,
        borderTopColor: style.borderTopColor
      }];
    }));
  });

  await page.evaluate(() => window.__DIVEATLAS_TEST__.setView(-5.7, 131, 2));
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.map.getZoom())).toBe(2);
  const belowZ3 = await readSwatchStyles();

  await page.evaluate(() => window.__DIVEATLAS_TEST__.setView(-5.7, 131, 3));
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.map.getZoom())).toBe(3);
  const atZ3 = await readSwatchStyles();

  for (const name of Object.keys(belowZ3)) {
    expect(belowZ3[name].opacity, `${name} opacity below Z3`).toBe('1');
    expect(belowZ3[name].filter, `${name} filter below Z3`).toBe('none');
    expect(atZ3[name].opacity, `${name} opacity at Z3`).toBe('1');
    expect(atZ3[name].filter, `${name} filter at Z3`).toBe('none');
    expect(atZ3[name].backgroundColor, `${name} fill should not change at Z3`).toBe(belowZ3[name].backgroundColor);
    expect(atZ3[name].borderTopColor, `${name} outline should not change at Z3`).toBe(belowZ3[name].borderTopColor);
  }
});

test('layer panel segments and native depth select keep existing state, keyboard, overflow, and lazy behavior', async ({ page }) => {
  const temperatureRequests = [];
  page.on('request', request => {
    if (request.url().includes('/data/temperature/')) temperatureRequests.push(request.url());
  });
  await installMetadataFixture(page);
  await openMap(page);
  await expect(page.locator('#temperatureControls')).toBeHidden();
  expect(temperatureRequests).toEqual([]);
  await expect(page.locator('.environment-segment').first()).toHaveText('None');
  await expect(page.locator('input[name="environmentView"][value="default"]')).toBeChecked();
  await expect(page.locator('#environmentViewSelect')).toHaveValue('default');
  await expect(page.locator('#environmentViewSelect option[value="default"]')).toHaveText('None');

  const temperatureRadio = page.locator('input[name="environmentView"][value="temperature"]');
  await temperatureRadio.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#environmentViewSelect')).toHaveValue('temperature');
  await expect(page.locator('#temperatureControls')).toBeVisible();
  await expect(page.locator('#temperatureSourceNote')).toContainText('WOA23');
  await expect(page.locator('#temperatureSourceResolution')).toHaveText('1° ARC');
  await expect(page.locator('#temperatureInfoResolution')).toHaveText('1° climatological grid');
  await expect(page.locator('input[name="environmentView"]:checked')).toHaveCount(1);
  await expect.poll(() => temperatureRequests.length).toBeGreaterThan(0);
  expect(temperatureRequests.some(url => url.includes('/data/temperature/query/'))).toBe(false);

  const depthOptions = page.locator('#temperatureDepth option');
  await expect(depthOptions).toHaveCount(3);
  await expect(page.locator('#temperatureDepth')).toBeVisible();
  await page.locator('#temperatureInfoAbout').click();
  await expect(page.locator('#temperatureInfoPopover')).toContainText('actual dive conditions may differ');
  await expect(page.locator('#temperatureInfoPopover')).toContainText('NOAA World Ocean Atlas 2023');
  await page.locator('#temperatureInfoAbout').click();
  await page.locator('#temperatureDepth').selectOption('30');
  await expect(page.locator('#temperatureDepth')).toHaveValue('30');
  const initialTemperatureMonth = await page.locator('#temperatureMonth').inputValue();
  const monthNames = { '9':'September', '10':'October', '11':'November' };
  await expect(page.locator('#temperatureLegendSlice')).toHaveText(`30 m · ${monthNames[initialTemperatureMonth]}`);
  await page.locator('#temperatureMonth').selectOption('10');
  await expect(page.locator('#temperatureLegendSlice')).toHaveText('30 m · October');
  await expect(page.locator('#bioLegendCollapsedSummary')).toHaveText('Water TEMP · 30m · Oct');
  await page.locator('#temperatureMonth').selectOption('11');
  await expect(page.locator('#temperatureStatus')).toHaveText('No shading available');
  await page.locator('#temperatureMonth').selectOption('10');

  await page.locator('#temperatureDepth').focus();
  await page.keyboard.press('End');
  await expect(page.locator('#temperatureDepth')).toHaveValue('40');

  await page.locator('#environmentViewSelect').selectOption('default');
  await expect(page.locator('#temperatureControls')).toBeHidden();
  await expect(page.locator('input[name="environmentView"][value="default"]')).toBeChecked();

  const reefToggle = page.locator('#reefLayerToggle');
  await page.locator('label[for="reefLayerToggle"]').click();
  await expect(reefToggle).not.toBeChecked();
  await page.locator('label[for="reefLayerToggle"]').click();
  await expect(reefToggle).toBeChecked();

  await page.locator('#bioLegendOverflow > summary').click();
  await expect(page.locator('#bioLegendOverflow .bio-cache-refresh')).toHaveCount(0);
  await expect(page.locator('#bioLegendOverflow #bioLegendGuide')).toBeVisible();
  await page.locator('#bioLegendOverflow .bio-legend-about > summary').click();
  await expect(page.locator('#bioLegendAboutCopy')).toContainText('OBIS');
  await page.locator('#bioLegendOverflow #bioLegendGuide').click();
  await expect(page.locator('#tutorialBackdrop')).toBeVisible();
  await expect(page.locator('#bioLegendOverflow')).not.toHaveAttribute('open', '');
  await expect.poll(() => temperatureRequests.filter(url => url.includes('/data/temperature/query/')).length).toBe(0);
});

test('header filter control retains the Show all layers action without a duplicate menu', async ({ page }) => {
  await openMap(page);
  if (await page.locator('#bioLegend').evaluate(node => node.classList.contains('is-collapsed'))) {
    await page.locator('#bioLegendTitle').click();
  }
  if (await page.locator('#bioLegend').evaluate(node => node.classList.contains('is-collapsed'))) {
    await page.locator('#bioLegendTitle').click();
  }
  const bulkAction = page.locator('#bioLegendBulkAction');
  await expect(page.locator('#bioLegendFilter')).toHaveCount(0);
  await expect(bulkAction).toBeVisible();
  await expect(bulkAction.locator('.layer-filter-icon')).toBeVisible();
  await expect(bulkAction.locator('.bulk-action-label')).toHaveText('All');
  await expect(page.locator('.bio-legend-heading .bulk-action-label')).toHaveCount(1);
  const headerGeometry = await page.evaluate(() => {
    const rect = selector => {
      const { x, y, right, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { x, y, right, width, height, centerY: y + height / 2 };
    };
    return {
      header: rect('#bioLegendHeading'),
      title: rect('#bioLegendTitle'),
      titleIcon: rect('.bio-legend-title-icon'),
      titleText: rect('.bio-legend-title-label'),
      collapse: rect('#bioLegendTitle'),
      collapseIcon: rect('.bio-legend-title-chevron'),
      bulk: rect('#bioLegendBulkAction'),
      filterIcon: rect('#bioLegendBulkAction .layer-filter-icon'),
      bulkText: rect('#bioLegendBulkAction .bulk-action-label'),
      overflow: rect('#bioLegendOverflow > summary')
    };
  });
  const headerCenterY = headerGeometry.header.centerY;
  await expect(page.locator('#bioLegendTitle .bio-legend-title-chevron')).toHaveCount(1);
  await expect(page.locator('#bioLegendCollapseToggle')).toHaveCount(0);
  const selectorLayout = await page.evaluate(() => {
    const rect = box => {
      const { x, y, width, height } = box;
      return { x, y, width, height, centerX: x + width / 2, centerY: y + height / 2 };
    };
    const track = document.querySelector('.environment-segment-group');
    const group = rect(track.getBoundingClientRect());
    const tabs = [...document.querySelectorAll('.environment-segment')].map(tab => {
      const label = tab.querySelector('span');
      const range = document.createRange();
      range.selectNodeContents(label);
      return {
        value: tab.querySelector('input').value,
        tab: rect(tab.getBoundingClientRect()),
        text: rect(range.getBoundingClientRect())
      };
    });
    return {
      group, tabs, scrollWidth: track.scrollWidth, clientWidth: track.clientWidth,
      overflowX: getComputedStyle(track).overflowX, userSelect: getComputedStyle(track).userSelect
    };
  });
  expect(selectorLayout.tabs).toHaveLength(8);
  expect(selectorLayout.tabs.map(tab => tab.value)).toContain('reef-survey-condition');
  expect(selectorLayout.overflowX).toBe('auto');
  expect(selectorLayout.scrollWidth).toBeGreaterThan(selectorLayout.clientWidth);
  expect(selectorLayout.userSelect).toBe('none');
  for (const tab of selectorLayout.tabs) {
    expect(Math.abs(tab.text.centerX - tab.tab.centerX), `${tab.value} label should be horizontally centered`).toBeLessThanOrEqual(1);
    expect(Math.abs(tab.text.centerY - selectorLayout.group.centerY)).toBeLessThanOrEqual(1.5);
  }
  for (const value of ['dive-experience-outlook', 'temperature', 'water-clarity', 'currents', 'waves']) {
    const selectedStyle = await page.evaluate(selectedValue => {
      const group = document.querySelector('.environment-segment-group');
      group.querySelector(`input[value="${selectedValue}"]`).checked = true;
      return getComputedStyle(group.querySelector(`input[value="${selectedValue}"] + span`)).fontWeight;
    }, value);
    expect(selectedStyle, `${value} should receive the active-pill treatment`).toBe('600');
  }
  await page.evaluate(() => { document.querySelector('input[name="environmentView"][value="default"]').checked = true; });
  await page.evaluate(() => window.__DIVEATLAS_TEST__.setLegendCollapsed(false));
  for (const item of ['titleIcon', 'titleText', 'collapseIcon', 'filterIcon', 'bulkText', 'overflow']) {
    expect(Math.abs(headerGeometry[item].centerY - headerCenterY), `${item} should share the header centerline`).toBeLessThanOrEqual(2);
  }
  const layersControlToFilterGap = headerGeometry.bulk.x - headerGeometry.collapse.right;
  const filterToOverflowGap = headerGeometry.overflow.x - headerGeometry.bulk.right;
  const titleToChevronGap = headerGeometry.collapseIcon.x - headerGeometry.titleText.right;
  expect(layersControlToFilterGap).toBeGreaterThanOrEqual(3);
  expect(layersControlToFilterGap).toBeLessThanOrEqual(5);
  expect(filterToOverflowGap).toBeGreaterThanOrEqual(8);
  expect(filterToOverflowGap).toBeLessThanOrEqual(12);
  expect(titleToChevronGap).toBeGreaterThan(layersControlToFilterGap);
  const collapseToggle = page.locator('#bioLegendTitle');
  const collapseChevron = page.locator('.bio-legend-title-chevron');
  await expect(collapseChevron).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)');
  await collapseToggle.focus();
  await expect(collapseToggle).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#bioLegend')).toHaveClass(/is-collapsed/);
  await expect(collapseToggle).toHaveAttribute('aria-expanded', 'false');
  await page.waitForTimeout(260);
  await expect(collapseChevron).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const collapsedCenterDeltas = await page.evaluate(() => {
    const centerY = selector => {
      const { top, height } = document.querySelector(selector).getBoundingClientRect();
      return top + height / 2;
    };
    const panelCenter = centerY('#bioLegend');
    return Object.fromEntries([
      ['header', '#bioLegendHeading'],
      ['Layers icon', '.bio-legend-title-icon'],
      ['Layers text', '.bio-legend-title-label'],
      ['chevron', '.bio-legend-title-chevron'],
      ['filter icon', '#bioLegendBulkAction .layer-filter-icon'],
      ['All label', '#bioLegendBulkAction .bulk-action-label'],
      ['overflow', '#bioLegendOverflow > summary']
    ].map(([label, selector]) => [label, centerY(selector) - panelCenter]));
  });
  for (const delta of Object.values(collapsedCenterDeltas)) {
    expect(Math.abs(delta)).toBeLessThanOrEqual(1);
  }
  const collapsedHeaderHeight = await page.locator('#bioLegendHeading').evaluate(node => node.getBoundingClientRect().height);
  expect(Math.abs(headerGeometry.header.height - collapsedHeaderHeight)).toBeLessThanOrEqual(1.5);
  await page.keyboard.press('Enter');
  await expect(page.locator('#bioLegend')).not.toHaveClass(/is-collapsed/);
  await expect(collapseToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(collapseChevron).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)');
  for (const viewport of [{ width: 624, height: 1268 }, { width: 360, height: 780 }]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const bounds = selector => {
        const { x, y, right, bottom } = document.querySelector(selector).getBoundingClientRect();
        return { x, y, right, bottom };
      };
      return {
        title: bounds('#bioLegendTitle'),
        action: bounds('#bioLegendBulkAction'),
        overflow: bounds('#bioLegendOverflow > summary'),
        heading: bounds('#bioLegendHeading'),
        view: bounds('.environment-segment-group')
      };
    });
    expect(layout.title.right).toBeLessThanOrEqual(layout.action.x);
    expect(layout.action.right).toBeLessThanOrEqual(layout.overflow.x);
    expect(layout.view.y - layout.heading.bottom).toBeGreaterThanOrEqual(0);
    expect(layout.view.y - layout.heading.bottom).toBeLessThanOrEqual(18);
  }
  await bulkAction.focus();
  await expect(bulkAction).toBeFocused();
  await bulkAction.click();
  for (const id of ['contoursLayerToggle', 'reefLayerToggle', 'speciesLayerToggle', 'fishLayerToggle', 'diveLayerToggle']) {
    await expect(page.locator(`#${id}`)).toBeChecked();
  }
});

test('temperature panel motion follows the latest view, stays inert while closing, and respects reduced motion', async ({ page }) => {
  await page.addInitScript(() => {
    const addEventListener = EventTarget.prototype.addEventListener;
    window.__temperatureTransitionListenerCount = 0;
    EventTarget.prototype.addEventListener = function (type, ...args) {
      if (this.id === 'temperatureControls' && type === 'transitionend') {
        window.__temperatureTransitionListenerCount += 1;
      }
      return addEventListener.call(this, type, ...args);
    };
  });
  const temperatureRequests = [];
  page.on('request', request => {
    if (request.url().includes('/data/temperature/') || request.url().includes('temperature-view.js')) {
      temperatureRequests.push(request.url());
    }
  });
  await installMetadataFixture(page);
  await openMap(page);
  const controls = page.locator('#temperatureControls');
  expect(temperatureRequests).toEqual([]);
  await expect(controls).toBeHidden();
  await expect(controls).toHaveAttribute('aria-hidden', 'true');
  await expect(controls).toHaveJSProperty('inert', true);
  expect(await page.evaluate(() => window.__temperatureTransitionListenerCount)).toBe(1);

  await activateTemperatureView(page);
  await expect(controls).toBeVisible();
  await expect(controls).toHaveAttribute('aria-hidden', 'false');
  await expect(controls).toHaveJSProperty('inert', false);
  await page.screenshot({ path: 'test-results/layers-panel-temperature-opening.png', animations: 'allow' });
  await page.locator('.environment-segment').filter({ has: page.locator('input[name="environmentView"][value="default"]') }).click();
  await page.screenshot({ path: 'test-results/layers-panel-temperature-closing.png', animations: 'allow' });
  await activateTemperatureView(page);
  await page.locator('#environmentViewSelect').selectOption('default');
  await expect(page.locator('input[name="environmentView"]:checked')).toHaveValue('default');
  await expect(controls).toHaveAttribute('aria-hidden', 'true');
  await expect(controls).toBeHidden();
  expect(await controls.evaluate(node => node.contains(document.activeElement))).toBe(false);
  expect(await page.evaluate(() => window.__temperatureTransitionListenerCount)).toBe(1);
  expect(temperatureRequests.filter(url => url.includes('temperature-view.js'))).toHaveLength(1);
  expect(temperatureRequests.filter(url => url.includes('/query/'))).toEqual([]);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await activateTemperatureView(page);
  await expect(controls).toBeVisible();
  await page.locator('#environmentViewSelect').selectOption('default');
  await expect(controls).toBeHidden();
  expect(await page.evaluate(() => window.__temperatureTransitionListenerCount)).toBe(1);
});

test('Layers panel stays within desktop, narrow, and mobile viewports and collapses to its map summary', async ({ page }) => {
  const queryRequests = [];
  page.on('request', request => {
    if (request.url().includes('/data/temperature/query/')) queryRequests.push(request.url());
  });
  await installMetadataFixture(page);
  await openMap(page, { localStorage: { 'global-coral-map-environment-month-v1': '9' } });
  await page.locator('input[name="environmentView"][value="temperature"]').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#temperatureControls')).toBeVisible();
  await page.evaluate(() => document.activeElement?.blur());

  for (const viewport of [
    { name: 'reference', width: 760, height: 1508 },
    { name: 'wide', width: 1440, height: 900 },
    { name: 'medium', width: 980, height: 768 },
    { name: 'narrow', width: 720, height: 900 },
    { name: 'mobile', width: 390, height: 844 }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(240);
    if (await page.locator('#bioLegend').evaluate(node => node.classList.contains('is-collapsed'))) {
      await page.locator('#bioLegendTitle').click();
    }
    await expect(page.locator('#bioLegendLayers')).toHaveAttribute('aria-hidden', 'false');
    await expect.poll(() => page.locator('#bioLegendLayers').evaluate(node => node.clientHeight)).toBeGreaterThan(0);
    await page.waitForTimeout(240);
    const visualScale = viewport.width > 720 ? 0.82 : 1;
    const bounds = await page.locator('#bioLegend').boundingBox();
    expect(bounds.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(bounds.height).toBeLessThanOrEqual(viewport.height - 24);
    if (viewport.width > 720) expect(Math.abs(bounds.width - (380 * visualScale))).toBeLessThanOrEqual(2);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const layerScroll = await page.locator('#bioLegendLayers').evaluate(node => ({
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      overflowY: getComputedStyle(node).overflowY
    }));
    if (viewport.width > 720 && viewport.height > 820) {
      expect(layerScroll.scrollHeight, `${viewport.name} Layers overflow should remain limited: ${JSON.stringify(layerScroll)}`).toBeLessThanOrEqual(layerScroll.clientHeight + 8);
    } else if (layerScroll.scrollHeight > layerScroll.clientHeight + 1) {
      expect(layerScroll.overflowY).toBe('auto');
    }
    const searchBounds = await page.locator('#diveSearchSection').boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(searchBounds.y + searchBounds.height + 8);
    expect(await page.locator('.bio-legend-layers-inner').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(1);
    const tabHeights = await page.locator('.environment-segment span').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    expect(Math.max(...tabHeights) - Math.min(...tabHeights)).toBeLessThan(1);
    expect(Math.abs(Math.min(...tabHeights) - (38 * visualScale))).toBeLessThanOrEqual(1);
    const segmentTargets = await page.locator('.environment-segment').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    expect(segmentTargets.every(height => height >= 44 && height <= 48)).toBe(true);
    expect(Math.abs((await page.locator('.environment-segment-group').boundingBox().then(box => box.height)) - Math.max(46, 48 * visualScale))).toBeLessThanOrEqual(1);
    expect(await page.locator('.bio-legend-row .layer-switch-label--layers').first().boundingBox().then(box => box.width)).toBeGreaterThanOrEqual(44);
    expect(await page.locator('#temperatureInfoAbout').boundingBox().then(box => box.width)).toBe(44);
    expect(Math.abs((await page.locator('#temperatureDepth').boundingBox().then(box => box.height)) - (42 * visualScale))).toBeLessThanOrEqual(1);
    expect(Math.abs((await page.locator('#temperatureMonth').boundingBox().then(box => box.height)) - (42 * visualScale))).toBeLessThanOrEqual(1);
    expect(await page.locator('#temperatureControls .temperature-select-hit-area').first().boundingBox().then(box => box.height)).toBeGreaterThanOrEqual(44);
    expect(await page.locator('#temperatureControls .temperature-select-hit-area').last().boundingBox().then(box => box.height)).toBeGreaterThanOrEqual(44);
    const rows = await page.locator('.bio-legend-row').evaluateAll(nodes => {
      const boxes = nodes.map(node => node.getBoundingClientRect());
      return {
        heights: boxes.map(box => box.height),
        gaps: boxes.slice(1).map((box, index) => box.top - boxes[index].bottom)
      };
    });
    expect(Math.max(...rows.heights) - Math.min(...rows.heights)).toBeLessThan(1);
    expect(Math.abs(Math.min(...rows.heights) - (40 * visualScale))).toBeLessThanOrEqual(1);
    expect(rows.gaps.every(gap => Math.abs(gap - (4 * visualScale)) < 1)).toBe(true);
    const tracks = await page.locator('.bio-legend-row .layer-toggle-switch').evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }));
    expect(tracks.every(track => Math.abs(track.width - (40 * visualScale)) <= 1 && Math.abs(track.height - (20 * visualScale)) <= 1), JSON.stringify(tracks)).toBe(true);
    const badges = await page.locator('.bio-legend-row .layer-symbol-column').evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }));
    expect(badges.every(badge => Math.abs(badge.width - (24 * visualScale)) <= 1 && Math.abs(badge.height - (24 * visualScale)) <= 1), JSON.stringify(badges)).toBe(true);
    expect(await page.locator('.bio-legend-row .layer-switch-label--layers').evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().height >= 44))).toBe(true);
    const controls = await Promise.all(['#temperatureDepth', '#temperatureMonth'].map(selector => page.locator(selector).boundingBox()));
    expect(controls.every(box => Math.abs(box.height - (42 * visualScale)) <= 1)).toBe(true);
    if (viewport.width > 720) expect(controls.every(box => Math.abs(box.width - (159 * visualScale)) <= 1)).toBe(true);
    expect(Math.abs((await page.locator('#temperatureGradient').boundingBox().then(box => box.height)) - (8 * visualScale))).toBeLessThanOrEqual(.5);
    expect(Math.abs(controls[0].y - controls[1].y)).toBeLessThan(1);
    expect(Math.abs(controls[0].height - controls[1].height)).toBeLessThan(1);
    const overlayPitches = await page.locator('.bio-legend-row').evaluateAll(nodes => {
      const boxes = nodes.map(node => node.getBoundingClientRect());
      return boxes.slice(1).map((box, index) => (box.top + box.height / 2) - (boxes[index].top + boxes[index].height / 2));
    });
    expect(overlayPitches.every(pitch => Math.abs(pitch - (44 * visualScale)) < 1)).toBe(true);
    const scrollStyle = await page.locator('#bioLegendLayers').evaluate(node => ({
      overflowY: getComputedStyle(node).overflowY,
      scrollbarWidth: getComputedStyle(node).scrollbarWidth,
      scrollbarDisplay: getComputedStyle(node, '::-webkit-scrollbar').display,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight
    }));
    expect(scrollStyle.scrollbarWidth).toBe('none');
    expect(scrollStyle.scrollbarDisplay).toBe('none');
    expect(scrollStyle.overflowY).toBe('auto');
    if (scrollStyle.scrollHeight > scrollStyle.clientHeight + 1) {
      const scrolled = await page.locator('#bioLegendLayers').evaluate(node => {
        node.scrollTop = 100;
        return node.scrollTop;
      });
      expect(scrolled).toBeGreaterThan(0);
      await page.locator('#bioLegendLayers').evaluate(node => { node.scrollTop = 0; });
    }
    if (viewport.name === 'wide') {
      const expandedHeight = bounds.height;
      expect(expandedHeight / 756).toBeGreaterThanOrEqual(0.78);
      expect(expandedHeight).toBeLessThanOrEqual(Math.min(760, viewport.height - 84));
      await page.screenshot({ path: 'test-results/layers-panel-premium-after.png' });
      await page.screenshot({ path: 'test-results/layers-panel-proportional-after.png' });
      for (const id of ['contoursLayerToggle', 'reefLayerToggle', 'speciesLayerToggle', 'fishLayerToggle', 'diveLayerToggle']) {
        const toggle = page.locator(`#${id}`);
        const wasChecked = await toggle.isChecked();
        const track = page.locator(`label[for="${id}"] .layer-toggle-switch`);
        await track.scrollIntoViewIfNeeded();
        const trackBounds = await track.boundingBox();
        await page.mouse.click(trackBounds.x + trackBounds.width / 2, trackBounds.y + trackBounds.height / 2);
        await expect(toggle).toHaveJSProperty('checked', !wasChecked);
        await page.mouse.click(trackBounds.x + trackBounds.width / 2, trackBounds.y + trackBounds.height / 2);
        await expect(toggle).toHaveJSProperty('checked', wasChecked);
      }
    }
    if (viewport.name === 'reference') {
      const referenceMetrics = await page.evaluate(() => {
        const selectors = ['#bioLegend', '#bioLegendHeading', '.bio-legend-title', '.environment-segment-group', '.temperature-heading-title', '.temperature-heading-description', '.temperature-control-label', '#temperatureDepth', '.temperature-gradient', '.bio-legend-row', '.layer-symbol-column', '.layer-toggle-switch'];
        return {
          fontLoaded: document.fonts.check('14px Outfit'),
          metrics: selectors.map(selector => {
            const node = document.querySelector(selector);
            if (!node) return [selector, null];
            const box = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return [selector, { width: box.width, height: box.height, fontSize: style.fontSize, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, borderRadius: style.borderRadius }];
          })
        };
      });
      console.log('PROPORTIONAL_VIEWPORT_PANEL_METRICS', JSON.stringify(referenceMetrics));
      expect(bounds.height / 756).toBeGreaterThanOrEqual(0.78);
      expect(bounds.height).toBeLessThanOrEqual(Math.min(760, viewport.height - 84));
      const selectorStyle = await page.locator('.environment-segment-shell').evaluate(node => ({
        radius: getComputedStyle(node).borderRadius,
        activeRadius: getComputedStyle(node.querySelector('.environment-segment input:checked + span')).borderRadius
      }));
      expect(Math.abs(parseFloat(selectorStyle.radius) - 9)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(parseFloat(selectorStyle.activeRadius) - 6)).toBeLessThanOrEqual(0.5);
      const panelBox = await page.locator('#bioLegend').boundingBox();
      await page.screenshot({ path: 'test-results/layers-panel-reference-viewport.png', clip: { x: panelBox.x, y: panelBox.y, width: panelBox.width, height: panelBox.height } });
      await page.screenshot({ path: 'test-results/layers-panel-proportional-after-crop.png', clip: { x: panelBox.x, y: panelBox.y, width: panelBox.width, height: panelBox.height } });
    }
    const columns = await Promise.all([
      '.bio-legend-row .layer-symbol-column',
      '.bio-legend-row .legend-copy',
      '.bio-legend-row .layer-switch-label'
    ].map(selector => page.locator(selector).evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect();
      return { x: box.x, right: box.right };
    }))));
    for (const positions of columns) {
      expect(
        Math.max(...positions.map(position => position.x)) - Math.min(...positions.map(position => position.x)),
        `${viewport.name} overlay column x positions: ${JSON.stringify(positions)}`
      ).toBeLessThanOrEqual(3.5);
    }
    expect(Math.max(...columns[2].map(position => position.right)) - Math.min(...columns[2].map(position => position.right))).toBeLessThan(1);
    if (viewport.name === 'wide' || viewport.name === 'medium' || viewport.name === 'narrow' || viewport.name === 'mobile') {
      await page.screenshot({ path: `test-results/layers-panel-${viewport.name}.png` });
    }
  }

  await page.locator('#bioLegendTitle').click();
  await expect(page.locator('#bioLegend')).toHaveClass(/is-collapsed/);
  await expect(page.locator('#bioLegendCollapsedSummary')).toHaveText('Water TEMP · 20m · Sept');
  await page.screenshot({ path: 'test-results/layers-panel-mobile-collapsed.png' });
  expect(queryRequests).toEqual([]);
});

test('mobile Layers starts collapsed and expands on demand without temperature requests', async ({ page }) => {
  const temperatureRequests = [];
  page.on('request', request => {
    if (request.url().includes('/data/temperature/')) temperatureRequests.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page);
  await expect(page.locator('#bioLegend')).toHaveClass(/is-collapsed/);
  await expect(page.locator('#bioLegendCollapsedSummary')).toHaveText('Map');
  await expect(page.locator('#bioLegendLayers')).toHaveAttribute('aria-hidden', 'true');
  expect(temperatureRequests).toEqual([]);
  await page.screenshot({ path: 'test-results/layers-panel-mobile-default-collapsed.png' });
  await page.locator('#bioLegendTitle').click();
  await expect(page.locator('#bioLegend')).not.toHaveClass(/is-collapsed/);
  await expect(page.locator('#bioLegendLayers')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('input[name="environmentView"][value="dive-conditions"]')).toHaveCount(0);
});

async function clickMapCoordinate(page, lat, lng) {
  await page.evaluate(([latitude, longitude]) => {
    const map = window.__DIVEATLAS_TEST__.map;
    const latlng = window.L.latLng(latitude, longitude);
    const point = map.latLngToContainerPoint(latlng);
    map.fire('click', { latlng, containerPoint: point });
  }, [lat, lng]);
}

async function placeCoordinateNearSafeTop(page, lat, lng) {
  return page.evaluate(([latitude, longitude]) => {
    const map = window.__DIVEATLAS_TEST__.map;
    const mapRect = map.getContainer().getBoundingClientRect();
    const headerRect = document.querySelector('#topMenuBar').getBoundingClientRect();
    const rootStyle = getComputedStyle(document.documentElement);
    const visualViewport = window.visualViewport;
    const visualTop = visualViewport?.offsetTop || 0;
    const safeAreaTop = parseFloat(rootStyle.getPropertyValue('--map-safe-area-top')) || 0;
    const safeTop = Math.max(
      mapRect.top + 14,
      headerRect.bottom + 14,
      visualTop + safeAreaTop + 14
    );
    const size = map.getSize();
    const target = window.L.latLng(latitude, longitude);
    const targetPoint = map.project(target, map.getZoom());
    const wantedPoint = window.L.point(size.x * 0.55, safeTop - mapRect.top + 40);
    const centerPoint = targetPoint.subtract(wantedPoint.subtract(size.divideBy(2)));
    const center = map.unproject(centerPoint, map.getZoom());
    window.__DIVEATLAS_TEST__.setView(center.lat, center.lng, map.getZoom());
    return { x: wantedPoint.x, y: wantedPoint.y };
  }, [lat, lng]);
}

async function expectTemperaturePopupContained(page, { below = true } = {}) {
  const state = await page.evaluate(() => window.__DIVEATLAS_TEST__.getState());
  expect(state.popup, 'Temperature popup should remain active').not.toBeNull();
  expect(state.popup.below).toBe(below);
  expect(state.popup.arrowSide).toBe(below ? 'top' : 'bottom');
  expect(state.popup.bounds.left).toBeGreaterThanOrEqual(state.popup.safeBounds.left - 1);
  expect(state.popup.bounds.right).toBeLessThanOrEqual(state.popup.safeBounds.right + 1);
  expect(state.popup.bounds.top).toBeGreaterThanOrEqual(state.popup.safeBounds.top - 1);
  expect(state.popup.bounds.bottom).toBeLessThanOrEqual(state.popup.safeBounds.bottom + 1);
  return state;
}

test('real WOA23 query chunk stays lazy, returns the generated value/profile, and is reused', async ({ page }) => {
  const requests = [];
  const queryResponses = [];
  page.on('request', request => {
    if (request.url().includes('/data/temperature/query/')) requests.push(request.url());
  });
  page.on('response', response => {
    if (response.url().includes('/data/temperature/query/')) {
      queryResponses.push(response.body().then(body => ({ url: response.url(), bytes: body.byteLength })));
    }
  });
  const queryMetadata = JSON.parse((await readTestDataAsset('data/temperature/query/metadata.json')).toString('utf8'));
  expect(queryMetadata.format).toBe('diveatlas-temperature-query');
  await openMap(page);
  expect(requests).toEqual([]);
  await page.locator('#environmentViewSelect').selectOption('temperature');
  await expect(page.locator('.temperature-tiles')).toHaveCount(1);
  expect(requests).toEqual([]);

  const chunkResponse = page.waitForResponse(response => response.url().includes('/data/temperature/query/chunks/'));
  await page.locator('#temperatureMonth').selectOption('9');
  await page.locator('#temperatureDepth').selectOption('20');
  const centerBeforeClick = await page.evaluate(() => window.__DIVEATLAS_TEST__.map.getCenter());
  const firstClickStarted = Date.now();
  await clickMapCoordinate(page, -5.7, 131);
  const response = await chunkResponse;
  expect(response.status()).toBe(200);
  await expect(page.locator('.temperature-detail-value')).toHaveText('26.9');
  const firstClickMs = Date.now() - firstClickStarted;
  const centerAfterPopup = await page.evaluate(() => window.__DIVEATLAS_TEST__.map.getCenter());
  expect(Math.abs(centerAfterPopup.lat - centerBeforeClick.lat)).toBeLessThan(1e-5);
  expect(Math.abs(centerAfterPopup.lng - centerBeforeClick.lng)).toBeLessThan(1e-5);
  await page.locator('#temperatureDepth').selectOption('10');
  await expect(page.locator('.temperature-detail-value')).toHaveText('27');
  await page.locator('#temperatureMonth').selectOption('10');
  await expect(page.locator('.temperature-detail-value')).toHaveText('28.1');
  await page.locator('#temperatureDepth').selectOption('20');
  await expect(page.locator('.temperature-detail-value')).toHaveText('27.8');
  await page.locator('#temperatureMonth').selectOption('9');
  await expect(page.locator('.temperature-detail-value')).toHaveText('26.9');
  const initialResponseBytes = (await Promise.all(queryResponses)).reduce((sum, item) => sum + item.bytes, 0);
  expect(requests.filter(url => url.includes('/metadata.json'))).toHaveLength(1);
  const chunkRequests = requests.filter(url => url.includes('/chunks/'));
  expect(chunkRequests).toHaveLength(1);
  await page.getByRole('button', { name: 'Depth' }).click();
  await expect(page.locator('.temperature-profile-chart')).toBeVisible();
  expect(await page.locator('.temperature-profile-chart circle').count()).toBe(11);
  const profileRadii = await page.locator('.temperature-profile-chart circle').evaluateAll(nodes => nodes.map(node => node.getAttribute('r')));
  expect(profileRadii[4]).toBe('4');
  await expect(page.locator('[data-temperature-tab="year"]')).toBeEnabled();
  await page.locator('[data-temperature-tab="year"]').click();
  await expect(page.locator('.temperature-year-chart circle')).toHaveCount(12);
  await expect(page.locator('.temperature-year-values span')).toHaveCount(12);
  expect(await page.locator('.temperature-year-chart circle').nth(8).getAttribute('fill')).toBe('var(--accent)');
  await page.locator('#temperatureMonth').selectOption('10');
  await expect(page.locator('.temperature-year-chart circle')).toHaveCount(12);
  expect(await page.locator('.temperature-year-chart circle').nth(9).getAttribute('fill')).toBe('var(--accent)');
  await page.locator('#temperatureMonth').selectOption('9');
  expect(await page.locator('.temperature-year-chart circle').nth(8).getAttribute('fill')).toBe('var(--accent)');
  await page.evaluate(() => window.__DIVEATLAS_TEST__.map.setZoom(8));
  await page.waitForTimeout(600);
  await expect(page.locator('.leaflet-popup')).toBeVisible();

  await clickMapCoordinate(page, -5.6, 131.1);
  await expect(page.locator('.temperature-detail-value')).toHaveText('26.9');
  expect(requests.filter(url => url.includes('/chunks/'))).toHaveLength(1);
  console.log('real query performance:', JSON.stringify({ firstClickMs, firstClickBytes: initialResponseBytes,
    sameChunkAdditionalRequests: requests.length - 2,
    sameChunkAdditionalBytes: (await Promise.all(queryResponses)).reduce((sum, item) => sum + item.bytes, 0) - initialResponseBytes }));
  await page.locator('#environmentViewSelect').selectOption('default');
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
});

test('temperature query never steals marker clicks and its detail closes when disabled', async ({ page }) => {
  const queryRequests = [];
  page.on('request', request => {
    if (request.url().includes('/data/temperature/query/')) queryRequests.push(request.url());
  });
  await openMap(page);
  await page.locator('#environmentViewSelect').selectOption('temperature');
  await addFixture(page, 'dive-site', { id: 'query-transparent-marker', lat: -5.7, lng: 131 });
  await clickFixture(page, 'query-transparent-marker');
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  await expect(page.locator('.temperature-detail')).toHaveCount(0);
  expect(queryRequests).toEqual([]);

  await page.locator('#environmentViewSelect').selectOption('default');
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  await expect(page.locator('.temperature-detail')).toHaveCount(0);
});

test('masked land produces no popup and a slower earlier click cannot replace the latest location', async ({ page }) => {
  let noDataChunkResponses = 0;
  page.on('response', response => {
    if (response.url().includes('/data/temperature/query/chunks/')) noDataChunkResponses += 1;
  });
  await openMap(page);
  await page.locator('#environmentViewSelect').selectOption('temperature');
  await clickMapCoordinate(page, -25, 134);
  await expect.poll(() => noDataChunkResponses).toBeGreaterThan(0);
  await expect(page.locator('.temperature-detail')).toHaveCount(0);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);

  let firstChunkRoute;
  let releaseFirstChunk;
  await page.route('**/data/temperature/query/chunks/**', async route => {
    if (!firstChunkRoute) {
      firstChunkRoute = route;
      await new Promise(resolve => { releaseFirstChunk = resolve; });
      await route.continue();
    } else {
      await route.continue();
    }
  });
  await clickMapCoordinate(page, -5.7, 131);
  await expect.poll(() => Boolean(firstChunkRoute)).toBe(true);
  await clickMapCoordinate(page, -8, 155);
  releaseFirstChunk();
  await expect(page.locator('.temperature-detail-value')).toHaveText(/^\d+(?:[.,]\d+)?$/);
  await expect(page.locator('.temperature-detail-heading')).toContainText('°C');
  const latestValue = await page.locator('.temperature-detail-value').textContent();
  await page.waitForTimeout(350);
  await expect(page.locator('.temperature-detail-value')).toHaveText(latestValue);
});

test('turning Temperature off while a query chunk is pending prevents the popup reopening', async ({ page }) => {
  await openMap(page);
  await page.locator('#environmentViewSelect').selectOption('temperature');
  let pendingRoute;
  let releasePending;
  await page.route('**/data/temperature/query/chunks/**', async route => {
    pendingRoute = route;
    await new Promise(resolve => { releasePending = resolve; });
    try { await route.continue(); } catch (_) {}
  });
  await clickMapCoordinate(page, -5.7, 131);
  await expect.poll(() => Boolean(pendingRoute)).toBe(true);
  await page.locator('#environmentViewSelect').selectOption('default');
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  releasePending();
  await page.waitForTimeout(350);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
});

test('temperature detail stays compact and tappable at a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page, { localStorage: { 'global-coral-map-environment-month-v1': '9' } });
  await page.locator('#bioLegendTitle').click();
  await activateTemperatureView(page);
  await page.locator('#bioLegendTitle').click();
  await placeCoordinateNearSafeTop(page, -5.7, 131);
  const before = await page.evaluate(() => window.__DIVEATLAS_TEST__.getState());
  const chunkResponse = page.waitForResponse(response => response.url().includes('/data/temperature/query/chunks/'));
  await clickMapCoordinate(page, -5.7, 131);
  expect((await chunkResponse).status()).toBe(200);
  await expect(page.locator('.temperature-detail-value')).toHaveText(/^\d+(?:[.,]\d+)?$/);
  await expect(page.locator('.temperature-detail-heading')).toContainText('°C');
  await openMobileSettings(page);
  await page.locator('#measurementUnitSwitch [data-length-unit="ft"]').click();
  await expect(page.locator('#temperatureCoverageNote')).toContainText('15.5 mi');
  await closeTopMenu(page);
  await page.getByRole('button', { name: 'Depth' }).click();
  await expect(page.locator('.temperature-profile-chart')).toContainText('ft');
  await openTopMenu(page);
  await page.locator('#temperatureUnitSwitch [data-temperature-unit="F"]').click();
  await closeTopMenu(page);
  await expect(page.locator('.temperature-detail-heading')).toContainText('°F');
  await expect(page.locator('.temperature-profile-chart')).toContainText('°F');
  let state = await expectTemperaturePopupContained(page);
  expect(state.zoom).toBe(before.zoom);
  expect(state.center).toEqual(before.center);
  await page.getByRole('button', { name: 'Depth' }).click();
  await expect(page.locator('.temperature-profile-chart circle')).toHaveCount(11);
  state = await expectTemperaturePopupContained(page);
  expect(state.zoom).toBe(before.zoom);
  expect(state.center).toEqual(before.center);
  const bounds = await page.locator('.leaflet-popup').boundingBox();
  const closeBounds = await page.locator('.leaflet-popup-close-button').boundingBox();
  expect(bounds.width).toBeLessThanOrEqual(330);
  expect(closeBounds.width).toBeGreaterThanOrEqual(44);
  expect(closeBounds.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: 'test-results/temperature-detail-mobile.png' });
});

test('length-dependent explanations stay localized when language and units change', async ({ page }) => {
  await openMap(page);
  await activateTemperatureView(page);
  await page.locator('#measurementUnitSwitch [data-length-unit="ft"]').click();

  const coverageCopyByLanguage = {
    zh: '淡色区域', en: 'Faded areas', ja: '淡色の領域', fr: 'zones pâles',
    de: 'Blasse Bereiche', nl: 'Lichte gebieden', it: 'Le aree più chiare',
    ru: 'Бледные области', pt: 'áreas esmaecidas', sv: 'Bleka områden',
    no: 'Bleke områder', es: 'Las zonas atenuadas', ko: '옅은 영역', id: 'Area pudar'
  };

  for (const [language, localizedCopy] of Object.entries(coverageCopyByLanguage)) {
    await page.locator('#languageMenuButton').click();
    await page.locator(`#languageDropdown [data-language="${language}"]`).click();
    await expect(page.locator('#temperatureCoverageNote')).toContainText(localizedCopy);
    await expect(page.locator('#temperatureCoverageNote')).toContainText(/15[.,]5 mi/u);
    await expect(page.locator('#coralHeatStressResolutionValue')).toContainText(/3[.,]1 mi/u);
    await expect(page.locator('#coralHeatStressResolutionValue')).not.toContainText('{distance}');
  }
});

test('Temperature popup content stays inside the safe area at the top boundary without moving the map', async ({ page }) => {
  await openMap(page);
  await activateTemperatureView(page);
  await expect(page.locator('#temperatureControls')).toBeVisible();
  await placeCoordinateNearSafeTop(page, -5.7, 131);
  const before = await page.evaluate(() => window.__DIVEATLAS_TEST__.getState());
  const chunkResponse = page.waitForResponse(response => response.url().includes('/data/temperature/query/chunks/'));
  await clickMapCoordinate(page, -5.7, 131);
  expect((await chunkResponse).status()).toBe(200);
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  await expect(page.locator('.temperature-detail-value')).toHaveText(/^\d+(?:[.,]\d+)?$/);
  await expect(page.locator('.temperature-detail-heading')).toContainText('°C');
  let after = await expectTemperaturePopupContained(page);
  expect(after.zoom).toBe(before.zoom);
  expect(after.center).toEqual(before.center);

  await page.getByRole('button', { name: 'Depth' }).click();
  await expect(page.locator('.temperature-profile-chart circle')).toHaveCount(11);
  after = await expectTemperaturePopupContained(page);
  expect(after.zoom).toBe(before.zoom);
  expect(after.center).toEqual(before.center);
});

test('changing month and depth requests only the newest slice and leaves markers clickable', async ({ page }) => {
  const requests = [];
  page.on('request', request => {
    if (request.url().includes('/data/temperature/')) requests.push(request.url());
  });
  await installMetadataFixture(page);
  await openMap(page);
  await page.locator('#environmentViewSelect').selectOption('temperature');
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  await page.locator('#temperatureDepth').selectOption('30');
  await page.locator('#temperatureMonth').selectOption('10');
  await expect.poll(() => requests.some(url => url.includes('/10/30/'))).toBe(true);
  await expect.poll(() => page.locator('.temperature-tiles').count()).toBe(1);
  const panePointerEvents = await page.locator('.temperature-tiles').first().evaluate(node => getComputedStyle(node.parentElement).pointerEvents);
  expect(panePointerEvents).toBe('none');

  await addFixture(page, 'dive-site', { id: 'temperature-marker', lat: -5.7, lng: 131 });
  await clickFixture(page, 'temperature-marker');
  await expect(page.locator('.leaflet-popup')).toBeVisible();

  await page.locator('#environmentViewSelect').selectOption('default');
  const beforePan = requests.length;
  await page.evaluate(() => window.__DIVEATLAS_TEST__.setView(-8, 134, 7));
  await page.waitForTimeout(250);
  expect(requests.length).toBe(beforePan);
});

test('real WOA23 September 20 m tile loads, renders, and preserves masked pixels', async ({ page }) => {
  const realMetadata = fs.existsSync(temperatureMetadata)
    ? JSON.parse(fs.readFileSync(temperatureMetadata, 'utf8'))
    : null;
  const hasProductionFixture = realMetadata?.active_profile === 'production-0.25deg' &&
    realMetadata.purpose === 'production' && realMetadata.available_slices?.some(
      ([month, depth]) => month === 9 && depth === 20
    );
  expect(hasProductionFixture, 'The shipped production manifest must include the WOA23 September/20 m slice.').toBe(true);

  await openMap(page, { localStorage: { 'global-coral-map-environment-month-v1': '9' } });
  await page.evaluate(() => window.__DIVEATLAS_TEST__.setView(-20, 133.8, 3));
  const tileResponse = page.waitForResponse(response =>
    response.url().includes('/data/temperature/production-0.25deg/woa23/monthly/09/20/3/6/4.png')
  );
  await page.locator('#environmentViewSelect').selectOption('temperature');
  const response = await tileResponse;
  expect(response.status()).toBe(200);
  const tile = page.locator('img.leaflet-tile-loaded[src*="/production-0.25deg/woa23/monthly/09/20/3/6/4.png"]');
  await expect(tile).toBeVisible();
  await expect.poll(() => tile.evaluate(image => image.complete && image.naturalWidth === 256)).toBe(true);
  const alpha = await tile.evaluate(async image => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, 256, 256).data;
    let clear = 0;
    let colored = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] === 0) clear++;
      if (pixels[i] > 0) colored++;
    }
    // Pixel (249, 118) is interior Australia in this z3/x6/y4 tile.
    const australiaLandAlpha = pixels[(118 * 256 + 249) * 4 + 3];
    return { clear, colored, australiaLandAlpha };
  });
  expect(alpha.clear).toBeGreaterThan(0);
  expect(alpha.colored).toBeGreaterThan(0);
  expect(alpha.australiaLandAlpha).toBe(0);
  await expect(page.locator('#temperatureScaleMin')).toHaveText(`${realMetadata.temperature_scale.min_c}°C`);
  await expect(page.locator('#temperatureScaleMax')).toHaveText(`${realMetadata.temperature_scale.max_c}°C`);

  await page.evaluate(() => window.__DIVEATLAS_TEST__.setView(-5.7, 131, 7));
  await addFixture(page, 'dive-site', { id: 'real-temperature-marker', lat: -5.7, lng: 131 });
  await clickFixture(page, 'real-temperature-marker');
  await expect(page.locator('.leaflet-popup')).toBeVisible();
});
