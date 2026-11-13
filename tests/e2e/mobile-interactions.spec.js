const { test, expect } = require('@playwright/test');
const { gzipSync } = require('node:zlib');
const {
  addFixture,
  clickFixture,
  mapState,
  openMap,
  resetActionCount,
  setMapView,
  waitForClickResolution,
  waitForMapInteractionWindow
} = require('./support');

const depthSampleFixture = gzipSync(Buffer.from(new Int16Array(225 * 225).fill(-500).buffer));

test.beforeEach(async ({ page }, testInfo) => openMap(page, {
  theme: testInfo.project.metadata.pullTheme || 'light',
  disableLegendAutoCollapse: testInfo.title !== 'mobile layer rows toggle across the row and the collapsed bar shrinks after idle'
}));

async function swipeRightOn(page, selector) {
  await page.locator(selector).evaluate(panel => {
    const rect = panel.getBoundingClientRect();
    const start = new Touch({ identifier:7, target:panel, clientX:rect.left + 30, clientY:200 });
    const end = new Touch({ identifier:7, target:panel, clientX:rect.left + 120, clientY:204 });
    panel.dispatchEvent(new TouchEvent('touchstart', {
      bubbles:true, cancelable:true, touches:[start], targetTouches:[start], changedTouches:[start]
    }));
    panel.dispatchEvent(new TouchEvent('touchend', {
      bubbles:true, cancelable:true, touches:[], targetTouches:[], changedTouches:[end]
    }));
  });
}

async function dispatchSheetContentTouchGesture(page, {
  sheetSelector = '.leaflet-popup.diveatlas-mobile-sheet',
  targetSelector = '.bio-popup-title',
  startY = 300,
  moveYs = [],
  endY = moveYs.at(-1) ?? startY,
  initialScrollTop = 0,
  scrollTopChanges = []
} = {}) {
  return page.locator(sheetSelector).evaluate((surface, options) => {
    const content = surface.querySelector('.leaflet-popup-content');
    const target = content.querySelector(options.targetSelector) || content;
    const bounds = target.getBoundingClientRect();
    const clientX = bounds.left + Math.min(12, bounds.width / 2);
    content.scrollTop = options.initialScrollTop;
    const makeTouch = clientY => new Touch({ identifier:41, target, clientX, clientY });
    const dispatch = (type, touch) => {
      const touches = type === 'touchend' ? [] : [touch];
      const event = new TouchEvent(type, {
        bubbles:true,
        cancelable:true,
        touches,
        targetTouches:touches,
        changedTouches:[touch]
      });
      target.dispatchEvent(event);
      return event;
    };

    dispatch('touchstart', makeTouch(options.startY));
    const moves = options.moveYs.map((clientY, index) => {
      const scrollChange = options.scrollTopChanges.find(change => change.moveIndex === index);
      if (scrollChange) content.scrollTop = scrollChange.value;
      const event = dispatch('touchmove', makeTouch(clientY));
      return {
        dragging:surface.classList.contains('mobile-vertical-dragging'),
        offset:surface.style.getPropertyValue('--mobile-panel-drag-y'),
        defaultPrevented:event.defaultPrevented
      };
    });
    dispatch('touchend', makeTouch(options.endY));
    return {
      moves,
      dragging:surface.classList.contains('mobile-vertical-dragging'),
      offset:surface.style.getPropertyValue('--mobile-panel-drag-y')
    };
  }, { sheetSelector, targetSelector, startY, moveYs, endY, initialScrollTop, scrollTopChanges });
}

async function expectTitleAtDrawerInset(drawer, titleSelector, inset) {
  const titleOffset = await drawer.evaluate((panel, selector) => {
    const title = panel.querySelector(selector);
    return title.getBoundingClientRect().left - panel.getBoundingClientRect().left;
  }, titleSelector);
  expect(titleOffset).toBeCloseTo(inset, 0);
}

async function waitForSelectedMapPointToSettle(page) {
  let previousPosition = null;
  let stableSince = 0;
  await expect.poll(async () => {
    const position = await page.evaluate(() => {
      const map = window.__DIVEATLAS_TEST__.map;
      const marker = document.querySelector('.map-click-location-marker');
      if (!map || !marker) return null;
      const bounds = marker.getBoundingClientRect();
      const center = map.getCenter();
      return { left:bounds.left, top:bounds.top, lat:center.lat, lng:center.lng };
    });
    if (!position) {
      previousPosition = null;
      return false;
    }
    const signature = JSON.stringify(position);
    if (signature !== previousPosition) {
      previousPosition = signature;
      stableSince = Date.now();
      return false;
    }
    return Date.now() - stableSince >= 120;
  }, { interval:40 }).toBe(true);
}

async function expectPointerCenteredInExposedMap(page) {
  let latestGeometry;
  await expect.poll(async () => {
    latestGeometry = await page.evaluate(() => {
      const marker = document.querySelector('.map-click-location-marker');
      const map = document.querySelector('#map');
      const sheet = document.querySelector('.leaflet-popup.diveatlas-mobile-sheet, .leaflet-popup.dive-conditions-rating-sheet');
      const header = document.querySelector('#topMenuBar');
      if (!marker || !map || !sheet || !header) return { deviation:Infinity };
      const markerBounds = marker.getBoundingClientRect();
      const mapBounds = map.getBoundingClientRect();
      const rootStyle = getComputedStyle(document.documentElement);
      const safeAreaTop = parseFloat(rootStyle.getPropertyValue('--map-safe-area-top')) || 0;
      const safeAreaBottom = parseFloat(rootStyle.getPropertyValue('--map-safe-area-bottom')) || 0;
      const visualViewport = window.visualViewport;
      const visualTop = visualViewport?.offsetTop || 0;
      const visualBottom = visualViewport ? visualTop + visualViewport.height : window.innerHeight;
      const visibleTop = Math.max(mapBounds.top, header.getBoundingClientRect().bottom, visualTop + safeAreaTop);
      const visibleBottom = Math.min(mapBounds.bottom, visualBottom - safeAreaBottom, sheet.getBoundingClientRect().top);
      if (visibleBottom <= visibleTop) return { deviation:Infinity };
      const horizontalError = markerBounds.left + markerBounds.width / 2 - (mapBounds.left + mapBounds.width / 2);
      const verticalError = markerBounds.bottom - (visibleTop + (visibleBottom - visibleTop) / 2);
      const deviation = Math.hypot(horizontalError, verticalError);
      return {
        deviation,
        horizontalError,
        verticalError,
        visibleTop,
        visibleBottom,
        markerBottom:markerBounds.bottom,
        mapBottom:mapBounds.bottom,
        visualBottom,
        sheetTop:sheet.getBoundingClientRect().top
      };
    });
    return latestGeometry.deviation;
  }).toBeLessThan(6).catch(error => {
    error.message += `\nLast exposed-map geometry: ${JSON.stringify(latestGeometry)}`;
    throw error;
  });
}

async function waitForMobileMapSheetGeometryToSettle(page) {
  let previousLayout = null;
  let stableSince = 0;
  await expect.poll(async () => {
    const layout = await page.evaluate(() => {
      const map = window.__DIVEATLAS_TEST__.map;
      const sheet = document.querySelector('.leaflet-popup.diveatlas-mobile-sheet, .leaflet-popup.dive-conditions-rating-sheet');
      if (!map || !sheet) return null;
      const bounds = sheet.getBoundingClientRect();
      const center = map.getCenter();
      return {
        sheetTop:bounds.top,
        sheetHeight:bounds.height,
        centerLat:center.lat,
        centerLng:center.lng
      };
    });
    if (!layout) {
      previousLayout = null;
      return false;
    }
    const signature = JSON.stringify(layout);
    if (signature !== previousLayout) {
      previousLayout = signature;
      stableSince = Date.now();
      return false;
    }
    return Date.now() - stableSince >= 120;
  }, { interval:40 }).toBe(true);
}

test('language selector opens as a half-width page that slides in from the right', async ({ page }) => {
  const trigger = page.locator('#languageMenuButton');
  const languagePage = page.locator('#languageDropdown');

  await expect(trigger.locator('#languageMenuLabel')).toBeHidden();
  await expect(trigger.locator('.language-globe-icon')).toBeVisible();
  await expect(trigger.locator('.language-chevron-icon')).toBeHidden();
  expect(await page.evaluate(() => {
    const language = document.querySelector('#languageMenuButton').getBoundingClientRect();
    const menu = document.querySelector('#topMenuButton').getBoundingClientRect();
    return menu.left - language.right;
  })).toBeLessThanOrEqual(8);
  await expect(trigger.locator('.language-globe-icon circle')).toHaveAttribute('stroke-width', '2');
  await trigger.click();
  await expect(languagePage).toBeVisible();
  await expect(languagePage).toHaveClass(/is-open/);
  const languageHeader = languagePage.locator('.language-page-header');
  await expect(languageHeader).toBeVisible();
  await expect(languagePage.locator('.language-page-back')).toHaveCount(0);
  await expectTitleAtDrawerInset(languagePage, '.language-page-header > span', 21);
  const firstLanguage = languagePage.locator('[data-language="en"]');
  await expect.poll(async () => (await firstLanguage.boundingBox()).y - ((await languageHeader.boundingBox()).y + (await languageHeader.boundingBox()).height)).toBeGreaterThanOrEqual(0);
  const options = languagePage.locator('.language-page-options');
  await expect(options).toHaveCSS('scrollbar-width', 'none');
  await options.evaluate(el => { el.scrollTop = 90; });
  expect(await options.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  const headerBottom = await languageHeader.evaluate(el => el.getBoundingClientRect().bottom);
  const optionsTop = await options.evaluate(el => el.getBoundingClientRect().top);
  expect(optionsTop).toBeGreaterThanOrEqual(headerBottom);
  expect(await languageHeader.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await options.evaluate(el => { el.scrollTop = 0; });
  await expect.poll(() => languageHeader.evaluate(node => node.getBoundingClientRect().top)).toBeLessThanOrEqual(8);
  await expect.poll(() => languagePage.evaluate(node =>
    Math.abs(node.getBoundingClientRect().left - document.documentElement.clientWidth / 2)
  )).toBeLessThan(1);
  const pageBounds = await languagePage.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { left:rect.left, right:rect.right, width:rect.width, viewport:document.documentElement.clientWidth };
  });
  expect(Math.abs(pageBounds.right - pageBounds.viewport)).toBeLessThan(1);
  expect(Math.abs(pageBounds.width - pageBounds.viewport / 2)).toBeLessThan(1);
  expect(Math.abs(pageBounds.left - pageBounds.viewport / 2)).toBeLessThan(1);

  await languagePage.locator('[data-language="es"]').click();
  await expect(page.locator('#langSelect')).toHaveValue('es');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(languagePage).toBeHidden({ timeout:1_000 });
  await trigger.click();
  await expect(languagePage).toHaveClass(/is-open/);
  await swipeRightOn(page, '#languageDropdown');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(languagePage).toBeHidden({ timeout:1_000 });
});

