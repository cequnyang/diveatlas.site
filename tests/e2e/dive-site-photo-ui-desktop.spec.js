const { test, expect } = require('@playwright/test');
const { openMap } = require('./support');
const { openFallbackPhotoPopup } = require('./photo-ui-support');

test.beforeEach(async ({ page }) => openMap(page));

test('desktop fallback-photo label changes to a contribution invite on hover without resizing', async ({ page }) => {
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
