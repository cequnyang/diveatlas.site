const { test, expect } = require('@playwright/test');

test('glass popup interactions do not reach the map underneath', async ({ page }) => {
  const { openMap, setMapView, mapState, waitForClickResolution } = require('./support');
  await openMap(page);
  await setMapView(page, -5.7, 131, 10);
  await page.evaluate(() => window.__DIVEATLAS_TEST__.setLegendCollapsed(true));
  await page.evaluate(() => window.__DIVEATLAS_TEST__.map.openPopup('<p>Popup interaction boundary</p>', [-5.7, 131], { autoPan:false }));
  const popup = page.locator('.leaflet-popup');
  await expect(popup).toBeVisible();
  await popup.locator('.leaflet-popup-content').evaluate(el => {
    const button = document.createElement('button');
    button.id = 'panel-interaction-probe';
    button.textContent = 'Panel control';
    button.onclick = () => button.dataset.clicked = 'true';
    el.prepend(button);
  });
  // Mobile placement may finish panning the sheet into its safe viewport.
  // Measure the interaction only after that opening movement settles.
  await waitForClickResolution(page);
  const button = page.locator('#panel-interaction-probe');
  const bounds = await button.boundingBox();
  const point = { x:bounds.x + bounds.width / 2, y:bounds.y + bounds.height / 2 };
  // Put a real geographic hover target directly beneath the panel control.
  await page.evaluate(point => {
    const api = window.__DIVEATLAS_TEST__;
    const rect = document.getElementById('map').getBoundingClientRect();
    const latlng = api.latLngAt(point.x - rect.left, point.y - rect.top);
    api.addCoralGrid(latlng.lat, latlng.lng, 'under-panel');
    api.clearActionCount();
  }, point);
  const before = await mapState(page);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('.leaflet-tooltip:visible')).toHaveCount(0);
  await button.click();
  await expect(button).toHaveAttribute('data-clicked', 'true');
  await page.mouse.wheel(0, 300);
  await waitForClickResolution(page);
  const after = await mapState(page);
  expect(after.center).toEqual(before.center);
  expect(after.zoom).toBe(before.zoom);
  expect(after.actionCount).toBe(0);
  expect(after.popup?.owner).toBe(before.popup?.owner);
  await expect(page.locator('.leaflet-tooltip:visible')).toHaveCount(0);
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('global-coral-map-tutorial-suppressed-v1', '1');
    localStorage.setItem('diveatlas-tutorial-seen-v1', '1');
    localStorage.setItem('global-coral-map-theme', 'light');
  });
  await page.route('https://**', route => route.abort());
  await page.route('**/api/auth/me', route => route.fulfill({ json:{ user:null } }));
  await page.route('**/plain-page-fixture.html', route => route.fulfill({
    contentType:'text/html',
    body:'<!doctype html><html><head><title>Plain document</title><link rel="stylesheet" href="/assets/site-header.css?v=1"><script src="/js/site-header.js?v=1" defer></script></head><body><main><h1>Plain document</h1></main></body></html>'
  }));
});

