const { expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const MAP_URL = '/?__diveatlas_test=1&lat=-5.7&lng=131&z=7';
const sourceRoot = path.resolve(__dirname, '../..');
const dataAssetConfigPath = path.join(__dirname, '../../_site/js/data-assets-config.js');
const dataAssetConfig = fs.existsSync(dataAssetConfigPath)
  ? fs.readFileSync(dataAssetConfigPath, 'utf8').match(/^window\.DIVEATLAS_DATA_ASSET_BASE_URL = (null|"[^"\r\n]*");$/m)?.[1]
  : null;
const dataAssetBaseUrl = dataAssetConfig && dataAssetConfig !== 'null' ? JSON.parse(dataAssetConfig) : null;
const dataAssetBase = dataAssetBaseUrl ? new URL(dataAssetBaseUrl) : null;

async function openMap(page, { url = MAP_URL, localStorage = {}, externalAssets = false } = {}) {
  await page.addInitScript(initialStorage => {
    try {
      localStorage.clear();
      for (const [key, value] of Object.entries(initialStorage)) {
        localStorage.setItem(key, String(value));
      }
      localStorage.setItem('global-coral-map-theme', 'light');
    } catch (_) {}
    window.__firstVisiblePopup = null;
    new MutationObserver(() => {
      if (window.__firstVisiblePopup) return;
      const popup = document.querySelector('.leaflet-popup');
      if (!popup || getComputedStyle(popup).visibility === 'hidden') return;
      const rect = popup.getBoundingClientRect();
      window.__firstVisiblePopup = {
        className: popup.className,
        arrowSide: popup.dataset.arrowSide || null,
        left: rect.left,
        top: rect.top
      };
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'data-arrow-side'] });
  }, localStorage);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if ((url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.pathname.startsWith('/data/tests/fixtures/')) {
      const fixturePath = path.resolve(sourceRoot, 'tests', 'fixtures', decodeURIComponent(url.pathname.slice('/data/tests/fixtures/'.length)));
      if (fixturePath.startsWith(`${path.resolve(sourceRoot, 'tests/fixtures')}${path.sep}`) && fs.existsSync(fixturePath) && fs.statSync(fixturePath).isFile()) {
        return route.fulfill({ path: fixturePath });
      }
    }
    if (externalAssets && url.hostname === '127.0.0.1' && url.pathname === '/js/data-assets-config.js' && fs.existsSync(dataAssetConfigPath)) {
      return route.fulfill({
        status: 200,
        contentType: 'text/javascript; charset=utf-8',
        body: fs.readFileSync(dataAssetConfigPath, 'utf8')
      });
    }
    if (dataAssetBase && url.origin === dataAssetBase.origin && url.pathname.startsWith(dataAssetBase.pathname)) {
      // Test pages run on localhost, while production R2 CORS allows only the
      // deployed site origin. Proxy just the configured public asset origin
      // through Playwright so tests exercise the release without widening bucket CORS.
      const response = await route.fetch({ timeout: 30_000 });
      const headers = { ...response.headers() };
      const pageOrigin = route.request().headers().origin;
      if (pageOrigin) headers['access-control-allow-origin'] = pageOrigin;
      return route.fulfill({ response, headers });
    }
    if ((url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.pathname.startsWith('/data/')) {
      // Let test-specific routes run before the local server serves a checked-in
      // asset or proxies an absent data file from the configured R2 release.
      return route.fallback();
    }
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === 'unpkg.com') {
      return route.fallback();
    }
    return route.abort();
  });
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => Boolean(window.__DIVEATLAS_TEST__?.map))).toBe(true);
  await page.evaluate(() => new Promise(resolve => {
    window.__DIVEATLAS_TEST__.map.whenReady(resolve);
  }));
  await page.evaluate(() => window.__DIVEATLAS_TEST__.map.invalidateSize({ animate: false }));
}

async function setMapView(page, lat, lng, zoom) {
  await page.evaluate(([nextLat, nextLng, nextZoom]) => {
    window.__DIVEATLAS_TEST__.setView(nextLat, nextLng, nextZoom);
  }, [lat, lng, zoom]);
}