test('main menu opens as a half-width page from the right on mobile', async ({ page }) => {
  const trigger = page.locator('#topMenuButton');
  const menuPage = page.locator('#topMenuDropdown');

  await trigger.click();
  await expect(menuPage).toBeVisible();
  await expect(menuPage).toHaveClass(/is-open/);
  const menuHeader = menuPage.locator('.top-menu-page-header');
  await expect(menuHeader).toBeVisible();
  await expect(menuPage.locator('.top-menu-page-back')).toHaveCount(0);
  await expect(menuPage.locator('a.top-menu-dropdown-item[href="/dive-sites/"]')).toBeVisible();
  await expect(menuPage.locator('a.top-menu-dropdown-item[href="/regions/"]')).toBeVisible();
  const comparisonLink = menuPage.locator('a.top-menu-dropdown-item[href="/compare/"]');
  await expect(comparisonLink).toBeVisible();
  await expect(menuPage.locator('.top-menu-divider')).toHaveCount(2);
  await expect(comparisonLink.locator('xpath=preceding-sibling::*[1]')).toHaveClass(/top-menu-divider/);
  await expect(comparisonLink.locator('xpath=following-sibling::*[1]')).toHaveClass(/top-menu-divider/);
  await expect(menuPage.locator('#aboutMenuItem')).toBeVisible();
  await expect(menuPage.locator('#contactMenuItem')).toBeVisible();
  await expectTitleAtDrawerInset(menuPage, '#topMenuPageTitle', 15);
  await expect.poll(() => menuHeader.evaluate(node => node.getBoundingClientRect().top)).toBeLessThanOrEqual(8);
  const menuVersion = menuPage.locator('.top-menu-version');
  const versionBottomGap = await menuPage.evaluate(node => {
    const panelBottom = node.getBoundingClientRect().bottom;
    const versionBottom = node.querySelector('.top-menu-version').getBoundingClientRect().bottom;
    return panelBottom - versionBottom;
  });
  expect(versionBottomGap).toBeLessThanOrEqual(24);
  await expect.poll(() => menuPage.evaluate(node =>
    Math.abs(node.getBoundingClientRect().left - document.documentElement.clientWidth / 2)
  )).toBeLessThan(1);
  const pageBounds = await menuPage.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { left:rect.left, right:rect.right, width:rect.width, viewport:document.documentElement.clientWidth };
  });
  expect(Math.abs(pageBounds.right - pageBounds.viewport)).toBeLessThan(1);
  expect(Math.abs(pageBounds.width - pageBounds.viewport / 2)).toBeLessThan(1);
  expect(Math.abs(pageBounds.left - pageBounds.viewport / 2)).toBeLessThan(1);

  await swipeRightOn(page, '#topMenuDropdown');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(menuPage).toBeHidden({ timeout:1_000 });
  await trigger.click();
  await expect(menuPage).toHaveClass(/is-open/);
  await menuPage.locator('#aboutMenuItem').click();
  const aboutModal = page.locator('#aboutInfoModal');
  await expect(aboutModal).toBeVisible();
  await expect(menuPage).toBeHidden({ timeout:1_000 });
  await expect(aboutModal.locator('[role="dialog"]')).toHaveAttribute('aria-modal', 'true');
  await expect(aboutModal.locator('#aboutInfoContent')).toContainText('DiveAtlas is an interactive map');
  await page.keyboard.press('Escape');
  await expect(aboutModal).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('mobile theme toggle stays visible in the map top bar', async ({ page }) => {
  const themeButton = page.locator('#themeBtn');

  await expect(themeButton).toBeVisible();
  await expect(page.locator('#topMenuBar .top-menu-controls > #themeBtn')).toHaveCount(1);
  await expect(page.locator('#topMenuMobileSettings #themeBtn')).toHaveCount(0);
});

test('mobile dive-site sheet and detail page share a reversible view transition', async ({ page }, testInfo) => {
  const expectedTheme = testInfo.project.metadata.pullTheme || 'light';
  await expect(page.locator('html')).toHaveAttribute('data-theme', expectedTheme);
  const siteId = '0000adba-c5c9-41f3-9cc0-6b525dcf959b';
  await page.addInitScript(() => {
    new MutationObserver(() => {
      const surface = document.querySelector('.leaflet-popup.diveatlas-mobile-sheet.dive-site-popup.mobile-sheet-entering');
      if (!surface) return;
      sessionStorage.setItem('diveatlas-map-return-animation', JSON.stringify({
        translate:getComputedStyle(surface).translate,
        transition:getComputedStyle(surface).transition
      }));
    }).observe(document, { subtree:true, childList:true, attributes:true, attributeFilter:['class'] });
  });
  await page.evaluate(id => {
    const marker = window.__DIVEATLAS_TEST__.addDiveSite(-5.7, 131, id, { withFallbackPhoto:true });
    marker.openPopup();
  }, siteId);

  const sheet = page.locator('.leaflet-popup.diveatlas-mobile-sheet.dive-site-popup').last();
  await expect(sheet).toBeVisible();
  await expect.poll(() => sheet.evaluate(element => getComputedStyle(element).viewTransitionName))
    .toBe('dive-site-surface');
  await expect.poll(() => sheet.locator('.bio-popup-title').evaluate(element => getComputedStyle(element).viewTransitionName))
    .toBe('dive-site-title');
  await expect.poll(() => sheet.locator('.dive-popup-photo-frame').evaluate(element => getComputedStyle(element).viewTransitionName))
    .toBe('dive-site-photo');

  await page.evaluate(() => {
    window.addEventListener('pageswap', event => {
      const surface = document.querySelector('.leaflet-popup.diveatlas-mobile-sheet.dive-site-popup');
      sessionStorage.setItem('diveatlas-map-page-swap', JSON.stringify({
        hasViewTransition: Boolean(event.viewTransition),
        transitionName:surface ? getComputedStyle(surface).viewTransitionName : '',
        dragOffset:surface?.style.getPropertyValue('--mobile-panel-drag-y') || '',
        dragging:surface?.classList.contains('mobile-vertical-dragging') || false
      }));
    }, { once:true });
    window.addEventListener('pagereveal', event => {
      const surface = document.querySelector('.leaflet-popup.diveatlas-mobile-sheet.dive-site-popup');
      sessionStorage.setItem('diveatlas-map-page-reveal', JSON.stringify({
        hasViewTransition: Boolean(event.viewTransition),
        transitionName:surface ? getComputedStyle(surface).viewTransitionName : '',
        dragOffset:surface?.style.getPropertyValue('--mobile-panel-drag-y') || '',
        dragging:surface?.classList.contains('mobile-vertical-dragging') || false
      }));
    }, { once:true });
    window.addEventListener('pageshow', event => {
      if (!event.persisted) return;
      const surface = document.querySelector('.leaflet-popup.diveatlas-mobile-sheet.dive-site-popup');
      sessionStorage.setItem('diveatlas-map-page-show', JSON.stringify({
        persisted:event.persisted,
        transitionName:surface ? getComputedStyle(surface).viewTransitionName : '',
        dragOffset:surface?.style.getPropertyValue('--mobile-panel-drag-y') || '',
        dragging:surface?.classList.contains('mobile-vertical-dragging') || false
      }));
    }, { once:true });
  });
  await sheet.locator('.diveatlas-mobile-sheet-handle').evaluate(handle => {
    handle.setPointerCapture = () => {};
    const bounds = handle.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    const dispatch = (type, clientY) => handle.dispatchEvent(new PointerEvent(type, {
      bubbles:true,
      cancelable:true,
      pointerId:31,
      pointerType:'touch',
      isPrimary:true,
      button:0,
      buttons:type === 'pointerup' ? 0 : 1,
      clientX:x,
      clientY
    }));
    dispatch('pointerdown', y);
    dispatch('pointermove', y - 144);
    dispatch('pointermove', y - 124);
    const popup = handle.closest('.leaflet-popup');
    const rect = popup.getBoundingClientRect();
    const glass = getComputedStyle(popup, '::after');
    sessionStorage.setItem('diveatlas-roundtrip-pull', JSON.stringify({
      bottom:rect.bottom, viewport:innerHeight, glassTop:glass.top,
      glassBottom:glass.bottom, blur:glass.backdropFilter,
      hintHidden:popup.querySelector('.mobile-sheet-pull-hint').hidden
    }));
    dispatch('pointerup', y - 124);
  });

  await page.waitForURL(url => url.pathname.endsWith('/dive-site.html'));
  await expect(page.locator('#site-title')).toHaveText('Punta Garbí');
  await expect(page.locator('html')).toHaveAttribute('data-theme', expectedTheme);
  expect(new URL(await page.evaluate(() => document.referrer)).searchParams.get('site')).toBe(siteId);
  await expect.poll(() => page.locator('#detailPage').evaluate(element => getComputedStyle(element).viewTransitionName))
    .toBe('dive-site-surface');
  await expect.poll(() => page.locator('#site-title').evaluate(element => getComputedStyle(element).viewTransitionName))
    .toBe('dive-site-title');
  await expect.poll(() => page.locator('.site-photo-gallery-main').evaluate(element => getComputedStyle(element).viewTransitionName))
    .toBe('dive-site-photo');
  const mapPageSwap = await page.evaluate(() => JSON.parse(sessionStorage.getItem('diveatlas-map-page-swap')));
  expect(mapPageSwap).toMatchObject({ hasViewTransition:true, dragging:true });
  expect(mapPageSwap.dragOffset).not.toBe('');
  const pullState = await page.evaluate(() => JSON.parse(sessionStorage.getItem('diveatlas-roundtrip-pull')));
  expect(Math.abs(pullState.bottom - pullState.viewport)).toBeLessThanOrEqual(1);
  expect(pullState).toMatchObject({ glassTop:'0px', glassBottom:'0px', blur:'blur(8px) saturate(1.45)', hintHidden:false });

  // A short downward pull must expose a readable hint without navigating.
  await page.evaluate(() => {
    scrollTo(0, 0);
    const target = document.querySelector('#detailPage');
    const dispatch = (type, y) => {
      const touch = new Touch({ identifier:81, target, clientX:innerWidth / 2, clientY:y });
      target.dispatchEvent(new TouchEvent(type, { bubbles:true, cancelable:true,
        touches:type === 'touchend' ? [] : [touch], changedTouches:[touch] }));
    };
    dispatch('touchstart', 250);
    dispatch('touchmove', 310);
  });
  const hint = page.locator('.detail-pull-hint');
  await expect(hint).toBeVisible();
  expect(await hint.evaluate(node => node.getBoundingClientRect().top >= document.querySelector('.shared-site-header').getBoundingClientRect().bottom + 8)).toBe(true);
  await page.evaluate(() => {
    const target = document.querySelector('#detailPage');
    const touch = new Touch({ identifier:81, target, clientX:innerWidth / 2, clientY:310 });
    target.dispatchEvent(new TouchEvent('touchend', { bubbles:true, touches:[], changedTouches:[touch] }));
  });
  await expect(hint).toBeHidden();
  expect(new URL(page.url()).pathname).toBe('/dive-site.html');

  await page.evaluate(() => {
    window.addEventListener('pageswap', event => {
      const surface = document.querySelector('#detailPage');
      sessionStorage.setItem('diveatlas-detail-page-swap', JSON.stringify({
        hasViewTransition: Boolean(event.viewTransition),
        transitionName:surface ? getComputedStyle(surface).viewTransitionName : '',
        dragOffset:surface?.style.getPropertyValue('--detail-pull-y') || '',
        dragging:surface?.classList.contains('detail-pull-dragging') || false
      }));
    }, { once:true });
    const surface = document.querySelector('#detailPage');
    const x = Math.round(window.innerWidth / 2);
    const startY = 300;
    const target = surface;
    const makeTouch = clientY => new Touch({ identifier:32, target, clientX:x, clientY });
    const dispatch = (type, touch) => {
      const touches = type === 'touchend' ? [] : [touch];
      target.dispatchEvent(new TouchEvent(type, {
        bubbles:true, cancelable:true, touches, targetTouches:touches, changedTouches:[touch]
      }));
    };
    dispatch('touchstart', makeTouch(startY));
    dispatch('touchmove', makeTouch(startY + 144));
    dispatch('touchend', makeTouch(startY + 144));
  });

  await page.waitForURL(url => url.pathname === '/' && url.searchParams.has('site'));
  await expect(page.locator('html')).toHaveAttribute('data-theme', expectedTheme);
  const detailPageSwap = await page.evaluate(() => JSON.parse(sessionStorage.getItem('diveatlas-detail-page-swap')));
  expect(detailPageSwap).toMatchObject({ hasViewTransition:true, transitionName:'dive-site-surface', dragging:true });
  expect(detailPageSwap.dragOffset).not.toBe('');
  await expect(page.locator('.leaflet-popup.diveatlas-mobile-sheet.dive-site-popup')).toBeVisible();
  const returnedSheet = page.locator('.leaflet-popup.diveatlas-mobile-sheet.dive-site-popup');
  await expect(returnedSheet.locator('.mobile-sheet-pull-hint')).toBeHidden();
  await expect(page.locator('.detail-pull-hint')).toBeHidden();
  await expect(returnedSheet).not.toHaveClass(/mobile-sheet-entering|mobile-vertical-dragging/);
  await expect.poll(() => returnedSheet.evaluate(node => Math.abs(node.getBoundingClientRect().bottom - innerHeight))).toBeLessThanOrEqual(1);
  expect(await returnedSheet.evaluate(node => node.style.getPropertyValue('--mobile-panel-drag-y'))).toBe('');
  const mapPageReveal = await page.evaluate(() => JSON.parse(sessionStorage.getItem('diveatlas-map-page-reveal')));
  if (mapPageReveal?.transitionName === 'dive-site-surface') {
    expect(mapPageReveal).toMatchObject({ hasViewTransition:true, transitionName:'dive-site-surface', dragOffset:'', dragging:false });
  } else {
    const mapPageShow = await page.evaluate(() => JSON.parse(sessionStorage.getItem('diveatlas-map-page-show')));
    if (mapPageShow) {
      expect(mapPageShow).toMatchObject({ persisted:true, transitionName:'dive-site-surface', dragOffset:'', dragging:false });
    } else {
      const returnAnimation = await page.evaluate(() => JSON.parse(sessionStorage.getItem('diveatlas-map-return-animation')));
      expect(returnAnimation).not.toBeNull();
      expect(returnAnimation.translate).toBe('0px 100%');
    }
  }
});