for (const path of ['/', '/dive-site.html', '/dive-sites/', '/regions/', '/destinations/', '/plain-page-fixture.html']) {
  test(`shared header layout and controls on ${path}`, async ({ page }) => {
    await page.goto(path);
    const header = page.locator('.shared-site-header');
    await expect(header).toHaveCount(1);
    await expect(header.locator('.dive-search-box')).toBeVisible();
    const bounds = await header.boundingBox();
    expect(bounds.height).toBe(42);
    await expect.poll(async () => (await header.boundingBox()).width).toBeLessThanOrEqual(page.viewportSize().width + 1);
    // Repeated mounts must retain existing nodes and their event handlers.
    const identity = await header.evaluate(el => {
      const input = el.querySelector('input');
      window.DiveAtlasHeader.mount();
      window.DiveAtlasHeader.mount();
      return input === el.querySelector('input');
    });
    expect(identity).toBe(true);
    const map = path === '/';
    if (!map) await expect(page.locator('#authMenuStatus')).toHaveText('Not signed in');
    await page.locator(map ? '#themeBtn' : '#seoThemeButton').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator(map ? '#languageMenuButton' : '#seoLanguageButton').click();
    await expect(page.locator(map ? '#languageDropdown' : '#seoLanguageDropdown')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator(map ? '#topMenuButton' : '#seoMenuButton').click();
    await expect(page.locator(map ? '#topMenuDropdown' : '#seoMenuDropdown')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.shared-site-header')).toHaveCount(1);
  });
}

for (const theme of ['light', 'dark']) {
  test(`nested source popovers visibly blur in ${theme} theme`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.shared-site-header')).toBeVisible();
    await page.addStyleTag({ content: '* { transition:none !important; animation:none !important; }' });
    await page.evaluate(theme => {
      document.documentElement.dataset.theme = theme;
      const sheet = document.createElement('section');
      sheet.id = 'source-glass-fixture';
      // Exercise the production delegated handler inside a clipped backdrop
      // root, with a sharp pattern that makes actual blur measurable.
      sheet.style.cssText = 'position:fixed;z-index:5000;top:100px;left:20px;width:280px;height:300px;overflow:hidden;backdrop-filter:blur(8px);background:repeating-linear-gradient(90deg,#102030 0 2px,#fff 2px 4px)';
      sheet.innerHTML = '<details class="dive-popup-sources" style="position:absolute;bottom:10px;right:10px"><summary>Source</summary><div class="dive-popup-sources__tooltip"><a href="#source-test">Source evidence link</a><p>Dataset and provenance details</p></div></details>';
      document.body.append(sheet);
    }, theme);
    const details = page.locator('#source-glass-fixture details');
    const tooltip = details.locator('.dive-popup-sources__tooltip');
    await details.locator('summary').click();
    await expect.poll(() => tooltip.evaluate(el => el.matches(':popover-open'))).toBe(true);
    await expect(tooltip.locator('a')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const blurred = await tooltip.screenshot();
    await tooltip.evaluate(el => el.style.setProperty('backdrop-filter', 'none', 'important'));
    expect(blurred.equals(await tooltip.screenshot())).toBe(false);
    const bounds = await tooltip.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(12);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width - 12);
    await page.keyboard.press('Escape');
    await expect(details).not.toHaveAttribute('open');
    await expect(tooltip).toBeHidden();
    await details.locator('summary').click();
    await expect(tooltip).toBeVisible();
    await page.mouse.click(5, 500);
    await expect(tooltip).toBeHidden();
  });

  test(`map navigation visibly blurs the backdrop in ${theme} theme`, async ({ page, isMobile }) => {
    await page.goto('/');
    await expect(page.locator('.shared-site-header')).toBeVisible();
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // A deterministic pattern catches backdrop-root failures that computed CSS
    // cannot detect. Keep it below the real header and its native menus.
    await page.addStyleTag({ content: `*, *::before, *::after { transition:none !important; animation:none !important; } body::after { content:''; position:fixed; inset:0; z-index:1299; pointer-events:none; background:repeating-linear-gradient(90deg,#102030 0 2px,#fff 2px 4px); }` });
    await page.evaluate(() => document.fonts.ready);
    const checkBlur = async (selector, disable) => {
      const panel = page.locator(selector);
      await expect(panel).toBeVisible();
      const blurred = await panel.screenshot({ animations: 'disabled' });
      const override = await page.addStyleTag({ content: disable });
      const sharp = await panel.screenshot({ animations: 'disabled' });
      expect(blurred.equals(sharp)).toBe(false);
      expect(sharp.equals(await panel.screenshot({ animations: 'disabled' }))).toBe(true);
      await override.evaluate(el => el.remove());
      expect(blurred.equals(await panel.screenshot({ animations: 'disabled' }))).toBe(true);
    };
    await page.locator('#languageMenuButton').click();
    await checkBlur('#languageDropdown', '#languageDropdown { backdrop-filter:none !important; -webkit-backdrop-filter:none !important; }');
    await page.keyboard.press('Escape');
    await page.locator('#topMenuButton').click();
    await checkBlur('#topMenuDropdown', '#topMenuDropdown, #topMenuDropdown::before { backdrop-filter:none !important; -webkit-backdrop-filter:none !important; }');
    await page.locator('#aboutMenuItem').click();
    if (isMobile) {
      await checkBlur('#aboutInfoDialog', '#aboutInfoDialog { backdrop-filter:none !important; -webkit-backdrop-filter:none !important; }');
    } else {
      await checkBlur('#topMenuAboutTooltip', '#topMenuAboutTooltip { backdrop-filter:none !important; -webkit-backdrop-filter:none !important; }');
    }
  });
}
