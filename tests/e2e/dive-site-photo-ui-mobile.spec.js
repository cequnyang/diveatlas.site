const { test, expect } = require('@playwright/test');
const { openMap } = require('./support');
const { openFallbackPhotoPopup } = require('./photo-ui-support');

const fixtureName = 'Test dive site photo-fallback-ui';

test('returning to the map clears the retained release hint', async ({ page }) => {
  const popup = await openFallbackPhotoPopup(page);
  const handle = popup.locator('.diveatlas-mobile-sheet-handle');
  await expect(handle).toBeVisible();
  const box = await handle.evaluate(node => node.getBoundingClientRect().toJSON());
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 160, { steps:8 });
  await expect(popup.locator('.mobile-sheet-pull-hint')).toBeVisible();
  // BFCache restores the outgoing DOM, including the retained navigation pose.
  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set('site', 'photo-fallback-ui');
    history.replaceState(history.state, '', url);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted:true }));
  });
  await expect(popup.locator('.mobile-sheet-pull-hint')).toBeHidden();
  expect(await popup.evaluate(node => node.style.getPropertyValue('--mobile-panel-drag-y'))).toBe('');
  await handle.dispatchEvent('pointercancel', { pointerId:1 });
  await page.mouse.up();
});

test('reversing an upward content pull unwinds without switching glass layers', async ({ page }) => {
  const popup = await openFallbackPhotoPopup(page);
  const content = popup.locator('.leaflet-popup-content');
  await content.evaluate(node => { node.scrollTop = node.scrollHeight; });
  const material = () => popup.evaluate(node => {
    const glass = getComputedStyle(node, '::after');
    return [glass.backgroundColor, glass.backdropFilter,
      getComputedStyle(node.querySelector('.leaflet-popup-content-wrapper')).backgroundColor];
  });
  const resting = await material();
  const touch = async (type, y) => content.evaluate((node, { type, y }) => {
    const point = new Touch({ identifier:7, target:node, clientX:200, clientY:y });
    node.dispatchEvent(new TouchEvent(type, { bubbles:true, cancelable:true,
      touches:type === 'touchcancel' ? [] : [point], changedTouches:[point] }));
  }, { type, y });
  await touch('touchstart', 600);
  await touch('touchmove', 440);
  const expanded = await popup.boundingBox();
  await touch('touchmove', 460);
  const reversed = await popup.boundingBox();
  await expect(popup.locator('.mobile-sheet-pull-hint')).toBeVisible();
  expect(await material()).toEqual(resting);
  expect(reversed.height).toBeLessThanOrEqual(expanded.height);
  expect(Math.abs(reversed.y + reversed.height - page.viewportSize().height)).toBeLessThanOrEqual(1);
  await touch('touchmove', 590);
  expect(await material()).toEqual(resting);
  // Release a sub-threshold pull: retain the expansion rule while its
  // padding animates back, instead of hiding the hint and snapping shut.
  await touch('touchmove', 520);
  await touch('touchend', 520);
  expect(await popup.locator('.mobile-sheet-pull-hint').evaluate(node => node.hidden)).toBe(false);
  const frames = await popup.evaluate(node => new Promise(resolve => {
    const frames = [];
    const start = performance.now();
    const sample = () => {
      const rect = node.getBoundingClientRect();
      const glass = getComputedStyle(node, '::after');
      frames.push({ height:rect.height, bottom:rect.bottom, viewport:innerHeight,
        tint:glass.backgroundColor, blur:glass.backdropFilter });
      if (performance.now() - start < 360) requestAnimationFrame(sample);
      else resolve(frames);
    };
    requestAnimationFrame(sample);
  }));
  for (let index = 0; index < frames.length; index += 1) {
    expect(Math.abs(frames[index].bottom - frames[index].viewport)).toBeLessThanOrEqual(1);
    expect(frames[index].tint).toBe(resting[0]);
    expect(frames[index].blur).toBe(resting[1]);
    if (index) expect(frames[index].height).toBeLessThanOrEqual(frames[index - 1].height + 1);
  }
  await expect.poll(() => popup.locator('.mobile-sheet-pull-hint').evaluate(node => node.hidden)).toBe(true);
  expect(await material()).toEqual(resting);
  await touch('touchstart', 600);
  await touch('touchmove', 440);
  await touch('touchmove', 600);
  await touch('touchend', 600);
  await expect(popup.locator('.mobile-sheet-pull-hint')).toBeHidden();
  await expect(popup).not.toHaveClass(/mobile-vertical-dragging/);
  expect(await popup.evaluate(node => node.style.getPropertyValue('--mobile-panel-drag-y'))).toBe('');
});

for (const language of ['English', 'Chinese']) {
  test(`detail-opening pull hints follow ${language} selection`, async ({ page }) => {
    const popup = await openFallbackPhotoPopup(page);
    const handle = popup.locator('.diveatlas-mobile-sheet-handle');
    await expect(handle).toBeVisible();
    const box = await handle.evaluate(node => node.getBoundingClientRect().toJSON());
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 60, { steps:4 });
    await expect(popup.locator('.mobile-sheet-pull-hint')).toHaveText(
      language === 'Chinese' ? '上拉查看详情' : 'Pull up to open details');
    await expect(popup.locator('.mobile-sheet-pull-hint')).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(popup.locator('.mobile-sheet-pull-hint')).toHaveCSS('background-color', 'rgba(17, 30, 48, 0.94)');
    await page.mouse.move(x, y - 160, { steps:4 });
    await expect(popup.locator('.mobile-sheet-pull-hint')).toHaveText(
      language === 'Chinese' ? '松开查看详情' : 'Release to open details');
    await expect(popup.locator('.mobile-sheet-pull-hint')).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(popup.locator('.mobile-sheet-pull-hint')).toHaveCSS('background-color', 'rgb(36, 86, 188)');
    await handle.dispatchEvent('pointercancel', { pointerId:1 });
    await page.mouse.up();
  });
}