test('mobile map sheets animate new types but not updates within one type', async ({ page }) => {
  await setMapView(page, -5.7, 131, 10);
  await page.evaluate(() => {
    const api = window.__DIVEATLAS_TEST__;
    api.addDiveSite(-5.7, 131, 'motion-site-one');
    api.addDiveSite(-5.7, 131.03, 'motion-site-two');
    api.addCoralPoint(-5.7, 131.06, 'motion-coral');
    window.__mapMotionEvents = [];
    api.map.on('popupopen', event => {
      const el = event.popup.getElement();
      window.__mapMotionEvents.push({type:event.popup._diveAtlasLayerKey, entering:el.classList.contains('mobile-sheet-entering')});
    });
  });
  await page.evaluate(() => window.__DIVEATLAS_TEST__.openFixturePopup('motion-site-one'));
  await expect.poll(() => page.evaluate(() => window.__mapMotionEvents.length)).toBe(1);
  expect((await page.evaluate(() => window.__mapMotionEvents))[0]).toMatchObject({type:'dive', entering:true});
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__DIVEATLAS_TEST__.openFixturePopup('motion-site-two'));
  await expect.poll(() => page.evaluate(() => window.__mapMotionEvents.length)).toBe(2);
  expect((await page.evaluate(() => window.__mapMotionEvents))[1]).toMatchObject({type:'dive', entering:false});
  const outgoing = await page.evaluate(() => {
    const old = window.__DIVEATLAS_TEST__.map._popup.getElement();
    window.__DIVEATLAS_TEST__.openFixturePopup('motion-coral');
    return {exiting:old.classList.contains('mobile-sheet-exiting'), connected:old.isConnected};
  });
  expect(outgoing).toEqual({exiting:true, connected:true});
  await expect.poll(() => page.evaluate(() => window.__mapMotionEvents.length)).toBe(3);
  expect((await page.evaluate(() => window.__mapMotionEvents))[2]).toMatchObject({type:'species', entering:true});
});

test('rapidly switching sheet types keeps the outgoing motion continuous and opens only the latest', async ({ page }) => {
  await setMapView(page, -5.7, 131, 10);
  await page.evaluate(() => {
    const api = window.__DIVEATLAS_TEST__;
    api.addDiveSite(-5.7, 131, 'rapid-site');
    api.addCoralPoint(-5.7, 131.03, 'rapid-coral');
    api.addFishPoint(-5.7, 131.06, 'rapid-fish');
    window.__rapidOpens = [];
    api.map.on('popupopen', e => window.__rapidOpens.push(e.popup._diveAtlasLayerKey));
    api.openFixturePopup('rapid-site');
  });
  const sheet = page.locator('.leaflet-popup.diveatlas-mobile-sheet').last();
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveClass(/mobile-sheet-entering/);
  const positions = await page.evaluate(async () => {
    const api = window.__DIVEATLAS_TEST__;
    const surface = api.map._popup.getElement();
    api.openFixturePopup('rapid-coral');
    await new Promise(resolve => setTimeout(resolve, 80));
    const before = surface.getBoundingClientRect().top;
    api.openFixturePopup('rapid-fish');
    const after = surface.getBoundingClientRect().top;
    return {before,after};
  });
  expect(positions.after).toBeGreaterThanOrEqual(positions.before - 1);
  await expect.poll(() => page.evaluate(() => window.__rapidOpens)).toEqual(['dive','fish']);
  await expect(page.locator('.leaflet-popup.diveatlas-mobile-sheet').last()).toBeVisible();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__rapidOpens)).toEqual(['dive','fish']);
});

test('switching back to the current map sheet cancels a pending replacement', async ({ page }) => {
  await setMapView(page, -5.7, 131, 10);
  await page.evaluate(() => {
    const api = window.__DIVEATLAS_TEST__;
    api.addDiveSite(-5.7, 131, 'return-site');
    api.addCoralPoint(-5.7, 131.03, 'return-coral');
    window.__returnSheetOpens = [];
    api.map.on('popupopen', e => window.__returnSheetOpens.push(e.popup._diveAtlasLayerKey));
    api.openFixturePopup('return-site');
  });
  const sheet = page.locator('.leaflet-popup.diveatlas-mobile-sheet').last();
  await expect(sheet).not.toHaveClass(/mobile-sheet-entering/);
  await page.evaluate(async () => {
    const api = window.__DIVEATLAS_TEST__;
    api.openFixturePopup('return-coral');
    await new Promise(resolve => setTimeout(resolve, 80));
    api.openFixturePopup('return-site');
  });
  await expect(sheet).not.toHaveClass(/mobile-sheet-exiting/);
  await page.waitForTimeout(400);
  await expect(sheet).toBeVisible();
  expect(await page.evaluate(() => window.__returnSheetOpens)).toEqual(['dive']);
});

