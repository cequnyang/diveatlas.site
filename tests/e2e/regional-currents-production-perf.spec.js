const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const { openMap } = require('./support');

const baselineHtml = execFileSync('git', ['show', 'HEAD:index.html'], { encoding: 'utf8' });
const FLOW_URL = '/?__diveatlas_test=1&__currents_flow=1&lat=-5.7&lng=131&z=7';

async function openLayersPanel(page) {
  const panel = page.locator('#bioLegend');
  if (await panel.evaluate(node => node.classList.contains('is-collapsed'))) {
    await page.locator('#bioLegendTitle').click();
  }
  await expect(page.locator('#bioLegendLayers')).toHaveAttribute('aria-hidden', 'false');
}

async function refreshAndWait(page, action) {
  const started = Date.now();
  await action();
  // Cached viewport tiles can take the status directly back to ready between browser polls.
  await page.waitForTimeout(100);
  await page.waitForFunction(() => document.querySelector('#currentsStatus')?.dataset.state === 'ready');
  return Date.now() - started;
}

async function visibleFlowPixels(page) {
  return page.locator('.regional-current-flow-canvas').evaluate(canvas => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index]) count += 1;
    return count;
  });
}

test('measures disabled startup and real global current tile loading, redraw, and cache behavior', async ({ page }, testInfo) => {
  const currentRequests = [];
  const tileResponses = [];
  const longTasks = [];
  page.on('request', request => {
    if (/currents|current-math|current-tile-cache|regional-currents/.test(new URL(request.url()).pathname)) {
      currentRequests.push({ url: request.url(), at: Date.now() });
    }
  });
  page.on('response', response => {
    if (/\.bin\.gz(?:\?|$)/.test(response.url())) {
      tileResponses.push({
        url: response.url(),
        bytes: Number(response.headers()['content-length'] || 0),
        status: response.status(),
        at: Date.now()
      });
    }
  });

  await page.addInitScript(() => {
    window.__currentPerf = { lcp: null, cls: 0, longTasks: [] };
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) window.__currentPerf.lcp = entry.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__currentPerf.cls += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) window.__currentPerf.longTasks.push(entry.duration);
      }).observe({ type: 'longtask', buffered: true });
    } catch (_) {}
  });

  const mapStart = Date.now();
  await openMap(page, { url: FLOW_URL });
  const mapUsableMs = Date.now() - mapStart;
  await page.waitForTimeout(750);
  const disabledRequests = currentRequests.length;
  expect(disabledRequests).toBe(0);
  const startup = await page.evaluate(() => ({
    document: (() => {
      const entry = performance.getEntriesByType('navigation')[0];
      return { transferSize: entry?.transferSize ?? null, encodedBodySize: entry?.encodedBodySize ?? null };
    })(),
    lcpMs: window.__currentPerf.lcp,
    cls: window.__currentPerf.cls,
    longTasksMs: [...window.__currentPerf.longTasks],
    initialResourceBytes: performance.getEntriesByType('resource').reduce((sum, entry) => sum + entry.transferSize, 0),
    memory: performance.memory?.usedJSHeapSize ?? null
  }));

  await page.evaluate(() => window.__DIVEATLAS_TEST__.map.setView([0, 0], 2, { animate: false }));
  await openLayersPanel(page);
  const globalStart = Date.now();
  const firstFlow = page.waitForFunction(() => {
    const canvas = document.querySelector('.regional-current-flow-canvas');
    if (!canvas) return false;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset]) return true;
    return false;
  });
  const metadataResponse = page.waitForResponse(response => /\/data\/currents\/metadata\.json/.test(response.url()));
  await page.locator('label.environment-segment:has(#currentsLayerToggle)').click();
  await metadataResponse;
  await page.locator('#currentsDepth').selectOption('0');
  await page.waitForFunction(() => document.querySelector('#currentsStatus')?.dataset.state === 'ready');
  // The mobile viewport at z2 does not intersect the Raja Ampat fixture crop.
  // Center on the crop before measuring real-data flow activation.
  await refreshAndWait(page, () => page.evaluate(() => window.__DIVEATLAS_TEST__.map.setView([-5.7, 131], 7, { animate: false })));
  await page.evaluate(() => window.__DIVEATLAS_CURRENT_FLOW__.activate());
  await firstFlow;
  expect(await visibleFlowPixels(page)).toBeGreaterThan(0);
  const globalFirstFlowMs = Date.now() - globalStart;
  await page.waitForFunction(() => document.querySelector('#currentsStatus')?.dataset.state === 'ready');
  const globalCompleteMs = Date.now() - globalStart;
  const global = tileResponses.length;
  await page.screenshot({ path: `test-results/regional-currents-production-${testInfo.project.name}-global.png` });

  const regionalTileStart = tileResponses.length;
  const regionalCompleteMs = await refreshAndWait(page, () => page.evaluate(() => window.__DIVEATLAS_TEST__.map.setView([-5.7, 131], 7, { animate: false })));
  await page.screenshot({ path: `test-results/regional-currents-production-${testInfo.project.name}-regional.png` });
  const regionalTileCount = tileResponses.length - regionalTileStart;

  const highZoomTileStart = tileResponses.length;
  const highZoomCompleteMs = await refreshAndWait(page, () => page.evaluate(() => window.__DIVEATLAS_TEST__.map.setView([-5.7, 131], 9, { animate: false })));
  await page.screenshot({ path: `test-results/regional-currents-production-${testInfo.project.name}-high.png` });
  const highZoomTileCount = tileResponses.length - highZoomTileStart;
  const highZoomViewportPanStart = tileResponses.length;
  await refreshAndWait(page, () => page.evaluate(() => window.__DIVEATLAS_TEST__.map.setView([-5.7, 135], 9, { animate: false })));
  const adjacentViewportPanRequests = tileResponses.length - highZoomViewportPanStart;
  const adjacentTilePanStart = tileResponses.length;
  await refreshAndWait(page, () => page.evaluate(() => window.__DIVEATLAS_TEST__.map.setView([-5.7, 170], 9, { animate: false })));
  const adjacentTilePanRequests = tileResponses.length - adjacentTilePanStart;

  await openLayersPanel(page);
  await refreshAndWait(page, () => page.locator('#currentsMonth').selectOption('9'));
  await refreshAndWait(page, () => page.locator('#currentsDepth').selectOption('20'));
  await refreshAndWait(page, () => page.locator('#currentsMonth').selectOption('1'));
  await refreshAndWait(page, () => page.locator('#currentsDepth').selectOption('20'));
  await refreshAndWait(page, () => page.locator('#currentsDepth').selectOption('10'));
  const cachedReturnRequestCount = tileResponses.length;
  await refreshAndWait(page, () => page.locator('#currentsDepth').selectOption('20'));
  await refreshAndWait(page, () => page.locator('#currentsMonth').selectOption('9'));
  expect(tileResponses.length).toBe(cachedReturnRequestCount);
  const cacheReturnAddedRequests = tileResponses.length - cachedReturnRequestCount;
  const antimeridianRequestStart = tileResponses.length;
  await refreshAndWait(page, () => page.evaluate(() => window.__DIVEATLAS_TEST__.map.setView([0, 179.8], 9, { animate: false })));
  const edgeTileUrls = tileResponses.slice(antimeridianRequestStart).map(response => response.url);
  expect(edgeTileUrls.some(url => /\/s4\/0_2\.bin\.gz/.test(url))).toBe(true);
  const allTileUrls = tileResponses.map(response => response.url);
  expect(allTileUrls.some(url => /\/s4\/8_2\.bin\.gz/.test(url))).toBe(true);
  for (const longitude of [-180, 180]) {
    await page.evaluate(lng => {
      const map = window.__DIVEATLAS_TEST__.map;
      const latlng = L.latLng(0, lng);
      map.fire('click', { latlng, containerPoint: map.latLngToContainerPoint(latlng) });
    }, longitude);
    await expect(page.locator('.regional-currents-popup')).toBeVisible();
    await expect(page.locator('.regional-currents-popup')).toContainText('Water flows toward W');
    await expect(page.locator('.regional-currents-popup')).toContainText('0.56 m/s');
    await page.evaluate(() => window.__DIVEATLAS_TEST__.map.closePopup());
  }
  await refreshAndWait(page, () => page.evaluate(() => window.__DIVEATLAS_TEST__.map.setView([-5.7, 131], 7, { animate: false })));
  const memoryAfterSwitches = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  const currents = await page.evaluate(() => ({
    longTasksMs: [...window.__currentPerf.longTasks],
    cacheEntriesMaximum: 96,
    decodedBytesPerTile: 128 * 128 * 4,
    memory: performance.memory?.usedJSHeapSize ?? null
  }));
  expect(tileResponses.every(response => response.status === 200)).toBe(true);
  expect(tileResponses.every(response => response.bytes > 0)).toBe(true);

  console.log('REAL_CURRENTS_PERF', JSON.stringify({
    project: testInfo.project.name,
    viewport: page.viewportSize(),
    browser: page.context().browser().version(),
    mapUsableMs,
    disabledCurrentRequests: disabledRequests,
    startup,
    global: { firstFlowMs: globalFirstFlowMs, completeMs: globalCompleteMs, requests: global },
    regional: { completeMs: regionalCompleteMs, requests: regionalTileCount },
    highZoom: { completeMs: highZoomCompleteMs, requests: highZoomTileCount },
    adjacentViewportPanRequests,
    adjacentTilePanRequests,
    tileRequests: tileResponses.length,
    tileCompressedBytes: tileResponses.reduce((sum, response) => sum + response.bytes, 0),
    decodedTileBytes: tileResponses.length * 128 * 128 * 4,
    cacheReturnAddedRequests,
    cacheMaximumDecodedTileBytes: currents.cacheEntriesMaximum * currents.decodedBytesPerTile,
    memoryAfterSwitches,
    currents
  }));
});

