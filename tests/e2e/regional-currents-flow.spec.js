const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { openMap, selectEnvironmentView, setMapView } = require('./support');

const EXPERIMENT_URL = '/?__diveatlas_test=1&__currents_flow=1&lat=-8&lng=130&z=8';

async function enableCurrents(page) {
  const panel = page.locator('#bioLegend');
  if (await panel.evaluate(node => node.classList.contains('is-collapsed'))) await page.locator('#bioLegendTitle').click();
  await expect(page.locator('#bioLegendLayers')).toHaveAttribute('aria-hidden', 'false');
  await selectEnvironmentView(page, 'currents');
  await expect(page.locator('#currentsControls')).toBeVisible();
  await page.locator('#currentsDepth').selectOption('0');
  await expect(page.locator('#currentsStatus')).toHaveAttribute('data-state', 'ready');
}

async function expectCurrentFieldReady(page) {
  // `field-ready` is intentionally brief: the renderer reports `animating`
  // after it has decoded the field and begun drawing particles.
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_CURRENT_FLOW__.diagnostics?.status))
    .toMatch(/^(field-ready|animating)$/);
}

async function measureAnimationFrameRate(page) {
  return page.evaluate(() => new Promise(resolve => {
    let firstFrame;
    let frames = 0;
    const sample = timestamp => {
      firstFrame ??= timestamp;
      frames += 1;
      const elapsed = timestamp - firstFrame;
      if (elapsed >= 1_000) resolve(frames * 1_000 / elapsed);
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
}

test('flow experiment stays lazy and remains idle while Currents is off', async ({ page }) => {
  const requests = [];
  page.on('request', request => {
    if (/current-flow|regional-currents-flow|data\/currents/.test(request.url())) requests.push(request.url());
  });
  await openMap(page, { url: EXPERIMENT_URL });
  await page.waitForTimeout(250);
  await expect(page.locator('#currentFlowExperiment')).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => Boolean(window.__DIVEATLAS_CURRENT_FLOW__))).toBe(true);
  expect(await page.evaluate(() => window.__DIVEATLAS_CURRENT_FLOW__.state)).toBeNull();
});

test('the animated flow renderer benchmarks at matched particle counts without an arrow fallback', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const fieldResponses = [];
  page.on('response', async response => {
    if (/regional-currents-flow\/field-.*\.bin\.gz/.test(response.url())) {
      fieldResponses.push({
        url: new URL(response.url()).pathname,
        bytes: Number(response.headers()['content-length']) || (await response.body()).byteLength
      });
    }
  });
  await openMap(page, { url: EXPERIMENT_URL });
  await setMapView(page, -8, 130, 8);
  await enableCurrents(page);
  await page.locator('#currentsMonth').selectOption('9');
  const noFlowRafFps = await measureAnimationFrameRate(page);
  const noFlowHeapBytes = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  await page.evaluate(() => window.__DIVEATLAS_CURRENT_FLOW__.activate());
  await expect(page.locator('.regional-current-flow-canvas')).toBeAttached();
  await expectCurrentFieldReady(page);
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_CURRENT_FLOW__.diagnostics?.firstFlowVisibleMs)).toBeGreaterThan(0);
  const loadMeasurements = [];
  loadMeasurements.push(await page.evaluate(() => ({ ...window.__DIVEATLAS_CURRENT_FLOW__.diagnostics })));

  const mobile = testInfo.project.name === 'mobile-touch-chromium';
  const counts = mobile ? [1_000, 2_000, 4_000, 8_000] : [2_500, 5_000, 10_000, 20_000];
  const variants = ['0.083', '0.25', '0.5'];
  const measurements = [];
  for (const resolution of variants) {
    if (resolution !== '0.083') {
      await page.evaluate(value => window.__DIVEATLAS_CURRENT_FLOW__.setResolution(value), resolution);
      await expectCurrentFieldReady(page);
      await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_CURRENT_FLOW__.diagnostics?.firstFlowVisibleMs)).toBeGreaterThan(0);
      loadMeasurements.push(await page.evaluate(() => ({ ...window.__DIVEATLAS_CURRENT_FLOW__.diagnostics })));
    }
    for (const count of counts) {
      await page.evaluate(value => window.__DIVEATLAS_CURRENT_FLOW__.setParticleCount(value), count);
      await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_CURRENT_FLOW__.state?.particleCount)).toBe(count);
      await expect.poll(() => page.evaluate(() => {
        const diagnostics = window.__DIVEATLAS_CURRENT_FLOW__.diagnostics;
        return diagnostics?.status === 'animating' && diagnostics.elapsedMs >= 900;
      }), { timeout: 5_000 }).toBe(true);
      const reading = await page.evaluate(() => {
        const { diagnostics, state } = window.__DIVEATLAS_CURRENT_FLOW__;
        return {
          ...diagnostics,
          state,
          jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
          screen: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
          userAgent: navigator.userAgent
        };
      });
      measurements.push({ resolution, count, ...reading });
      if (count === counts[0]) {
        await page.screenshot({ path: path.join(testInfo.outputDir, `flow-${testInfo.project.name}-${resolution}.png`) });
      }
    }
  }
  const outputPath = path.join(testInfo.outputDir, `regional-currents-flow-${testInfo.project.name}.json`);
  fs.writeFileSync(outputPath, JSON.stringify({
    project: testInfo.project.name,
    viewport: page.viewportSize(),
    noFlowRafFps,
    noFlowHeapBytes,
    particleCounts: counts,
    fieldResponses,
    loadMeasurements,
    measurements
  }, null, 2));

  const expectedFieldBytes = variants.map(resolution => fs.statSync(path.join(
    process.cwd(), 'tests', 'fixtures', 'regional-currents-flow', `field-${resolution}.bin.gz`
  )).size);
  expect(fieldResponses.map(response => response.bytes)).toEqual(expectedFieldBytes);
  expect(measurements.every(result => result.status === 'animating' && result.canvasBytes > 0)).toBe(true);
  expect(measurements.every(result => result.firstFlowVisibleMs > 0 && result.decodeMs >= 0)).toBe(true);
  expect(await page.locator('.regional-current-flow-canvas').evaluate(canvas => getComputedStyle(canvas).pointerEvents)).toBe('none');
});

