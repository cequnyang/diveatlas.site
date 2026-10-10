const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

test('captures the requested Tide visual QA matrix', async ({ page, browser }) => {
  test.setTimeout(300_000);
  const output = path.resolve('artifacts/tide-visual-qa');
  fs.mkdirSync(output, { recursive: true });
  await page.addInitScript(() => {
    try { localStorage.clear(); localStorage.setItem('global-coral-map-theme', 'light'); }
    catch (_) {}
  });
  await page.goto('/?__diveatlas_test=1&lat=-5.7&lng=131&z=7', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => Boolean(window.__DIVEATLAS_TEST__?.map))).toBe(true);
  await page.evaluate(() => new Promise(resolve => window.__DIVEATLAS_TEST__.map.whenReady(resolve)));
  await page.evaluate(() => window.__DIVEATLAS_TEST__.map.invalidateSize({ animate: false }));
  await page.evaluate(() => window.__DIVEATLAS_TEST__.setLegendCollapsed(false));

  const tab = view => page.locator('.environment-segment').filter({
    has: page.locator(`input[name="environmentView"][value="${view}"]`)
  });

  async function waitForMapInteractionWindow() {
    await expect.poll(() => page.evaluate(() => {
      const state = window.__DIVEATLAS_TEST__.getState();
      return !state.pendingInteraction && !state.activePointerGesture && performance.now() >= state.suppressedUntil;
    })).toBe(true);
  }

  await tab('tide').click();
  await expect.poll(() => page.locator('#tideStatus').textContent(), { timeout: 30_000 }).toContain('Tide surface ready');

  async function center(lat, lon, zoom, theme = 'light') {
    const isDark = await page.locator('html').getAttribute('data-theme') === 'dark';
    if ((theme === 'dark') !== isDark) await page.locator('#themeBtn').click();
    await page.evaluate(([a, b, z]) => window.__DIVEATLAS_TEST__.setView(a, b, z), [lat, lon, zoom]);
    await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.map.getPane('tidePane').style.opacity), { timeout: 30_000 })
      .toBe(theme === 'dark' ? '0.64' : '0.68');
    await page.evaluate(() => window.__DIVEATLAS_TEST__.setLegendCollapsed(false));
  }

  async function capture(name) {
    await page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
  }

  await center(10, 0, 2, 'light');
  await capture('01-global-light');
  await capture('01-global-light');
  await center(3, 121, 4, 'light');
  await capture('02-southeast-asia-light');

  const checkLocations = [
    ['philippines', 12, 122, 5], ['japan', 36, 138, 5], ['caribbean', 18, -75, 4],
    ['mediterranean', 35, 18, 4], ['open-pacific', 0, -140, 3], ['large-range-bay-of-fundy', 45, -64, 5],
    ['small-range-pacific', 0, -140, 4]
  ];
  for (const theme of ['light', 'dark']) {
    for (const [name, lat, lon, zoom] of checkLocations) {
      await center(lat, lon, zoom, theme);
      await capture(`mask-${name}-${theme}`);
    }
  }

  await center(44.9, -124.95, 5, 'light');
  const clickPoint = await page.evaluate(() => {
    const map = window.__DIVEATLAS_TEST__.map;
    const point = map.latLngToContainerPoint([44.9, -124.95]);
    const rect = document.getElementById('map').getBoundingClientRect();
    return { x: rect.left + point.x, y: rect.top + point.y };
  });
  await waitForMapInteractionWindow();
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await expect(page.locator('.tide-map-popup')).toBeVisible();
  await expect(page.locator('.tide-map-popup')).toContainText('Predicted level');
  await capture('03-tide-popup-light');

  await center(10, 0, 2, 'dark');
  await capture('04-global-dark');
  await center(44.9, -124.95, 5, 'dark');
  const darkClickPoint = await page.evaluate(() => {
    const map = window.__DIVEATLAS_TEST__.map;
    const point = map.latLngToContainerPoint([44.9, -124.95]);
    const rect = document.getElementById('map').getBoundingClientRect();
    return { x: rect.left + point.x, y: rect.top + point.y };
  });
  await waitForMapInteractionWindow();
  await page.mouse.click(darkClickPoint.x, darkClickPoint.y);
  await expect(page.locator('.tide-map-popup')).toBeVisible();
  await capture('05-tide-popup-dark');

  await center(3, 121, 4, 'light');
  const tideComparison = await page.screenshot({ animations: 'disabled' });
  await page.evaluate(() => window.__DIVEATLAS_TEST__.selectEnvironmentalView('waves'));
  await expect(page.locator('#wavesControls')).toHaveClass(/is-open/);
  await expect(page.locator('.waves-tiles')).toHaveCount(1);
  const wavesComparison = await page.screenshot({ animations: 'disabled' });
  const comparison = await browser.newPage({ viewport: { width: 2048, height: 920 } });
  const asDataUrl = buffer => `data:image/png;base64,${buffer.toString('base64')}`;
  await comparison.setContent(`<style>body{margin:0;font:600 22px sans-serif;color:#263448;background:#f2f5f8}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px}.card{overflow:hidden;border:1px solid #cbd5e1;border-radius:12px;background:white}.label{padding:12px 16px}.card img{display:block;width:100%;height:auto}</style><main class="pair"><section class="card"><div class="label">Tide · blue sequential level</div><img src="${asDataUrl(tideComparison)}"></section><section class="card"><div class="label">Waves · existing wave-height treatment</div><img src="${asDataUrl(wavesComparison)}"></section></main>`);
  await comparison.screenshot({ path: path.join(output, '07-tide-vs-waves.png'), fullPage: true });
  await comparison.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.addInitScript(() => {
    try { localStorage.clear(); localStorage.setItem('global-coral-map-theme', 'light'); }
    catch (_) {}
  });
  await mobile.goto('/?__diveatlas_test=1&lat=3&lng=121&z=4', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => mobile.evaluate(() => Boolean(window.__DIVEATLAS_TEST__?.map))).toBe(true);
  await mobile.evaluate(() => new Promise(resolve => window.__DIVEATLAS_TEST__.map.whenReady(resolve)));
  await mobile.evaluate(() => window.__DIVEATLAS_TEST__.selectEnvironmentalView('tide'));
  await expect.poll(() => mobile.locator('#tideStatus').textContent(), { timeout: 30_000 }).toContain('Tide surface ready');
  await expect.poll(() => mobile.evaluate(() => window.__DIVEATLAS_TEST__.map.getPane('tidePane').style.opacity), { timeout: 30_000 }).toBe('0.68');
  await mobile.screenshot({ path: path.join(output, '06-mobile-tide.png'), animations: 'disabled' });
  await mobile.locator('#bioLegendTitle').click();
  await mobile.screenshot({ path: path.join(output, '06-mobile-tide-panel.png'), animations: 'disabled' });
  await mobile.close();
});