test('a dismissed map sheet stays offscreen through Leaflet popup cleanup', async ({ page }) => {
  await page.evaluate(() => {
    const marker = window.__DIVEATLAS_TEST__.addDiveSite(-5.7, 131, 'mobile-sheet-dismiss');
    const popup = marker.getPopup();
    window.__mobileSheetCloseState = null;
    window.__DIVEATLAS_TEST__.map.on('popupclose', event => {
      if (event.popup !== popup) return;
      const element = popup.getElement();
      const bounds = element.getBoundingClientRect();
      window.__mobileSheetCloseState = {
        exiting:element.classList.contains('mobile-sheet-exiting'),
        top:bounds.top,
        viewportHeight:window.innerHeight
      };
    });
    marker.openPopup();
  });

  const sheet = page.locator('.leaflet-popup.diveatlas-mobile-sheet').last();
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveClass(/mobile-sheet-entering/);
  const handle = sheet.locator('.diveatlas-mobile-sheet-handle');
  await sheet.evaluate(element => {
    window.__sheetGestureEntries = 0;
    new MutationObserver(() => {
      if (element.classList.contains('mobile-sheet-entering')) window.__sheetGestureEntries++;
    }).observe(element, {attributes:true, attributeFilter:['class']});
  });
  await handle.evaluate(element => {
    element.setPointerCapture = () => {};
    const bounds = element.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const startY = bounds.top + bounds.height / 2;
    const dispatch = (type, clientY) => element.dispatchEvent(new PointerEvent(type, {
      bubbles:true,
      cancelable:true,
      pointerId:17,
      pointerType:'touch',
      isPrimary:true,
      button:0,
      buttons:type === 'pointerup' ? 0 : 1,
      clientX:x,
      clientY
    }));
    dispatch('pointerdown', startY);
    dispatch('pointermove', startY + 144);
    dispatch('pointerup', startY + 144);
  });

  await expect.poll(() => page.evaluate(() => window.__mobileSheetCloseState)).not.toBeNull();
  const closeState = await page.evaluate(() => window.__mobileSheetCloseState);
  expect(await page.evaluate(() => window.__sheetGestureEntries)).toBe(0);
  expect(closeState.exiting).toBe(true);
  expect(closeState.top).toBeGreaterThanOrEqual(closeState.viewportHeight - 1);
});

test('mobile sheet content drag follows the finger and snaps back below dismissal threshold', async ({ page }) => {
  await addFixture(page, 'dive-site', { id:'content-pull-snapback', lat:-5.7, lng:131 });
  await clickFixture(page, 'content-pull-snapback');
  const sheet = page.locator('.leaflet-popup.diveatlas-mobile-sheet').last();
  await expect(sheet).toBeVisible();

  const gesture = await dispatchSheetContentTouchGesture(page, {
    startY:300,
    moveYs:[336],
    endY:336
  });

  expect(gesture.moves).toEqual([{ dragging:true, offset:'36px', defaultPrevented:true }]);
  expect(gesture.dragging).toBe(false);
  expect(gesture.offset).toBe('');
  await expect(sheet).toBeVisible();
});

test('mobile sheet content pull dismisses after the close threshold', async ({ page }) => {
  await addFixture(page, 'dive-site', { id:'content-pull-dismiss', lat:-5.7, lng:131 });
  await clickFixture(page, 'content-pull-dismiss');
  const sheet = page.locator('.leaflet-popup.diveatlas-mobile-sheet').last();
  await expect(sheet).toBeVisible();

  const gesture = await dispatchSheetContentTouchGesture(page, {
    startY:300,
    moveYs:[390],
    endY:390
  });

  expect(gesture.moves[0]).toMatchObject({ dragging:true, offset:'90px', defaultPrevented:true });
  await expect(page.locator('.leaflet-popup.diveatlas-mobile-sheet, .leaflet-popup.dive-conditions-rating-sheet')).toHaveCount(0);
});

test('mobile sheet content drag starts only after scrolling reaches the top', async ({ page }) => {
  await addFixture(page, 'dive-site', { id:'content-pull-after-scroll', lat:-5.7, lng:131 });
  await clickFixture(page, 'content-pull-after-scroll');
  const sheet = page.locator('.leaflet-popup.diveatlas-mobile-sheet').last();
  await expect(sheet).toBeVisible();
  await sheet.locator('.leaflet-popup-content').evaluate(content => {
    const filler = document.createElement('div');
    filler.style.height = '500px';
    content.append(filler);
  });

  const gesture = await dispatchSheetContentTouchGesture(page, {
    startY:300,
    moveYs:[330,360],
    endY:360,
    initialScrollTop:80,
    scrollTopChanges:[{ moveIndex:1, value:0 }]
  });

  expect(gesture.moves[0]).toMatchObject({ dragging:false, offset:'' });
  expect(gesture.moves[1]).toMatchObject({ dragging:true, offset:'30px', defaultPrevented:true });
  expect(gesture.dragging).toBe(false);
  await expect(sheet).toBeVisible();
});