test('flow lifecycle handles unsupported slices, map interaction, disable, and reduced motion without arrows', async ({ page }) => {
  const flowRequests = [];
  page.on('request', request => { if (/regional-currents-flow\/field-/.test(request.url())) flowRequests.push(request.url()); });
  await openMap(page, { url: EXPERIMENT_URL });
  await enableCurrents(page);
  await page.locator('#currentsMonth').selectOption('9');
  await page.evaluate(() => window.__DIVEATLAS_CURRENT_FLOW__.activate());
  await expect(page.locator('.regional-current-flow-canvas')).toBeAttached();
  await expectCurrentFieldReady(page);
  await expect(page.locator('.regional-currents-canvas')).toHaveCount(0);

  const centerBefore = await page.evaluate(() => window.__DIVEATLAS_TEST__.map.getCenter().lng);
  await page.evaluate(() => window.__DIVEATLAS_TEST__.map.panBy([80, 0], { animate: false }));
  await page.locator('.leaflet-control-zoom-in').click();
  expect(await page.evaluate(() => window.__DIVEATLAS_TEST__.map.getCenter().lng)).not.toBe(centerBefore);
  await expect(page.locator('.regional-current-flow-canvas')).toBeAttached();

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_CURRENT_FLOW__.state?.rafActive)).toBe(false);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_CURRENT_FLOW__.state?.rafActive)).toBe(true);
  await page.waitForTimeout(1_500);
  expect(await page.evaluate(() => window.__DIVEATLAS_CURRENT_FLOW__.state?.respawnCount)).toBeGreaterThan(0);

  await page.locator('#currentsMonth').selectOption('10');
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_CURRENT_FLOW__.diagnostics?.status)).toBe('slice-unavailable');
  await expect(page.locator('.regional-currents-canvas')).toHaveCount(0);
  await page.locator('#currentsMonth').selectOption('9');
  await expectCurrentFieldReady(page);
  await page.locator('#currentsDepth').selectOption('10');
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_CURRENT_FLOW__.diagnostics?.status)).toBe('slice-unavailable');
  await expect(page.locator('.regional-currents-canvas')).toHaveCount(0);
  await page.locator('#currentsDepth').selectOption('0');
  await expectCurrentFieldReady(page);

  await selectEnvironmentView(page, 'default');
  await expect(page.locator('.regional-current-flow-canvas')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_CURRENT_FLOW__.state?.rafActive)).toBe(false);
  const requestCountWhenOff = flowRequests.length;
  await page.waitForTimeout(400);
  expect(flowRequests).toHaveLength(requestCountWhenOff);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await selectEnvironmentView(page, 'currents');
  await page.evaluate(() => window.__DIVEATLAS_CURRENT_FLOW__.activate());
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_CURRENT_FLOW__.diagnostics?.status)).toBe('reduced-motion');
  await expect(page.locator('.regional-current-flow-canvas')).toHaveCount(0);
  await expect(page.locator('.regional-currents-canvas')).toHaveCount(0);
});