test('measures pre-currents startup from the checked-out base revision for comparison', async ({ page }, testInfo) => {
  const start = Date.now();
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      localStorage.setItem('global-coral-map-theme', 'light');
    } catch (_) {}
    window.__startupPerf = { lcp: null, cls: 0, longTasks: [] };
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) window.__startupPerf.lcp = entry.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__startupPerf.cls += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) window.__startupPerf.longTasks.push(entry.duration);
      }).observe({ type: 'longtask', buffered: true });
    } catch (_) {}
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.hostname !== 'unpkg.com') return route.abort();
    if (url.hostname === '127.0.0.1' && url.pathname === '/') {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: baselineHtml });
    }
    return route.fallback();
  });
  await page.goto('/?__diveatlas_test=1&lat=-5.7&lng=131&z=7');
  await expect.poll(() => page.evaluate(() => Boolean(window.__DIVEATLAS_TEST__?.map))).toBe(true);
  await page.evaluate(() => new Promise(resolve => window.__DIVEATLAS_TEST__.map.whenReady(resolve)));
  await page.evaluate(() => window.__DIVEATLAS_TEST__.map.invalidateSize({ animate: false }));
  const mapUsableMs = Date.now() - start;
  await page.waitForTimeout(750);
  const metrics = await page.evaluate(() => ({
    document: (() => {
      const entry = performance.getEntriesByType('navigation')[0];
      return { transferSize: entry?.transferSize ?? null, encodedBodySize: entry?.encodedBodySize ?? null };
    })(),
    lcpMs: window.__startupPerf.lcp,
    cls: window.__startupPerf.cls,
    longTasksMs: [...window.__startupPerf.longTasks],
    initialResourceBytes: performance.getEntriesByType('resource').reduce((sum, entry) => sum + entry.transferSize, 0),
    memory: performance.memory?.usedJSHeapSize ?? null
  }));
  console.log('BASELINE_STARTUP_PERF', JSON.stringify({
    project: testInfo.project.name,
    viewport: page.viewportSize(),
    browser: page.context().browser().version(),
    mapUsableMs,
    metrics
  }));
});