async function addFixture(page, type, { id, lat, lng, count } = {}) {
  await page.evaluate(({ type, id, lat, lng, count }) => {
    const api = window.__DIVEATLAS_TEST__;
    if (type === 'aggregate') api.addAggregate('species', lat, lng, count, id);
    if (type === 'fish-aggregate') api.addAggregate('fish', lat, lng, count, id);
    if (type === 'dive-aggregate') api.addAggregate('dive', lat, lng, count, id);
    if (type === 'coral-point') api.addCoralPoint(lat, lng, id);
    if (type === 'coral-grid') api.addCoralGrid(lat, lng, id);
    if (type === 'fish-point') api.addFishPoint(lat, lng, id);
    if (type === 'dive-site') api.addDiveSite(lat, lng, id);
  }, { type, id: id || type, lat, lng, count });
}

async function fixturePoint(page, id) {
  return page.evaluate(id => {
    const point = window.__DIVEATLAS_TEST__.pointFor(id);
    const rect = document.getElementById('map').getBoundingClientRect();
    return { x: rect.left + point.x, y: rect.top + point.y };
  }, id);
}

async function clickFixture(page, id, options = {}) {
  const point = await fixturePoint(page, id);
  await page.mouse.click(point.x, point.y, options);
}

async function waitForClickResolution(page) {
  await page.evaluate(() => new Promise(resolve => {
    window.setTimeout(resolve, 410);
  }));
}

async function expectNoPopup(page) {
  await waitForClickResolution(page);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
}

async function mapState(page) {
  return page.evaluate(() => window.__DIVEATLAS_TEST__.getState());
}

async function resetActionCount(page) {
  await page.evaluate(() => window.__DIVEATLAS_TEST__.clearActionCount());
}

async function readTestDataAsset(relativePath) {
  const segments = relativePath.split('/').filter(Boolean);
  if (!segments.length || segments.some(segment => segment === '.' || segment === '..' || segment.includes('\\'))) {
    throw new Error(`Invalid test data path: ${relativePath}`);
  }

  if (dataAssetBase) {
    const assetUrl = new URL(segments.map(encodeURIComponent).join('/'), dataAssetBase);
    const response = await fetch(assetUrl);
    if (!response.ok) throw new Error(`Test data asset returned HTTP ${response.status}: ${relativePath}`);
    return Buffer.from(await response.arrayBuffer());
  }

  const localPath = path.resolve(sourceRoot, ...segments);
  if (!localPath.startsWith(`${sourceRoot}${path.sep}`)) throw new Error(`Invalid test data path: ${relativePath}`);
  return fs.promises.readFile(localPath);
}

async function openMobileSettings(page) {
  const lengthUnits = page.locator('#measurementUnitSwitch');
  if (await lengthUnits.isVisible()) return;
  await openTopMenu(page);
  await expect(lengthUnits).toBeVisible();
}

async function openTopMenu(page) {
  const menu = page.locator('#topMenuDropdown');
  if (await menu.isHidden()) await page.getByRole('button', { name: 'Menu' }).click();
  await expect(menu).toBeVisible();
}

async function closeTopMenu(page) {
  const menu = page.locator('#topMenuDropdown');
  if (await menu.isVisible()) await page.getByRole('button', { name: 'Menu' }).click();
  await expect(menu).toBeHidden();
}

async function addDiveSiteAtScreenPoint(page, id, x, y) {
  await page.evaluate(({ id, x, y }) => {
    const api = window.__DIVEATLAS_TEST__;
    const latlng = api.latLngAt(x, y);
    api.addDiveSite(latlng.lat, latlng.lng, id);
  }, { id, x, y });
}

module.exports = {
  MAP_URL,
  dataAssetBaseUrl,
  addDiveSiteAtScreenPoint,
  addFixture,
  clickFixture,
  expectNoPopup,
  fixturePoint,
  mapState,
  openMobileSettings,
  openTopMenu,
  closeTopMenu,
  readTestDataAsset,
  openMap,
  resetActionCount,
  setMapView,
  waitForClickResolution
};
