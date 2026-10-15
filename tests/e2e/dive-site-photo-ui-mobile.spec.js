const { test, expect } = require('@playwright/test');
const { openMap } = require('./support');
const { openFallbackPhotoPopup } = require('./photo-ui-support');

const fixtureName = 'Test dive site photo-fallback-ui';

test.beforeEach(async ({ page }) => openMap(page));

test('mobile fallback photos invite a site-specific contribution without crowding the photo', async ({ page }) => {
  const popup = await openFallbackPhotoPopup(page);
  const frame = popup.locator('.dive-popup-photo-frame');
  const status = frame.locator('.dive-popup-photo-label--illustrative');
  const upload = frame.locator('[data-dive-site-photo-upload]');

  await expect(status).toBeVisible();
  await expect(status).toHaveText('Representative image · not this dive site');
  await expect(upload).toBeVisible();
  await expect(upload.locator('.dive-popup-photo-label__touch')).toContainText('Share a real photo');
  const photoLayout = await frame.evaluate((node, selectors) => {
    const frameBounds = node.getBoundingClientRect();
    const statusBounds = node.querySelector(selectors.status).getBoundingClientRect();
    const upload = node.querySelector(selectors.upload);
    const uploadBounds = upload.getBoundingClientRect();
    return {
      frameTop:frameBounds.top,
      frameBottom:frameBounds.bottom,
      statusTop:statusBounds.top,
      statusBottom:statusBounds.bottom,
      uploadBottom:uploadBounds.bottom,
      uploadTop:uploadBounds.top,
      uploadHeight:uploadBounds.height,
      uploadPillHeight:parseFloat(getComputedStyle(upload, '::before').height)
    };
  }, { status:'.dive-popup-photo-label--illustrative', upload:'[data-dive-site-photo-upload]' });
  expect(Math.abs(photoLayout.statusTop - photoLayout.frameTop - 8)).toBeLessThanOrEqual(1);
  expect(Math.abs(photoLayout.frameBottom - photoLayout.uploadBottom - 2)).toBeLessThanOrEqual(1);
  expect(photoLayout.statusBottom).toBeLessThanOrEqual(photoLayout.uploadTop);
  expect(photoLayout.uploadHeight).toBeGreaterThanOrEqual(44);
  expect(photoLayout.uploadPillHeight).toBe(32);

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
