const { test, expect } = require('@playwright/test');
const { openMap } = require('./support');
const { openFallbackPhotoPopup } = require('./photo-ui-support');

test.beforeEach(async ({ page }, testInfo) => openMap(page, {
  localStorage:{ 'global-coral-map-lang':testInfo.title.includes('Chinese') ? 'zh' : 'en' }
}));

test('desktop fallback-photo label resizes to the active caption on hover', async ({ page }) => {
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
    background:getComputedStyle(node).backgroundColor,
    statusWidth:node.querySelector('.dive-popup-photo-label__rest').getBoundingClientRect().width,
    horizontalChrome:parseFloat(getComputedStyle(node).paddingLeft) + parseFloat(getComputedStyle(node).paddingRight) + parseFloat(getComputedStyle(node).borderLeftWidth) + parseFloat(getComputedStyle(node).borderRightWidth)
  }));
  expect(resting.statusOpacity).toBe('1');
  expect(resting.actionOpacity).toBe('0');
  expect(resting.width).toBeCloseTo(resting.statusWidth + resting.horizontalChrome, 0);

  await upload.hover();
  await expect.poll(() => upload.evaluate(node => ({
    width:node.getBoundingClientRect().width,
    statusOpacity:getComputedStyle(node.querySelector('.dive-popup-photo-label__rest')).opacity,
    actionOpacity:getComputedStyle(node.querySelector('.dive-popup-photo-label__action')).opacity,
    background:getComputedStyle(node).backgroundColor
  }))).toMatchObject({ statusOpacity:'0', actionOpacity:'1' });
  const hovered = await upload.evaluate(node => ({
    width:node.getBoundingClientRect().width,
    actionWidth:node.querySelector('.dive-popup-photo-label__action').getBoundingClientRect().width,
    background:getComputedStyle(node).backgroundColor
  }));
  expect(hovered.width).toBeCloseTo(hovered.actionWidth + resting.horizontalChrome, 0);
  await expect.poll(() => upload.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(resting.background);
});

test('desktop Chinese fallback-photo label fits the visible translated caption', async ({ page }) => {
  const popup = await openFallbackPhotoPopup(page);
  const upload = popup.locator('[data-dive-site-photo-upload]');
  await expect(upload.locator('.dive-popup-photo-label__rest')).toHaveText('示意图片 · 非该潜点实景');

  const labelLayout = await upload.evaluate(node => {
    const frame = node.closest('.dive-popup-photo-frame');
    const status = node.querySelector('.dive-popup-photo-label__rest');
    const style = getComputedStyle(node);
    return {
      frameWidth:frame.getBoundingClientRect().width,
      labelWidth:node.getBoundingClientRect().width,
      statusWidth:status.getBoundingClientRect().width,
      horizontalChrome:parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)
    };
  });
  expect(labelLayout.labelWidth).toBeLessThan(labelLayout.frameWidth * 0.75);
  expect(labelLayout.labelWidth).toBeCloseTo(labelLayout.statusWidth + labelLayout.horizontalChrome, 0);

  await upload.hover();
  const hovered = await upload.evaluate(node => {
    const action = node.querySelector('.dive-popup-photo-label__action');
    return { width:node.getBoundingClientRect().width, clientWidth:action.clientWidth, scrollWidth:action.scrollWidth };
  });
  expect(hovered.width).toBeGreaterThan(labelLayout.labelWidth);
  expect(hovered.width).toBeLessThanOrEqual(labelLayout.frameWidth - 20);
  expect(hovered.scrollWidth).toBeLessThanOrEqual(hovered.clientWidth);

  await page.mouse.move(0, 0);
  await expect.poll(() => upload.evaluate(node => node.getBoundingClientRect().width)).toBeCloseTo(labelLayout.labelWidth, 0);
  await page.keyboard.press('Tab');
  await upload.focus();
  await expect.poll(() => upload.evaluate(node => node.getBoundingClientRect().width)).toBeCloseTo(hovered.width, 0);
});

test('photo upload sign-in link resolves to the auth Worker when available', async ({ page }) => {
  const popup = await openFallbackPhotoPopup(page);
  await page.route('**/api/auth/me', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({ user:null })
  }));

  await popup.locator('[data-dive-site-photo-upload]').click();
  const signIn = page.locator('#sitePhotoUploadSignIn');
  await expect(signIn).toBeVisible();
  await expect(signIn).toHaveAttribute('href', '/api/auth/google');
});