test('mobile layer rows toggle across the row and the collapsed bar shrinks after idle', async ({ page }) => {
  const panel = page.locator('#bioLegend');
  const title = page.locator('#bioLegendTitle');
  const terrain = page.locator('#terrainLayerToggle');
  const label = page.locator('#terrainLegendLabel');

  await expect(panel).toHaveClass(/is-collapsed/);
  await expect(panel).not.toHaveClass(/is-mobile-auto-collapsed/);
  await title.click();
  await expect(panel).not.toHaveClass(/is-collapsed/);
  const layerScrollStyle = await page.locator('#bioLegendLayers').evaluate(node => ({
    overflowY: getComputedStyle(node).overflowY,
    scrollbarWidth: getComputedStyle(node).scrollbarWidth
  }));
  expect(layerScrollStyle.overflowY).toBe('auto');
  expect(layerScrollStyle.scrollbarWidth).toBe('none');
  expect(await label.evaluate(node => getComputedStyle(node).fontSize)).toBe('18px');
  await page.waitForTimeout(6_200);
  await expect(panel).not.toHaveClass(/is-collapsed/);

  const terrainWasChecked = await terrain.isChecked();
  await label.click();
  await expect(terrain).toHaveJSProperty('checked', !terrainWasChecked);
  await label.click();
  await expect(terrain).toHaveJSProperty('checked', terrainWasChecked);

  const expandedPosition = await panel.evaluate(node => {
    const { x, y } = node.getBoundingClientRect();
    return { x, y };
  });
  await title.click();
  await expect(panel).toHaveClass(/is-collapsed/);
  await expect(panel).not.toHaveClass(/is-mobile-auto-collapsed/);
  const collapsedPosition = await panel.evaluate(node => {
    const { x, y } = node.getBoundingClientRect();
    return { x, y };
  });
  expect(Math.abs(collapsedPosition.x - expandedPosition.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(collapsedPosition.y - expandedPosition.y)).toBeLessThanOrEqual(1);

  await expect(panel).toHaveClass(/is-mobile-auto-collapsed/, { timeout: 8_000 });
  const compactSize = await panel.evaluate(node => {
    const box = node.getBoundingClientRect();
    return { width: box.width, height: box.height, radius: getComputedStyle(node).borderRadius };
  });
  expect(compactSize.width).toBe(48);
  expect(compactSize.height).toBe(48);
  expect(compactSize.radius).toBe('50%');

  // The circle restores the compact bar; a second tap opens the full panel.
  await title.click();
  await expect(panel).toHaveClass(/is-collapsed/);
  await expect(panel).not.toHaveClass(/is-mobile-auto-collapsed/);
  await expect(page.locator('#bioLegendLayers')).toBeHidden();
  expect(await panel.evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThan(48);

  await title.click();
  await expect(panel).not.toHaveClass(/is-collapsed/);
  await expect(panel).not.toHaveClass(/is-mobile-auto-collapsed/);
  await expect(panel).toHaveClass(/mobile-layers-panel-expanding/);
  await expect(page.locator('#bioLegendDragHandle')).toBeHidden();
  const expandingContents = await page.locator('#bioLegendLayers').evaluate(node => ({
    transition: getComputedStyle(node).transitionProperty,
    opacity: getComputedStyle(node).opacity
  }));
  expect(expandingContents.transition).toBe('none');
  expect(expandingContents.opacity).toBe('1');
  await expect.poll(() => panel.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThan(48);
  await expect(panel).not.toHaveClass(/mobile-layers-panel-expanding/);
  await expect(page.locator('#bioLegendDragHandle')).toBeVisible();
  await expect(page.locator('#bioLegendLayers')).toBeVisible();
  await page.setViewportSize({ width: 900, height: 900 });
  const desktopTerrainState = await terrain.isChecked();
  await label.click();
  await expect(terrain).toHaveJSProperty('checked', desktopTerrainState);
});

test('expanding the full mobile layer panel closes any open map sheet', async ({ page }) => {
  await setMapView(page, -5.7, 131, 14);
  await addFixture(page, 'dive-site', { id:'sheet-before-layers-panel', lat:-5.7, lng:131 });
  await clickFixture(page, 'sheet-before-layers-panel');
  await expect(page.locator('.leaflet-popup.diveatlas-mobile-sheet')).toBeVisible();

  await page.locator('#bioLegendTitle').click();

  await expect(page.locator('#bioLegend')).not.toHaveClass(/is-collapsed/);
  await expect(page.locator('.leaflet-popup.diveatlas-mobile-sheet, .leaflet-popup.dive-conditions-rating-sheet')).toHaveCount(0);
});

test('opening mobile search closes an open map sheet', async ({ page }) => {
  await setMapView(page, -5.7, 131, 14);
  await addFixture(page, 'dive-site', { id:'sheet-before-search', lat:-5.7, lng:131 });
  await clickFixture(page, 'sheet-before-search');

  const sheet = page.locator('.leaflet-popup.diveatlas-mobile-sheet, .leaflet-popup.dive-conditions-rating-sheet');
  await expect(sheet).toBeVisible();
  await page.locator('#diveSearchToggle').click();
  await expect(page.locator('#diveSearchResults')).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await page.locator('#diveSearchInput').fill('Tapor Tamiyam');
  await expect(page.locator('.dive-search-result').first()).toBeVisible();
});

test('showing the combined mobile search and filter menu closes any open map sheet', async ({ page }) => {
  await setMapView(page, -5.7, 131, 14);
  await addFixture(page, 'dive-site', { id:'sheet-before-search-filters', lat:-5.7, lng:131 });
  await clickFixture(page, 'sheet-before-search-filters');

  const sheet = page.locator('.leaflet-popup.diveatlas-mobile-sheet, .leaflet-popup.dive-conditions-rating-sheet');
  await expect(sheet).toBeVisible();
  await page.locator('#diveSearchToggle').click();
  await page.locator('#diveSearchFilterToggle').click();

  await expect(page.locator('#diveSearchResults')).toHaveClass(/visible/);
  await expect(page.locator('#diveSearchFilterControls')).toBeVisible();
  await expect(sheet).toHaveCount(0);
});

test('Waves remains reachable on mobile, fits the panel, and follows the map theme', async ({ page }) => {
  if (await page.locator('#bioLegend').evaluate(node => node.classList.contains('is-collapsed'))) {
    await page.locator('#bioLegendTitle').click();
  }
  await page.locator('.environment-segment-group').evaluate(track => { track.scrollLeft = track.scrollWidth; });
  await page.locator('.environment-segment').filter({ has: page.locator('input[name="environmentView"][value="waves"]') }).click();
  await expect(page.locator('#wavesControls')).toBeVisible();
  await expect(page.locator('#wavesStatus')).toHaveAttribute('data-state', 'ready');
  const light = await page.evaluate(() => {
    const panel = document.querySelector('#bioLegend').getBoundingClientRect();
    const track = document.querySelector('.environment-segment-group');
    const tileLayer = document.querySelector('.waves-tiles');
    return {
      panelWidth: panel.width,
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: track.scrollWidth,
      visibleWidth: track.clientWidth,
      selectedWaves: document.querySelector('input[name="environmentView"][value="waves"]').checked,
      mapFilter: getComputedStyle(tileLayer).filter,
      mapOpacity: getComputedStyle(tileLayer).opacity
    };
  });
  expect(light.panelWidth).toBeLessThanOrEqual(light.viewportWidth - 16);
  expect(light.scrollWidth).toBeGreaterThan(light.visibleWidth);
  expect(light.selectedWaves).toBe(true);

  await page.locator('html').evaluate(node => { node.dataset.theme = 'dark'; });
  const dark = await page.locator('.waves-tiles').evaluate(node => ({
    mapFilter: getComputedStyle(node).filter,
    mapOpacity: getComputedStyle(node).opacity
  }));
  expect(dark.mapFilter).not.toBe(light.mapFilter);
  expect(dark.mapOpacity).not.toBe(light.mapOpacity);

  await page.locator('.environment-segment').filter({ has: page.locator('input[name="environmentView"][value="default"]') }).click();
  await expect(page.locator('.waves-tiles')).toHaveCount(0);
  await expect(page.locator('#wavesControls')).toBeHidden();
});

async function mapCenterScreenPoint(page) {
  const bounds = await page.locator('#map').boundingBox();
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

async function dispatchTouchSequence(page, { duration = 100, moveBy = null, secondPointer = false } = {}) {
  const point = await mapCenterScreenPoint(page);
  await page.evaluate(async ({ x, y, duration, moveBy, secondPointer }) => {
    const target = document.getElementById('map');
    const dispatch = (type, pointerId, clientX, clientY) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'touch',
      isPrimary: pointerId === 1,
      clientX,
      clientY,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1
    }));

    dispatch('pointerdown', 1, x, y);
    if (secondPointer) dispatch('pointerdown', 2, x + 30, y);
    if (moveBy) dispatch('pointermove', 1, x + moveBy.x, y + moveBy.y);
    await new Promise(resolve => setTimeout(resolve, duration));
    dispatch('pointerup', 1, x + (moveBy?.x || 0), y + (moveBy?.y || 0));
    if (secondPointer) dispatch('pointerup', 2, x + 30, y);
  }, { ...point, duration, moveBy, secondPointer });
}

test('mobile aggregate Coral tap zooms once and does not open details', async ({ page }) => {
  await addFixture(page, 'aggregate', { id: 'mobile-coral-aggregate', lat: -5.7, lng: 131, count: 7 });
  await resetActionCount(page);
  const before = await mapState(page);
  const map = await page.locator('#map').boundingBox();
  await page.touchscreen.tap(map.x + map.width / 2, map.y + map.height / 2);
  await expect.poll(async () => (await mapState(page)).zoom).toBeGreaterThan(before.zoom);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  expect(await page.evaluate(() => window.__DIVEATLAS_TEST__.getActionCount())).toBe(1);
});

test('mobile short tap on empty ocean does not open Depth Inspection', async ({ page }) => {
  const map = await page.locator('#map').boundingBox();
  await page.touchscreen.tap(map.x + map.width * 0.58, map.y + map.height * 0.5);
  await waitForClickResolution(page);
  // The neutral startup map must not turn a short tap into a depth inspection.
  expect((await mapState(page)).popup?.type).not.toBe('depth');
});

test('mobile location feedback stays wide and centers its selected point after a failed lookup', async ({ page }) => {
  await page.route('**/js/tides/runtime.js*', route => route.abort());
  await page.locator('#bioLegendTitle').click();
  const tideSegment = page.locator('.environment-segment').filter({
    has: page.locator('input[name="environmentView"][value="tide"]')
  });
  await tideSegment.scrollIntoViewIfNeeded();
  await tideSegment.click();
  await expect(page.locator('input[name="environmentView"][value="tide"]')).toBeChecked();

  await page.evaluate(() => {
    const map = window.__DIVEATLAS_TEST__.map;
    const latlng = window.L.latLng(-5.7, 131);
    map.fire('click', { latlng, containerPoint: map.latLngToContainerPoint(latlng) });
  });

  const marker = page.locator('.map-click-location-marker');
  const tooltip = page.locator('.leaflet-tooltip.map-click-location-status-tooltip');
  await expect(marker).toBeVisible();
  await expect(tooltip).toContainText('Data could not be loaded for this location.');
  await expect(tooltip).toBeVisible();
  await waitForSelectedMapPointToSettle(page);

  const geometry = await page.evaluate(() => {
    const marker = document.querySelector('.map-click-location-marker');
    const tooltip = document.querySelector('.leaflet-tooltip.map-click-location-status-tooltip');
    const map = document.querySelector('#map');
    const header = document.querySelector('#topMenuBar');
    const markerBounds = marker.getBoundingClientRect();
    const tooltipBounds = tooltip.getBoundingClientRect();
    const mapBounds = map.getBoundingClientRect();
    const rootStyle = getComputedStyle(document.documentElement);
    const safeAreaTop = parseFloat(rootStyle.getPropertyValue('--map-safe-area-top')) || 0;
    const safeAreaBottom = parseFloat(rootStyle.getPropertyValue('--map-safe-area-bottom')) || 0;
    const visualViewport = window.visualViewport;
    const visualTop = visualViewport?.offsetTop || 0;
    const visualBottom = visualViewport ? visualTop + visualViewport.height : window.innerHeight;
    const safeMargin = 14;
    const safeTop = Math.max(
      mapBounds.top + safeMargin,
      header.getBoundingClientRect().bottom + safeMargin,
      visualTop + safeAreaTop + safeMargin
    );
    const safeBottom = Math.min(mapBounds.bottom - safeMargin, visualBottom - safeAreaBottom - safeMargin);
    return {
      markerCenterX: markerBounds.left + markerBounds.width / 2,
      markerAnchorY: markerBounds.bottom,
      mapCenterX: mapBounds.left + mapBounds.width / 2,
      visibleCenterY: (safeTop + safeBottom) / 2,
      tooltipWidth: tooltipBounds.width,
      viewportWidth: document.documentElement.clientWidth
    };
  });
  expect(Math.abs(geometry.markerCenterX - geometry.mapCenterX)).toBeLessThan(6);
  expect(Math.abs(geometry.markerAnchorY - geometry.visibleCenterY)).toBeLessThan(6);
  expect(geometry.tooltipWidth).toBeGreaterThanOrEqual(220);
  expect(geometry.tooltipWidth).toBeLessThanOrEqual(geometry.viewportWidth - 32);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
});

test('mobile long press on empty ocean opens Depth Inspection', async ({ page }) => {
  // Use the neutral terrain view so this hold exercises the empty-map
  // Depth Inspection fallback.
  if (await page.locator('#bioLegend').evaluate(node => node.classList.contains('is-collapsed'))) {
    await page.locator('#bioLegendTitle').click();
  }
  const terrainSegment = page.locator('.environment-segment').filter({ has: page.locator('input[name="environmentView"][value="default"]') });
  await terrainSegment.scrollIntoViewIfNeeded();
  await terrainSegment.click();
  await expect(page.locator('input[name="environmentView"][value="default"]')).toBeChecked();
  await page.route('**/data/depth_samples/**', route => route.fulfill({
    status: 200,
    contentType: 'application/octet-stream',
    body: depthSampleFixture
  }));
  await waitForMapInteractionWindow(page);
  await dispatchTouchSequence(page, { duration: 900 });
  await expect(page.locator('.leaflet-popup')).toBeVisible({ timeout: 5000 });
  expect((await mapState(page)).popup.type).toBe('depth');
});

test('resizing any mobile sheet recenters the pointer in the exposed map', async ({ page }) => {
  if (await page.locator('#bioLegend').evaluate(node => node.classList.contains('is-collapsed'))) {
    await page.locator('#bioLegendTitle').click();
  }
  await page.locator('.environment-segment').filter({
    has:page.locator('input[name="environmentView"][value="default"]')
  }).click();
  await expect(page.locator('input[name="environmentView"][value="default"]')).toBeChecked();
  await page.route('**/data/depth_samples/**', route => route.fulfill({
    status:200,
    contentType:'application/octet-stream',
    body:depthSampleFixture
  }));
  await waitForMapInteractionWindow(page);
  await dispatchTouchSequence(page, { duration:720 });
  const sheet = page.locator('.leaflet-popup.diveatlas-mobile-sheet');
  await expect(sheet).toBeVisible();
  expect((await mapState(page)).popup.type).toBe('depth');
  await waitForMobileMapSheetGeometryToSettle(page);
  const initialHeight = await sheet.evaluate(node => node.getBoundingClientRect().height);

  await sheet.locator('.leaflet-popup-content').evaluate(content => {
    const addedContent = document.createElement('div');
    addedContent.dataset.testSheetExpansion = 'true';
    addedContent.style.height = '360px';
    content.append(addedContent);
  });
  await expect.poll(() => sheet.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThan(initialHeight + 100);
  await waitForMobileMapSheetGeometryToSettle(page);
  await expectPointerCenteredInExposedMap(page);

  await sheet.locator('[data-test-sheet-expansion]').evaluate(node => node.remove());
  await expect.poll(() => sheet.evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(initialHeight + 100);
  await waitForMobileMapSheetGeometryToSettle(page);
  await expectPointerCenteredInExposedMap(page);
});

test('touch drag cancels long press and does not open a popup', async ({ page }) => {
  await dispatchTouchSequence(page, { duration: 720, moveBy: { x: 34, y: 3 } });
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
});

test('multi-touch gesture cancels long press and does not open a popup', async ({ page }) => {
  await dispatchTouchSequence(page, { duration: 720, secondPointer: true });
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
});

test('a single touch on an individual Coral feature opens details once', async ({ page }) => {
  await setMapView(page, -5.7, 131, 14);
  await addFixture(page, 'coral-point', { id: 'mobile-coral-point', lat: -5.7, lng: 131 });
  await resetActionCount(page);
  const map = await page.locator('#map').boundingBox();
  await page.touchscreen.tap(map.x + map.width / 2, map.y + map.height / 2);
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  expect((await mapState(page)).popup.type).toBe('species');
  expect(await page.evaluate(() => window.__DIVEATLAS_TEST__.getActionCount())).toBe(1);
});

test('zooming the map in either direction keeps an open mobile detail sheet visible', async ({ page }) => {
  await setMapView(page, -5.7, 131, 14);
  await addFixture(page, 'dive-site', { id:'sheet-survives-zoom', lat:-5.7, lng:131 });
  await clickFixture(page, 'sheet-survives-zoom');
  const sheet = page.locator('.leaflet-popup.diveatlas-mobile-sheet');
  await expect(sheet).toBeVisible();
  const initialZoom = await page.evaluate(() => window.__DIVEATLAS_TEST__.map.getZoom());

  for (const expectedZoom of [initialZoom + 1, initialZoom]) {
    await page.evaluate(zoom => window.__DIVEATLAS_TEST__.map.setZoom(zoom, { animate:false }), expectedZoom);
    await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.map.getZoom())).toBe(expectedZoom);
    await expect(sheet).toBeVisible();
    await expect.poll(async () => (await mapState(page)).popup?.owner).toContain('sheet-survives-zoom');
  }
});

test('WeChat receives a plain-text URL through the mobile share picker', async ({ page }) => {
  await page.locator('#languageMenuButton').click();
  await page.locator('#languageDropdown [data-language="zh"]').click();
  await page.evaluate(() => {
    window.__sharePayloads = [];
    window.__copiedShareUrl = null;
    Object.defineProperty(navigator, 'share', {
      configurable:true,
      value:payload => {
        window.__sharePayloads.push(payload);
        return Promise.resolve();
      }
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable:true,
      value:{ writeText:async text => { window.__copiedShareUrl = text; } }
    });
  });
  await page.evaluate(() => document.querySelector('#shareMapButton').click());
  await expect(page.locator('#sharePreviewCopyButton')).toHaveCSS('display', 'none');
  await expect(page.locator('#shareCopyButton')).toBeVisible();
  const wechat = page.locator('#shareWechatButton');
  await expect(wechat).toBeVisible();
  await wechat.click();

  const payloads = await page.evaluate(() => window.__sharePayloads);
  expect(payloads).toHaveLength(1);
  expect(Object.keys(payloads[0])).toEqual(['text']);
  expect(payloads[0].text).toBe(await page.evaluate(() => window.__copiedShareUrl));
  expect(payloads[0].text).toMatch(/^https?:\/\//);
});

test('RedNote copies the share URL and opens its message center on mobile', async ({ page }) => {
  await page.locator('#languageMenuButton').click();
  await page.locator('#languageDropdown [data-language="zh"]').click();
  await page.evaluate(() => {
    window.__copiedShareUrl = null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable:true,
      value:{ writeText:async text => { window.__copiedShareUrl = text; } }
    });
    // Keep the local browser in place while the click handler's app handoff runs.
    document.addEventListener('click', event => {
      if (event.target.closest('#shareRedNoteButton')) event.preventDefault();
    }, true);
  });
  await page.evaluate(() => document.querySelector('#shareMapButton').click());
  const redNote = page.locator('#shareRedNoteButton');
  await expect(redNote).toBeVisible();
  await redNote.click();

  await expect.poll(() => page.evaluate(() => window.__copiedShareUrl)).toMatch(/^https?:\/\//);
  await expect(redNote).toHaveAttribute('href', 'xhsdiscover://message/center');
  await expect(redNote).toHaveAttribute('target', '_self');
});

for (const { language, primary, secondary } of [
  { language:'zh', primary:'wechat', secondary:'rednote' },
  { language:'ru', primary:'telegram', secondary:'facebook' },
  { language:'ko', primary:'instagram', secondary:'whatsapp' }
]) {
  test(`mobile map sheet share discovery shows localized primary and secondary icons for ${language}`, async ({ page }) => {
    await page.setViewportSize({ width:390, height:844 });
    await page.locator('#languageMenuButton').click();
    await page.locator(`#languageDropdown [data-language="${language}"]`).click();
    await setMapView(page, -5.7, 131, 14);
    await addFixture(page, 'dive-site', { id:`share-discovery-${language}`, lat:-5.7, lng:131 });

    await clickFixture(page, `share-discovery-${language}`);
    const popup = page.locator('.leaflet-popup.dive-site-popup');
    await expect(popup).toBeVisible();
    const shareButton = popup.locator('.diveatlas-sheet-share-button');
    await expect(shareButton).toBeVisible();
    const buttonSize = await shareButton.evaluate(button => {
      const style = getComputedStyle(button);
      return { width:parseFloat(style.width), height:parseFloat(style.height) };
    });
    expect(buttonSize.width).toBeCloseTo(44, 1);
    expect(buttonSize.height).toBeCloseTo(44, 1);
    const discoveryIcon = shareButton.locator('.share-discovery-mark');
    await expect(discoveryIcon).toBeVisible();
    await expect(discoveryIcon).toHaveClass(new RegExp(`share-action-icon--${primary}`));
    await expect(shareButton).toHaveClass(/is-share-discovery-active/);

    const iconSize = await discoveryIcon.evaluate(icon => {
      const style = getComputedStyle(icon);
      return { width:parseFloat(style.width), height:parseFloat(style.height) };
    });
    expect(iconSize.width).toBeCloseTo(31.2, 1);
    expect(iconSize.height).toBeCloseTo(31.2, 1);

    await page.evaluate(() => window.__DIVEATLAS_TEST__.map.closePopup());
    await expect(popup).toHaveCount(0);
    await page.waitForTimeout(250);
    await clickFixture(page, `share-discovery-${language}`);
    const nextShareButton = page.locator('.leaflet-popup.dive-site-popup .diveatlas-sheet-share-button');
    const nextDiscoveryIcon = nextShareButton.locator('.share-discovery-mark');
    await expect(nextDiscoveryIcon).toBeVisible();
    await expect(nextDiscoveryIcon).toHaveClass(new RegExp(`share-action-icon--${secondary}`));
    await expect(nextShareButton).toHaveClass(/is-share-discovery-active/);
  });
}

test('mobile search animates on open and close but not result updates', async ({ page }) => {
  const sheet = page.locator('#diveSearchResults');
  await sheet.evaluate(el => {
    window.__searchSheetMotion = [];
    new MutationObserver(() => {
      if (el.classList.contains('mobile-sheet-entering')) window.__searchSheetMotion.push('enter');
      if (el.classList.contains('mobile-sheet-exiting')) window.__searchSheetMotion.push('exit');
    }).observe(el, {attributes:true, attributeFilter:['class']});
  });
  await page.locator('#diveSearchToggle').click();
  await expect(sheet).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__searchSheetMotion.includes('enter'))).toBe(true);
  await page.waitForTimeout(350);
  await page.evaluate(() => { window.__searchSheetMotion = []; });
  await page.locator('#diveSearchInput').fill('Raja');
  await expect(sheet.locator('[data-result-kind="destination"]').first()).toBeVisible({timeout:15000});
  expect(await page.evaluate(() => window.__searchSheetMotion.includes('enter'))).toBe(false);
  await page.locator('#diveSearchToggle').click();
  await expect.poll(() => page.evaluate(() => window.__searchSheetMotion.includes('exit'))).toBe(true);
  await expect(sheet).toBeHidden();
});

