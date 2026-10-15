const { test, expect } = require('@playwright/test');
const { clickFixture, openMap, setMapView } = require('./support');

const fixtureId = 'photo-fallback-ui';
const fixtureName = `Test dive site ${fixtureId}`;

test.beforeEach(async ({ page }) => openMap(page));

async function openFallbackPhotoPopup(page) {
  await setMapView(page, -5.7, 131, 14);
  await page.evaluate(id => {
    window.__DIVEATLAS_TEST__.addDiveSite(-5.7, 131, id, { withFallbackPhoto:true });
  }, fixtureId);
  await clickFixture(page, fixtureId);
  const popup = page.locator('.leaflet-popup.dive-site-popup--with-photo');
  await expect(popup).toBeVisible();
  return popup;
}

test('mobile fallback photos invite a site-specific contribution without crowding the photo', async ({ page }) => {
  test.skip(page.viewportSize().width > 720, 'mobile photo controls are shown only on touch and narrow layouts');
  const popup = await openFallbackPhotoPopup(page);
  const frame = popup.locator('.dive-popup-photo-frame');
  const status = frame.locator('.dive-popup-photo-label--illustrative');
  const upload = frame.locator('[data-dive-site-photo-upload]');

  await expect(status).toBeVisible();
  await expect(status).toHaveText('Representative image · not this dive site');
  await expect(upload).toBeVisible();
  await expect(upload.locator('.dive-popup-photo-label__touch')).toContainText('Add a site photo');
  const photoLayout = await frame.evaluate((node, selectors) => {
    const frameBounds = node.getBoundingClientRect();
    const statusBounds = node.querySelector(selectors.status).getBoundingClientRect();
    const uploadBounds = node.querySelector(selectors.upload).getBoundingClientRect();
    return {
      frameBottom:frameBounds.bottom,
      statusBottom:statusBounds.bottom,
      uploadBottom:uploadBounds.bottom,
      uploadHeight:uploadBounds.height
    };
  }, { status:'.dive-popup-photo-label--illustrative', upload:'[data-dive-site-photo-upload]' });
  expect(Math.abs(photoLayout.statusBottom - photoLayout.uploadBottom)).toBeLessThanOrEqual(1);
  expect(photoLayout.frameBottom - photoLayout.uploadBottom).toBeGreaterThanOrEqual(0);
  expect(photoLayout.uploadHeight).toBeGreaterThanOrEqual(44);

  const headingStyles = await popup.evaluate(node => {
    const title = node.querySelector('.bio-popup-title');
    const temperatureHeading = document.createElement('div');
    temperatureHeading.className = 'temperature-detail-heading';
    temperatureHeading.style.cssText = 'position:absolute;visibility:hidden';
    node.querySelector('.leaflet-popup-content').append(temperatureHeading);
    const titleStyle = getComputedStyle(title);
    const temperatureStyle = getComputedStyle(temperatureHeading);
    return {
      titleFontSize:titleStyle.fontSize,
      titleLineHeight:titleStyle.lineHeight,
      temperatureFontSize:temperatureStyle.fontSize,
      temperatureLineHeight:temperatureStyle.lineHeight
    };
  });
  expect(headingStyles).toEqual({
    titleFontSize:'18px',
    titleLineHeight:'16.25px',
    temperatureFontSize:'18px',
    temperatureLineHeight:'18.75px'
  });

  await page.route('**/api/auth/me', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({ user:null })
  }));
  await upload.click();
  const dialog = page.locator('#sitePhotoUploadDialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#sitePhotoUploadSiteName')).toHaveText(fixtureName);
  await expect(dialog.locator('#sitePhotoUploadAuthRequired')).toBeVisible();
});

test('desktop fallback-photo label changes to a contribution invite on hover without resizing', async ({ page }) => {
  test.skip(page.viewportSize().width <= 720, 'desktop photo-label hover is unavailable on mobile');
  const popup = await openFallbackPhotoPopup(page);
  const frame = popup.locator('.dive-popup-photo-frame');
  const status = frame.locator('.dive-popup-photo-label--illustrative');
  const upload = frame.locator('[data-dive-site-photo-upload]');

  await expect(status).toBeHidden();
  await expect(upload).toBeVisible();
  const resting = await upload.evaluate(node => ({
    width:node.getBoundingClientRect().width,
    statusOpacity:getComputedStyle(node.querySelector('.dive-popup-photo-label__rest')).opacity,
    actionOpacity:getComputedStyle(node.querySelector('.dive-popup-photo-label__action')).opacity,
    background:getComputedStyle(node).backgroundColor
  }));
  expect(resting.statusOpacity).toBe('1');
  expect(resting.actionOpacity).toBe('0');

  await upload.hover();
  await expect.poll(() => upload.evaluate(node => ({
    width:node.getBoundingClientRect().width,
    statusOpacity:getComputedStyle(node.querySelector('.dive-popup-photo-label__rest')).opacity,
    actionOpacity:getComputedStyle(node.querySelector('.dive-popup-photo-label__action')).opacity,
    background:getComputedStyle(node).backgroundColor
  }))).toMatchObject({ statusOpacity:'0', actionOpacity:'1' });
  const hovered = await upload.evaluate(node => ({
    width:node.getBoundingClientRect().width,
    background:getComputedStyle(node).backgroundColor
  }));
  expect(hovered.width).toBeCloseTo(resting.width, 0);
  expect(hovered.background).not.toBe(resting.background);
});