test('upward detail pull grows the body-mounted sheet without exposing the map', async ({ page }) => {
  const popup = await openFallbackPhotoPopup(page);
  expect(await popup.evaluate(node => node.parentElement === document.body)).toBe(true);
  const before = await popup.boundingBox();
  const handle = popup.locator('.diveatlas-mobile-sheet-handle');
  await expect(handle).toBeVisible();
  const box = await handle.evaluate(node => node.getBoundingClientRect().toJSON());
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 160, { steps: 8 });
  await expect(popup.locator('.mobile-sheet-pull-hint')).toBeVisible();
  const geometry = await popup.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const fill = getComputedStyle(node, '::after');
    return { bottom:rect.bottom, height:rect.height, viewport:innerHeight,
      fillHeight:parseFloat(fill.height), fillBottom:fill.bottom, fillTop:fill.top,
      background:fill.backgroundColor, clip:fill.clipPath };
  });
  expect(Math.abs(geometry.bottom - geometry.viewport)).toBeLessThanOrEqual(1);
  expect(geometry.height).toBeGreaterThan(before.height + 30);
  expect(geometry.fillHeight).toBeGreaterThan(30);
  expect(geometry.fillBottom).toBe('0px');
  expect(geometry.clip).toBe('none');
  expect(geometry.background).not.toBe('rgba(0, 0, 0, 0)');
  const material = await popup.evaluate(node => {
    const glass = getComputedStyle(node, '::after');
    const wrapper = getComputedStyle(node.querySelector('.leaflet-popup-content-wrapper'));
    return { tint:glass.backgroundColor, blur:glass.backdropFilter,
      wrapperTint:wrapper.backgroundColor, wrapperBlur:wrapper.backdropFilter,
      top:glass.top, bottom:glass.bottom };
  });
  expect(material.tint).toContain('0.85');
  expect(material.blur).toBe('blur(8px) saturate(1.45)');
  expect(material.wrapperTint).toBe('rgba(0, 0, 0, 0)');
  expect(material.wrapperBlur).toBe('none');
  expect(material.top).toBe('0px');
  expect(material.bottom).toBe('0px');
  // Cancel rather than release: this regression must not navigate to details.
  await handle.dispatchEvent('pointercancel', { pointerId:1 });
  await page.mouse.up();
});

test.beforeEach(async ({ page }, testInfo) => {
  const language = testInfo.title.includes('Chinese') ? 'zh' : 'en';
  await openMap(page, { localStorage:{ 'global-coral-map-lang':language }, theme:testInfo.project.metadata.pullTheme || 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.metadata.pullTheme || 'light');
});

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

  const labelLayout = await status.evaluate(node => {
    const frame = node.closest('.dive-popup-photo-frame');
    const text = node.querySelector('.dive-popup-photo-label__illustrative-copy');
    return {
      frameWidth:frame.getBoundingClientRect().width,
      labelWidth:node.getBoundingClientRect().width,
      textWidth:text.getBoundingClientRect().width,
      horizontalChrome:parseFloat(getComputedStyle(node).paddingLeft) + parseFloat(getComputedStyle(node).paddingRight) + parseFloat(getComputedStyle(node).borderLeftWidth) + parseFloat(getComputedStyle(node).borderRightWidth)
    };
  });
  expect(labelLayout.labelWidth).toBeLessThan(labelLayout.frameWidth * 0.75);
  expect(labelLayout.labelWidth).toBeCloseTo(labelLayout.textWidth + labelLayout.horizontalChrome, 0);

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
    titleLineHeight:'23.4px',
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

test('Chinese fallback-photo labels shrink-wrap their translated text', async ({ page }) => {
  const popup = await openFallbackPhotoPopup(page);
  const status = popup.locator('.dive-popup-photo-label--illustrative');
  await expect(status).toHaveText('示意图片 · 非该潜点实景');

  const labelLayout = await status.evaluate(node => {
    const frame = node.closest('.dive-popup-photo-frame');
    const text = node.querySelector('.dive-popup-photo-label__illustrative-copy');
    const style = getComputedStyle(node);
    return {
      frameWidth:frame.getBoundingClientRect().width,
      labelWidth:node.getBoundingClientRect().width,
      textWidth:text.getBoundingClientRect().width,
      horizontalChrome:parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)
    };
  });
  expect(labelLayout.labelWidth).toBeLessThan(labelLayout.frameWidth * 0.75);
  expect(labelLayout.labelWidth).toBeCloseTo(labelLayout.textWidth + labelLayout.horizontalChrome, 0);
});

for (const width of [320, 425]) {
  test(`wrapped mobile dive-site titles keep readable line spacing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height:800 });
    const popup = await openFallbackPhotoPopup(page);
    const title = popup.locator('.bio-popup-title');
    await title.locator('.dive-popup-detail-link').evaluate(node => {
      node.textContent = 'Justin’s Caves, Cape Town, South Africa';
    });
    const lines = await title.evaluate(node => {
      const link = node.querySelector('.dive-popup-detail-link');
      const range = document.createRange();
      range.selectNodeContents(link);
      const tops = [...new Set([...range.getClientRects()].map(rect => rect.top))].sort((a,b) => a-b);
      return { tops, fontSize:parseFloat(getComputedStyle(node).fontSize) };
    });
    expect(lines.tops.length).toBeGreaterThan(1);
    for (let i=1; i<lines.tops.length; i++) {
      expect(lines.tops[i] - lines.tops[i-1]).toBeGreaterThanOrEqual(lines.fontSize * 1.25);
    }
  });
}