test('mobile search cancels a pending close when reopened immediately', async ({ page }) => {
  const trigger = page.locator('#diveSearchToggle');
  const sheet = page.locator('#diveSearchResults');
  await trigger.click();
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(350);
  await trigger.evaluate(el => { el.click(); el.click(); });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(400);
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveClass(/mobile-sheet-exiting/);
});

test('mobile search respects reduced motion on open and close', async ({ page }) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  const sheet = page.locator('#diveSearchResults');
  await page.locator('#diveSearchToggle').click();
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveClass(/mobile-sheet-entering/);
  await page.locator('#diveSearchToggle').click();
  await expect(sheet).toBeHidden();
});

test('mobile map search expands its full-width sheet and preserves destination selection', async ({ page }) => {
  await page.locator('#diveSearchToggle').click();
  const sheet = page.locator('#diveSearchResults');
  await expect(sheet.locator('#diveSearchInput')).toBeVisible();
  await expect(sheet.locator('#diveSearchFilterToggle')).toBeVisible();
  const listHeight = (await sheet.locator('#diveSearchResultsScroll').boundingBox()).height;
  await page.locator('#diveSearchFilterToggle').click();
  const inputBox = await sheet.locator('.dive-search-sheet-input').boundingBox();
  const filterBox = await sheet.locator('#diveSearchFilterToggle').boundingBox();
  const topGap = filterBox.y - inputBox.y;
  expect(inputBox.x + inputBox.width - filterBox.x - filterBox.width).toBeCloseTo(topGap, 0);
  expect(inputBox.y + inputBox.height - filterBox.y - filterBox.height).toBeCloseTo(topGap, 0);
  const filters = sheet.locator('#diveSearchFilterControls');
  await expect(filters).toBeVisible();
  await expect(sheet.locator('#diveSearchResultsScroll')).toBeVisible();
  expect((await sheet.locator('#diveSearchResultsScroll').boundingBox()).height).toBeCloseTo(listHeight, 0);
  const material = await filters.evaluate(el => {
    const style = getComputedStyle(el);
    return {position:style.position, background:style.backgroundColor, backdrop:style.backdropFilter, reduced:matchMedia("(prefers-reduced-transparency: reduce)").matches};
  });
  expect(material.position).toBe('absolute');
  expect(material.background).not.toBe('rgba(0, 0, 0, 0)');
  if (material.reduced) expect(material.backdrop).toBe('none');
  else expect(material.backdrop).toContain('blur(12px)');
  await page.keyboard.press('Escape');
  await expect(filters).toBeHidden();
  await expect(sheet).toBeVisible();
  await page.locator('#diveSearchFilterToggle').click();
  await sheet.locator('#diveSearchResultsScroll').click({position:{x:10,y:10}});
  await expect(filters).toBeHidden();
  await expect(sheet.locator('#diveSearchResultsScroll')).toBeVisible();
  await page.locator('#diveSearchInput').fill('Raja Ampat');
  const first = sheet.locator('[role="option"]').first();
  await expect(first).toHaveAttribute('data-result-kind', 'destination', {timeout:15000});
  const initial = await sheet.boundingBox();
  expect(initial.width).toBeCloseTo(page.viewportSize().width, 0);
  const handle = page.locator('#diveSearchResultsHandle');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 100, {steps:8});
  await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (await sheet.boundingBox()).y).toBeLessThanOrEqual(1);
  const expanded = await handle.boundingBox();
  await page.mouse.move(expanded.x + expanded.width / 2, expanded.y + expanded.height / 2);
  await page.mouse.down();
  await page.mouse.move(expanded.x + expanded.width / 2, expanded.y + expanded.height / 2 + 100, {steps:8});
  await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => (await sheet.boundingBox()).y).toBeGreaterThan(50);
  await handle.focus();
  await page.keyboard.press('Enter');
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Enter');
  await expect(handle).toHaveAttribute('aria-expanded', 'false');
  await first.click();
  await expect(sheet).toBeHidden();
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  await page.locator('#diveSearchToggle').click();
  await page.locator('#diveSearchInput').fill('Raja Ampat');
  await expect(sheet).toBeVisible();
  await page.locator('#diveSearchInput').press('Escape');
  await expect(sheet).toBeHidden();
});


