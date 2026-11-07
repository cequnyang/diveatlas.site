const { test, expect } = require('@playwright/test');
// Headless Chromium normally hides native scrollbars, masking header gaps.
test.use({ launchOptions:{ ignoreDefaultArgs:['--hide-scrollbars'] } });

test('glass popup interactions do not reach the map underneath', async ({ page, hasTouch }) => {
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
  if (hasTouch) await button.tap(); else await button.click();
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

test('tutorial language and photo policy popovers escape nested glass and dismiss cleanly', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.shared-site-header')).toBeVisible();
  await page.locator('#bioLegendGuide').evaluate(el => el.click());
  await expect(page.locator('.tutorial-dialog')).toBeVisible();
  await page.locator('#tutorialLanguageMenuButton').click();
  const language = page.locator('#tutorialLanguageDropdown');
  await expect.poll(() => language.evaluate(el => el.matches(':popover-open'))).toBe(true);
  await expect(language).toHaveCSS('backdrop-filter', 'blur(8px) saturate(1.45)');
  await page.keyboard.press('Escape');
  await expect(language).toBeHidden();
  await page.locator('#tutorialClose').click();
  await expect(page.locator('.tutorial-dialog')).toBeHidden();
  // Open the production photo form shell without submitting or requiring an
  // account; its policy control still uses the real shared form controller.
  await page.locator('#sitePhotoUploadModal').evaluate(el => el.hidden = false);
  await page.locator('#sitePhotoUploadForm').evaluate(el => el.hidden = false);
  await page.locator('#sitePhotoUploadPolicyTrigger').click();
  const policy = page.locator('#sitePhotoUploadPolicyPopover');
  await expect.poll(() => policy.evaluate(el => el.matches(':popover-open'))).toBe(true);
  await expect(policy).toHaveCSS('backdrop-filter', 'blur(8px) saturate(1.45)');
  await page.keyboard.press('Escape');
  await expect(policy).toBeHidden();
  await expect(page.locator('#sitePhotoUploadPolicyTrigger')).toBeFocused();
  await page.locator('#sitePhotoUploadCloseButton').click();
  await expect(page.locator('#sitePhotoUploadModal')).toBeHidden();
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

test.describe('shared header native scrollbar edge', () => {
  for (const path of ['/', '/dive-site.html', '/dive-sites/', '/regions/', '/destinations/', '/plain-page-fixture.html']) {
    test(`header fills the scrollbar edge on ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('.shared-site-header')).toBeVisible();
      await page.addStyleTag({ content:'html { overflow-y:scroll !important; } * { transition:none !important; }' });
      for (const theme of ['light', 'dark']) {
        const geometry = await page.evaluate(theme => {
          document.documentElement.dataset.theme = theme;
          const root = document.documentElement;
          const header = document.querySelector('.shared-site-header').getBoundingClientRect();
          return {
            gutter:innerWidth - root.clientWidth,
            clientWidth:root.clientWidth,
            header:{ left:header.left, right:header.right, top:header.top, height:header.height },
            background:getComputedStyle(root, '::-webkit-scrollbar').backgroundImage,
            offset:getComputedStyle(root, '::-webkit-scrollbar-track').marginTop
          };
        }, theme);
        expect(geometry.header.left).toBe(0);
        expect(geometry.header.top).toBe(0);
        expect(geometry.header.right).toBeCloseTo(geometry.clientWidth, 0);
        expect(geometry.header.height).toBe(42);
        expect(geometry.background).toContain('linear-gradient');
        expect(geometry.background).toContain('42px');
        expect(geometry.offset).toBe('42px');
        if (geometry.gutter > 0) {
          // Verify where the native track/thumb actually paint, rather than
          // only checking their computed margin. The photo remains full bleed.
          const markerStyle = await page.addStyleTag({ content:`
            html:has(> body.has-shared-header)::-webkit-scrollbar-thumb {
              background:rgb(255 0 0) !important; border:0 !important; border-radius:0 !important;
            }
            html:has(> body.has-shared-header)::-webkit-scrollbar-track {
              background:rgb(0 0 255) !important;
            }` });
          const rail = await page.screenshot({ clip:{ x:geometry.clientWidth, y:0,
            width:geometry.gutter, height:page.viewportSize().height } });
          const firstPaintedRow = await page.evaluate(async base64 => {
            const image = new Image();
            image.src = `data:image/png;base64,${base64}`;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width; canvas.height = image.height;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, image.width, image.height).data;
            for (let y = 0; y < image.height; y += 1) {
              for (let x = 0; x < image.width; x += 1) {
                const offset = (y * image.width + x) * 4;
                if (pixels[offset + 1] < 10 &&
                    ((pixels[offset] > 245 && pixels[offset + 2] < 10) ||
                     (pixels[offset + 2] > 245 && pixels[offset] < 10))) return y;
              }
            }
            return -1;
          }, rail.toString('base64'));
          expect(firstPaintedRow, 'native scrolling controls begin below the fixed bar').toBeGreaterThanOrEqual(42);
          await markerStyle.evaluate(node => node.remove());
          const clip = { x:geometry.clientWidth, y:0, width:geometry.gutter, height:40 };
          const painted = await page.screenshot({ clip });
          const override = await page.addStyleTag({ content:'html:has(> body.has-shared-header)::-webkit-scrollbar { background:magenta !important; }' });
          expect(painted.equals(await page.screenshot({ clip })), 'native gutter paints the header material').toBe(false);
          await override.evaluate(el => el.remove());
        }
      }
    });
  }
});

for (const theme of ['light', 'dark']) {
  test(`overlay surface inventory has visible glass and contains map input in ${theme}`, async ({ page }) => {
    test.setTimeout(90_000);
    const { openMap, setMapView, mapState, waitForClickResolution } = require('./support');
    await openMap(page);
    await setMapView(page, -5.7, 131, 10);
    await page.evaluate(() => window.__DIVEATLAS_TEST__.setLegendCollapsed(true));
    await page.addStyleTag({ content: '* { animation:none !important; transition:none !important; }' });
    await page.evaluate(theme => {
      document.documentElement.dataset.theme = theme;
      const backing = document.createElement('div');
      backing.style.cssText = 'position:fixed;inset:0;z-index:4500;pointer-events:none;background:repeating-linear-gradient(90deg,#102030 0 2px,#fff 2px 4px)';
      document.getElementById('map').append(backing);
    }, theme);
    // This is the shell inventory, not a replacement for real open/close and
    // focus tests. Exercise each production adapter under the map event root.
    const surfaces = [
      'share-dialog', 'site-suggestion-dialog', 'contact-dialog', 'seo-dialog', 'tutorial-dialog',
      'tutorial-language-dropdown', 'temperature-scroll-wheel', 'dive-filter-options',
      'temperature-info-popover', 'dive-conditions-info-popover', 'dive-experience-info-popover',
      'site-photo-upload-policy-popover', 'dive-location-coordinate-tooltip',
      'dive-popup-sources__tooltip', 'dive-conditions-sources-tooltip',
      'top-menu-about-tooltip', 'bio-legend-overflow-menu', 'dive-layer-filter-menu',
      'dive-photo-preview', 'mobile-map-credits-panel'
    ];
    for (const className of surfaces) {
      await page.evaluate(className => {
        const surface = document.createElement('section');
        surface.id = 'overlay-audit-surface';
        surface.className = className;
        surface.style.cssText = 'position:fixed!important;inset:160px auto auto 20px!important;width:240px!important;height:180px!important;min-width:0!important;max-height:none!important;display:block!important;visibility:visible!important;opacity:1!important;z-index:5000!important;transform:none!important;margin:0!important';
        surface.innerHTML = '<button type="button">Overlay control</button>';
        surface.querySelector('button').onclick = event => event.target.dataset.clicked = 'true';
        document.getElementById('map').append(surface);
        const api = window.__DIVEATLAS_TEST__;
        const bounds = surface.getBoundingClientRect();
        const mapBounds = document.getElementById('map').getBoundingClientRect();
        const point = api.latLngAt(bounds.x + 120 - mapBounds.x, bounds.y + 90 - mapBounds.y);
        api.addCoralGrid(point.lat, point.lng, 'under-overlay-inventory');
        api.clearActionCount();
      }, className);
      const panel = page.locator('#overlay-audit-surface');
      await expect(panel, className).toHaveCSS('backdrop-filter', 'blur(8px) saturate(1.45)');
      const blurred = await panel.screenshot();
      await panel.evaluate(el => el.style.setProperty('backdrop-filter', 'none', 'important'));
      expect(blurred.equals(await panel.screenshot()), `${className} visibly blurs`).toBe(false);
      const before = await mapState(page);
      await panel.hover({ position:{ x:120, y:90 } });
      await expect(page.locator('.leaflet-tooltip:visible'), className).toHaveCount(0);
      await panel.locator('button').click();
      await expect(panel.locator('button'), className).toHaveAttribute('data-clicked', 'true');
      await panel.locator('button').press('ArrowDown');
      await page.mouse.wheel(0, 100);
      await waitForClickResolution(page);
      const after = await mapState(page);
      expect(after.center, className).toEqual(before.center);
      expect(after.zoom, className).toBe(before.zoom);
      expect(after.actionCount, className).toBe(0);
      await panel.evaluate(el => el.remove());
    }
  });

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
