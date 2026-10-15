const { expect } = require('@playwright/test');
const { clickFixture, openMap, setMapView } = require('./support');

const fixtureId = 'photo-fallback-ui';

async function openFallbackPhotoPopup(page) {
  // A failed image removes the photo frame and its popup class; use a stable
  // fixture image so these layout checks do not depend on the public CDN.
  await page.route('https://assets.diveatlas.site/share-preview/v1/features/**', route => route.fulfill({
    status:200,
    contentType:'image/svg+xml',
    body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="100%" height="100%" fill="#789"/></svg>'
  }));
  await setMapView(page, -5.7, 131, 14);
  await page.evaluate(id => {
    window.__DIVEATLAS_TEST__.addDiveSite(-5.7, 131, id, { withFallbackPhoto:true });
  }, fixtureId);
  await clickFixture(page, fixtureId);
  const popup = page.locator('.leaflet-popup.dive-site-popup--with-photo');
  await expect(popup).toBeVisible();
  return popup;
}

module.exports = { openFallbackPhotoPopup };