test('mobile search shows the swipe hint and loads the next page on an upward pull', async ({ page }) => {
  await page.locator('#diveSearchToggle').click();
  await page.locator('#diveSearchInput').fill('reef');
  const sheet = page.locator('#diveSearchResults');
  const hint = sheet.locator('#diveSearchLoadHint');
  await expect(hint).toBeVisible({timeout:15000});
  await expect(hint).toContainText(/Swipe up to load more|向上滑动以加载更多/);
  await expect(sheet.locator('[data-search-load-more]')).toBeHidden();
  const before = await sheet.locator('[role="option"]').count();
  const scroll = sheet.locator('#diveSearchResultsScroll');
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
  const box = await scroll.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height - 20;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x,y}]});
  for (let step = 1; step <= 6; step++) await cdp.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x,y:y - step * 20}]});
  await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
  await expect.poll(() => sheet.locator('[role="option"]').count()).toBeGreaterThan(before);
});

test('mobile search sheet tracks touch drags in both directions', async ({ page }) => {
  const launcher = page.locator('#diveSearchToggle');
  const launcherBox = page.locator('#diveSearchSection .dive-search-box');
  await expect(launcherBox).toHaveCSS('border-top-left-radius', '999px');
  await expect(launcherBox).toHaveCSS('border-top-width', '1px');
  const icon = launcher.locator('svg');
  const globe = page.locator('#languageMenuButton .language-globe-icon');
  expect((await icon.boundingBox()).width).toBeCloseTo((await globe.boundingBox()).width, 1);
  await expect(icon).toHaveCSS('stroke-width', '1.35px');
  expect((await launcher.boundingBox()).width).toBeGreaterThanOrEqual(38);
  await launcher.click();
  const handle = page.locator('#diveSearchResultsHandle');
  const sheet = page.locator('#diveSearchResults');
  const cdp = await page.context().newCDPSession(page);
  async function swipe(distance, fraction = 0.5) {
    const box = await handle.boundingBox();
    const x = box.x + box.width * fraction, y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x,y}]});
    for (let step = 1; step <= 5; step++) await cdp.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x,y:y + distance * step / 5}]});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
  }
  await swipe(-120, 0.05);
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (await sheet.boundingBox())?.y).toBeLessThanOrEqual(1);
  await swipe(120, 0.95);
  await expect(handle).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => (await sheet.boundingBox())?.y).toBeGreaterThan(200);
  await swipe(25);
  await expect(sheet).toBeVisible();
  await swipe(120);
  await expect(sheet).toBeHidden();
  await expect(page.locator('#diveSearchToggle')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#diveSearchToggle').click();
  await expect(sheet).toBeVisible();
  await swipe(-120);
  await expect.poll(async () => (await sheet.boundingBox())?.y).toBeLessThanOrEqual(1);
  await swipe(600);
  await expect(sheet).toBeHidden();
});

test('mobile floating filters retain picker selection after sheet expansion', async ({ page }) => {
  await page.locator('#diveSearchToggle').click();
  await page.locator('#diveSearchInput').fill('Raja Ampat');
  const sheet = page.locator('#diveSearchResults');
  await expect(sheet.locator('[data-result-kind="destination"]').first()).toBeVisible({timeout:15000});
  await page.locator('#diveSearchResultsHandle').focus();
  await page.keyboard.press('Enter');
  const filterToggle = page.locator('#diveSearchFilterToggle');
  await filterToggle.click();
  const searchBox = await page.locator('#diveSearchSheetInput').boundingBox();
  const filterBox = await filterToggle.boundingBox();
  expect(searchBox.x + searchBox.width - filterBox.x - filterBox.width).toBeGreaterThanOrEqual(1);
  expect(searchBox.x + searchBox.width - filterBox.x - filterBox.width).toBeLessThanOrEqual(4);
  await expect(filterToggle).toHaveCSS('border-top-right-radius', '11px');
  await expect(filterToggle).toHaveCSS('border-bottom-right-radius', '11px');
  const filters = page.locator('#diveSearchFilterControls');
  const box = await filters.boundingBox(), viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  const country = page.locator('#diveSearchCountryFilterPicker');
  await country.click();
  const options = page.locator('#diveSearchCountryFilterPickerOptions');
  await expect(options).toBeVisible();
  const indonesia = options.getByRole('option', {name:'Indonesia', exact:true});
  await indonesia.click();
  await expect(page.locator('#diveSearchCountryFilter')).toHaveValue('Indonesia');
  await expect(page.locator('#diveSearchFilterToggle')).toHaveClass(/has-active-filters/);
  await filterToggle.click();
  await expect(filters).toBeHidden();
  await page.locator('#diveSearchInput').click();
  await expect(filters).toBeHidden();
  await expect(page.locator('#diveSearchCountryFilter')).toHaveValue('Indonesia');
  await filterToggle.click();
  await expect(filters).toBeVisible();
  const clear = page.locator('#diveSearchFilterClear');
  await clear.scrollIntoViewIfNeeded();
  await expect(clear).toBeInViewport();
  await clear.click();
  await expect(page.locator('#diveSearchCountryFilter')).toHaveValue('');
});

test('floating search filter handle resists, rebounds and dismisses on an upward drag', async ({ page }) => {
  await page.locator('#diveSearchToggle').click();
  await page.locator('#diveSearchInput').fill('Raja Ampat');
  await expect(page.locator('#diveSearchResults [data-result-kind="destination"]').first()).toBeVisible({timeout:15000});
  await page.locator('#diveSearchFilterToggle').click();
  const filters = page.locator('#diveSearchFilterControls');
  const handle = page.locator('#diveSearchFilterHandle');
  await expect(handle).toBeVisible();
  await page.locator('#diveSearchCountryFilterPicker').click();
  await page.locator('#diveSearchCountryFilterPickerOptions').getByRole('option', {name:'Indonesia', exact:true}).click();
  await expect(page.locator('#diveSearchCountryFilter')).toHaveValue('Indonesia');
  const clearBox = await page.locator('#diveSearchFilterClear').boundingBox();
  const gripBox = await handle.boundingBox();
  expect(gripBox.height).toBe(44);
  expect(gripBox.y).toBeLessThan(clearBox.y + clearBox.height);
  expect(await page.evaluate(({x,y}) => document.elementFromPoint(x,y)?.closest('#diveSearchFilterClear')?.id, {x:clearBox.x + clearBox.width / 2,y:clearBox.y + clearBox.height / 2})).toBe('diveSearchFilterClear');
  const initial = (await filters.boundingBox()).height;
  const initialHandleY = (await handle.boundingBox()).y;
  expect(await handle.evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('0');
  const cdp = await page.context().newCDPSession(page);
  async function drag(distance, during) {
    const box = await handle.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x,y}]});
    for (let step = 1; step <= 5; step++) await cdp.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x,y:y + distance * step / 5}]});
    if (during) await during();
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
  }
  await drag(60, async () => {
    const stretched = (await filters.boundingBox()).height;
    expect(stretched).toBeGreaterThan(initial);
    expect(stretched).toBeLessThan(initial + 25);
    expect((await handle.boundingBox()).y).toBeGreaterThan(initialHandleY + 10);
  });
  await expect.poll(async () => (await handle.boundingBox()).y).toBeCloseTo(initialHandleY, 0);
  await expect.poll(async () => (await filters.boundingBox()).height).toBeCloseTo(initial, 0);
  await drag(-35, async () => {
    const material = await handle.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const parent = el.parentElement.getBoundingClientRect();
      const y = Math.min(rect.bottom - 3, parent.bottom - 3);
      return {background:getComputedStyle(el, "::after").backgroundColor, maskHeight:parseFloat(getComputedStyle(el, "::after").height), opacity:getComputedStyle(el, "::after").opacity, touchHeight:rect.height,
        left:document.elementFromPoint(parent.left + 8, y) === el,
        right:document.elementFromPoint(parent.right - 8, y) === el};
    });
    expect(material.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(material.maskHeight).toBe(18);
    expect(material.opacity).toBe('1');
    expect(material.touchHeight).toBe(44);
    expect(material.left).toBe(true);
    expect(material.right).toBe(true);
  });
  await expect(filters).toBeVisible();
  await expect.poll(async () => (await filters.boundingBox()).height).toBeCloseTo(initial, 0);
  await expect.poll(() => handle.evaluate(el => getComputedStyle(el, "::after").opacity)).toBe("0");
  await drag(-90);
  await expect(filters).toBeHidden();
  await expect(page.locator('#diveSearchResults')).toBeVisible();
  await page.locator('#diveSearchInput').click();
  await expect(filters).toBeHidden();
  await expect(page.locator('#diveSearchCountryFilter')).toHaveValue('Indonesia');
  await page.locator('#diveSearchFilterToggle').click();
  await expect(handle).toBeVisible();
  await handle.focus();
  await page.keyboard.press('Enter');
  await expect(filters).toBeHidden();
  await expect(page.locator('#diveSearchFilterToggle')).toBeFocused();
});

