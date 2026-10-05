const { expect } = require('@playwright/test');

const MAP_URL = '/?__diveatlas_test=1&lat=-5.7&lng=131&z=7';

async function openMap(page, { url = MAP_URL, localStorage = {} } = {}) {
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

async function addDiveSiteAtScreenPoint(page, id, x, y) {
  await page.evaluate(({ id, x, y }) => {
    const api = window.__DIVEATLAS_TEST__;
    const latlng = api.latLngAt(x, y);
    api.addDiveSite(latlng.lat, latlng.lng, id);
  }, { id, x, y });
}

module.exports = {
  MAP_URL,
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
};