test('pulling down at the search list top moves and dismisses the sheet', async ({ page }) => {
  await page.locator('#diveSearchToggle').click();
  await page.locator('#diveSearchInput').fill('reef');
  const sheet = page.locator('#diveSearchResults');
  const list = page.locator('#diveSearchResultsScroll');
  const handle = page.locator('#diveSearchResultsHandle');
  await expect(list.locator('[role="option"]').first()).toBeVisible({timeout:15000});
  const cdp = await page.context().newCDPSession(page);
  async function pull(distance, during) {
    const box = await list.boundingBox();
    const x = box.x + box.width / 2, y = box.y + 35;
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x,y}]});
    for (let step=1;step<=6;step++) await cdp.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x,y:y + distance * step / 6}]});
    if (during) await during();
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
  }
  await list.evaluate(el => { el.scrollTop = 500; });
  const before = (await sheet.boundingBox()).height;
  await pull(50);
  expect((await sheet.boundingBox()).height).toBeCloseTo(before, 0);
  await list.evaluate(el => { el.scrollTop = 25; });
  await pull(140);
  await expect(sheet).toBeHidden();
  await page.locator('#diveSearchToggle').click();
  await expect(sheet).toBeVisible();
  await list.evaluate(el => { el.scrollTop = 0; });
  await pull(25, async () => expect((await sheet.boundingBox()).height).toBeLessThan(before - 10));
  await expect(sheet).toBeVisible();
  await expect.poll(async () => (await sheet.boundingBox()).height).toBeCloseTo(before, 0);
  await handle.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await sheet.boundingBox()).y).toBeLessThanOrEqual(1);
  await list.evaluate(el => { el.scrollTop = 0; });
  await pull(120);
  await expect(handle).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => (await sheet.boundingBox()).y).toBeGreaterThan(200);
  await list.evaluate(el => { el.scrollTop = 0; });
  await pull(120);
  await expect(sheet).toBeHidden();
  await page.locator('#diveSearchToggle').click();
  await expect(sheet).toBeVisible();
  await handle.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await sheet.boundingBox()).y).toBeLessThanOrEqual(1);
  await list.evaluate(el => { el.scrollTop = 25; });
  await pull(500);
  await expect(sheet).toBeHidden();
});

test('mobile destination return bar stays compact and returns to grouped results', async ({ page }) => {
  await page.locator('#diveSearchToggle').click();
  await page.locator('#diveSearchInput').fill('r');
  const sheet = page.locator('#diveSearchResults');
  const expand = sheet.locator('[data-result-kind="expand-destinations"]');
  await expect(expand).toBeVisible({timeout:15000});
  await expand.click();
  const back = sheet.locator('[data-result-kind="back-to-results"]');
  await expect(back).toBeVisible();
  const rect = await back.boundingBox();
  expect(rect.height).toBeGreaterThanOrEqual(44);
  expect(rect.height).toBeLessThanOrEqual(52);
  const scroll = sheet.locator('#diveSearchResultsScroll');
  const scrollRect = await scroll.boundingBox();
  const sheetRect = await sheet.boundingBox();
  expect(Math.abs(rect.x - sheetRect.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(sheetRect.x + sheetRect.width - rect.x - rect.width)).toBeLessThanOrEqual(2);
  expect(rect.y + rect.height).toBeCloseTo(scrollRect.y, 0);
  expect(await back.evaluate(el => el.parentElement.id)).toBe('diveSearchResults');
  expect(await scroll.getAttribute('aria-owns')).toBe(await back.getAttribute('id'));
  expect(await scroll.evaluate(el => getComputedStyle(el).scrollbarWidth)).not.toBe('none');
  await scroll.evaluate(el => { el.scrollTop = 180; });
  expect((await back.boundingBox()).y).toBeCloseTo(rect.y, 0);
  await expect(back.locator('.dive-search-result-meta')).not.toBeEmpty();
  await back.click();
  await expect(expand).toBeVisible();
  await expect(expand).not.toHaveClass(/\bactive\b/);
  await expect(expand).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('#diveSearchInput')).not.toHaveAttribute('aria-activedescendant', /.+/);
});

test('mobile destination list stays open when search filters change', async ({ page }) => {
  await page.locator('#diveSearchToggle').click();
  const input = page.locator('#diveSearchInput');
  await input.fill('r');
  const sheet = page.locator('#diveSearchResults');
  await sheet.locator('[data-result-kind="expand-destinations"]').click({timeout:15000});
  const back = sheet.locator('[data-result-kind="back-to-results"]');
  await expect(back).toBeVisible();
  await page.locator('#diveSearchFilterToggle').click();
  await page.locator('#diveSearchCountryFilterPicker').click();
  await page.locator('#diveSearchCountryFilterPickerOptions').getByRole('option', {name:'Indonesia', exact:true}).click();
  await expect(page.locator('#diveSearchCountryFilter')).toHaveValue('Indonesia');
  await expect(back).toBeVisible();
  await expect(sheet.locator('[data-result-kind="expand-destinations"]')).toHaveCount(0);
  await page.locator('#diveSearchFilterClear').click();
  await expect(page.locator('#diveSearchCountryFilter')).toHaveValue('');
  await expect(back).toBeVisible();
  await page.locator('#diveSearchFilterToggle').click();
  await back.click();
  await expect(sheet.locator('[data-result-kind="expand-destinations"]')).toBeVisible();
});

test('empty filtered destination list shows a message and can return to results', async ({ page }) => {
  await page.locator('#diveSearchToggle').click();
  await page.locator('#diveSearchInput').fill('china');
  const sheet = page.locator('#diveSearchResults');
  await sheet.locator('[data-result-kind="expand-destinations"]').click({timeout:15000});
  await page.locator('#diveSearchFilterToggle').click();
  const country = page.locator('#diveSearchCountryFilterPicker');
  await country.click();
  await page.locator('#diveSearchCountryFilterPickerOptions').getByRole('option', {name:'Indonesia', exact:true}).click();
  const back = sheet.locator('[data-result-kind="back-to-results"]');
  await expect(back).toBeVisible();
  await expect(back.locator('.dive-search-result-meta')).toContainText('0');
  await expect(sheet.locator('[data-result-kind="destination"]')).toHaveCount(0);
  await expect(sheet.locator('.dive-search-empty')).toBeVisible();
  await page.locator('#diveSearchFilterToggle').click();
  await back.click();
  await expect(back).toHaveCount(0);
  await expect(sheet.locator('[data-result-kind="site"]').first()).toBeVisible();
  await page.locator('#diveSearchFilterToggle').click();
  await expect(page.locator('#diveSearchCountryFilter')).toHaveValue('Indonesia');
});

test('mobile destination-only results load more by swiping at the end', async ({ page }) => {
  await page.locator('#diveSearchToggle').click();
  await page.locator('#diveSearchInput').fill('r');
  const sheet = page.locator('#diveSearchResults');
  await sheet.locator('[data-result-kind="expand-destinations"]').click({timeout:15000});
  const list = sheet.locator('#diveSearchResultsScroll');
  const hint = list.locator('#diveSearchLoadHint');
  await expect(hint).toBeVisible();
  await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
  const before = await list.locator('[data-result-kind="destination"]').count();
  const box = await list.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height - 20;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x,y}]});
  for (let step=1;step<=3;step++) await cdp.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x,y:y-step*20}]});
  await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
  expect(await list.locator('[data-result-kind="destination"]').count()).toBe(before);
  await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x,y}]});
  for (let step=1;step<=6;step++) await cdp.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x,y:y-step*20}]});
  await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
  await expect.poll(() => list.locator('[data-result-kind="destination"]').count()).toBeGreaterThan(before);
  const afterTouch = await list.locator('[data-result-kind="destination"]').count();
  await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await hint.hover();
  await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await list.dispatchEvent('wheel', {deltaY:48, deltaMode:0, bubbles:true});
  expect(await list.locator('[data-result-kind="destination"]').count()).toBe(afterTouch);
  await list.dispatchEvent('wheel', {deltaY:48, deltaMode:0, bubbles:true});
  await expect.poll(() => list.locator('[data-result-kind="destination"]').count()).toBeGreaterThan(afterTouch);
  const afterWheel = await list.locator('[data-result-kind="destination"]').count();
  await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await list.dispatchEvent('wheel', {deltaY:3, deltaMode:1, bubbles:true});
  expect(await list.locator('[data-result-kind="destination"]').count()).toBe(afterWheel);
  await list.dispatchEvent('wheel', {deltaY:3, deltaMode:1, bubbles:true});
  await expect.poll(() => list.locator('[data-result-kind="destination"]').count()).toBeGreaterThan(afterWheel);
  const afterLines = await list.locator('[data-result-kind="destination"]').count();
  await hint.click();
  await expect.poll(() => list.locator('[data-result-kind="destination"]').count()).toBeGreaterThan(afterLines);
});

test('mobile search launcher does not overlap the filter before scripts run', async ({ browser, baseURL }) => {
  const context = await browser.newContext({viewport:{width:390,height:844}, javaScriptEnabled:false});
  const preview = await context.newPage();
  await preview.goto(baseURL, {waitUntil:'domcontentloaded'});
  await expect(preview.locator('#diveSearchToggle')).toBeVisible();
  await expect(preview.locator('#diveSearchFilterToggle')).toBeHidden();
  await preview.setViewportSize({width:1000,height:844});
  await expect(preview.locator('#diveSearchFilterToggle')).toBeVisible();
  await context.close();
});

test('mobile search capsule responds while pressed', async ({ page }) => {
  const toggle = page.locator('#diveSearchToggle');
  const box = page.locator('#diveSearchSection .dive-search-box');
  const rect = await toggle.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await expect.poll(() => toggle.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await expect(box).toHaveCSS('transform', 'none');
  await page.mouse.up();
  await expect(page.locator('#diveSearchResults')).toBeVisible();
});
