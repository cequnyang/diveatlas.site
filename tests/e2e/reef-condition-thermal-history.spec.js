const { test, expect } = require('@playwright/test');
const zlib = require('node:zlib');
const fixture = require('../fixtures/reef-condition/mock-raja-ampat.json');
const { closeTopMenu, openMap, openMobileSettings, openTopMenu } = require('./support');

function thermalHistoryMetadata() {
  return {
    schema_version: 1, provider: 'NOAA Coral Reef Watch', product: 'Thermal History Annual History',
    productVersion: '3.7.0', sourceUrl: 'https://www.coralreefwatch.noaa.gov/product/thermal_history/annual_history.php',
    sourceMetadata: 'Annual maximum DHW summaries; threshold-year counts are not bleaching observations.',
    attribution: 'NOAA Coral Reef Watch', variable: 'ann_max_dhw', units: 'degrees_Celsius-weeks',
    periods: { fullStart: 1985, fullEnd: 2025, recentStart: 2016, recentEnd: 2025 }, thresholds: [4, 8, 12, 16, 20], recentYears: 10,
    asset_base: 'data/reef-condition/thermal-stress-history', map_tile_template: 'tiles/{z}/{x}/{y}.png',
    query_tile_template: 'query/{column}_{row}.bin.gz', version: 'crw-test',
    grid: { width: 7200, height: 1390, longitude_min: -179.975, longitude_step: 0.05, latitude_min: -35.275, latitude_step: 0.05, row_order: 'south-to-north' },
    encoding: { map_zoom: 5, query_tile_size_cells: 256, query_bytes_per_cell: 38, query_format: 'gzip DCHR v2; uint16 hundredths' },
    categories: ['<4 · Lower accumulated heat stress', '4–<8 · Bleaching-level heat stress', '8–<12 · Severe heat stress', '12–<16 · Very severe heat stress', '16–<20 · Extreme heat stress', '20+ · Exceptional heat stress']
  };
}

function queryTileForCenter() {
  const size = 256;
  const tileColumn = 14;
  const tileRow = 2;
  const column = 3599;
  const row = 705;
  const cellId = (row % size) * size + (column % size);
  const bytesPerCell = 38;
  const tile = Buffer.alloc(12 + size * size * bytesPerCell, 255);
  tile.write('DCHR', 0, 'ascii');
  tile.writeUInt8(2, 4);
  tile.writeUInt8(bytesPerCell, 5);
  tile.writeUInt16LE(size, 6);
  tile.writeUInt16LE(tileColumn, 8);
  tile.writeUInt16LE(tileRow, 10);
  const offset = 12 + cellId * bytesPerCell;
  [41, 10, 30, 8, 6, 3].forEach((value, index) => tile.writeUInt8(value, offset + index));
  tile.writeUInt16LE(2024, offset + 6);
  tile.writeUInt16LE(2024, offset + 8);
  tile.writeUInt16LE(1760, offset + 10);
  tile.writeUInt16LE(2024, offset + 12);
  tile.writeUInt16LE(3020, offset + 14);
  tile.writeUInt16LE(2015, offset + 16);
  [100, 300, 500, 800, 1100, 1200, 400, 1300, 1760, 500].forEach((value, index) => tile.writeUInt16LE(value, offset + 18 + index * 2));
  return tile;
}

async function openReefCondition(page, testInfo) {
  await openMap(page, { url: '/?__diveatlas_test=1&lat=0&lng=0&z=3' });
  if (testInfo.project.name.includes('mobile')) {
    if (await page.locator('#bioLegend').evaluate(element => element.classList.contains('is-collapsed'))) await page.locator('#bioLegendTitle').click();
    await page.locator('.environment-segment-group').evaluate(group => { group.scrollLeft = group.scrollWidth; });
  }
  await page.locator('.environment-segment').filter({ has: page.locator('input[name="environmentView"][value="reef-survey-condition"]') }).click();
  if (await page.locator('#bioLegend').evaluate(element => element.classList.contains('is-collapsed'))) {
    await page.locator('#bioLegendTitle').click();
  }
}

test('Ocean heat resolution follows the selected length unit', async ({ page }, testInfo) => {
  await openReefCondition(page, testInfo);
  await page.locator('#reefSurveyMetric').selectOption('oceanHeatHistory');
  await expect(page.locator('[data-reef-condition-raster-legend]')).toContainText('OCEAN HEAT HISTORY');
  await openMobileSettings(page);
  await page.locator('#measurementUnitSwitch [data-length-unit="ft"]').click();
  await expect(page.locator('[data-reef-condition-raster-resolution]')).toHaveText('15.5 mi');
});

test('Thermal stress history is a lazy Reef Condition metric, not a standalone current view', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const requests = [];
  const metadata = thermalHistoryMetadata();
  const queryTile = queryTileForCenter();
  let startOceanMetadataRequest;
  const oceanMetadataRequested = new Promise(resolve => { startOceanMetadataRequest = resolve; });
  let releaseOceanMetadata;
  const holdOceanMetadata = new Promise(resolve => { releaseOceanMetadata = resolve; });
  page.on('request', request => {
    if (/coral-heat-stress|thermal-stress-history|field-observations\.json/.test(request.url())) requests.push(request.url());
  });
  await page.route('**/data/reef-condition/field-observations.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }));
  await page.route('**/data/reef-condition/thermal-stress-history/metadata.json', async route => {
    requests.push('history-metadata');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(metadata) });
  });
  await page.route('**/data/reef-condition/thermal-stress-history/tiles/**', async route => {
    requests.push('history-tile');
    await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aQAAAABJRU5ErkJggg==', 'base64') });
  });
  await page.route('**/data/reef-condition/thermal-stress-history/query/**', async route => {
    requests.push('history-query');
    await route.fulfill({ status: 200, contentType: 'application/gzip', body: zlib.gzipSync(queryTile) });
  });
  await page.route('**/data/reef-condition/ocean-heat-history/metadata.json', async route => {
    startOceanMetadataRequest();
    await holdOceanMetadata;
    await route.fallback();
  });

  await openReefCondition(page, testInfo);
  await oceanMetadataRequested;
  await expect(page.locator('#reefSurveyMetric')).toBeVisible();
  await expect(page.locator('#reefConditionProvider')).toHaveCount(0);
  await expect(page.locator('input[name="environmentView"][value="coral-heat-stress"]')).toHaveCount(0);
  await expect(page.locator('#coralHeatStressControls')).toBeHidden();
  expect(requests.some(url => String(url).includes('thermal-stress-history'))).toBe(false);
  await expect(page.locator('[data-reef-survey-legend]')).toContainText('Ocean heat history');

  await page.locator('#reefSurveyMetric').selectOption('thermalStressHistory');
  await expect(page.locator('[data-reef-condition-raster-legend]')).toContainText('THERMAL STRESS HISTORY');
  // Resolve the slower initial provider after the new metric is already shown.
  // Its stale completion must not replace the active metric's legend.
  const oceanMetadataResponsePromise = page.waitForResponse(response => response.url().includes('/ocean-heat-history/metadata.json'));
  releaseOceanMetadata();
  const oceanMetadataResponse = await oceanMetadataResponsePromise;
  expect(oceanMetadataResponse.ok()).toBe(true);
  await expect(page.locator('[data-reef-condition-raster-legend]')).toContainText('THERMAL STRESS HISTORY');
  await expect(page.locator('[data-reef-condition-raster-legend]')).toContainText('DHW (°C-weeks)');
  await expect(page.locator('[data-reef-condition-raster-legend]')).toContainText('20+ · Exceptional');
  await expect.poll(() => requests.includes('history-tile')).toBe(true);
  await expect(page.locator('[data-reef-survey-error]')).toBeHidden();
  expect(requests.filter(item => item === 'history-metadata')).toHaveLength(1);
  expect(requests.some(url => String(url).includes('/data/coral-heat-stress/metadata.json'))).toBe(false);
  await expect(page.locator('.leaflet-control-attribution')).toContainText('NOAA Coral Reef Watch');
  await expect.poll(() => page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState().providerId)).toBe('noaa-crw-thermal-history');

  await page.getByRole('button', { name: 'Map layers' }).click();
  await page.evaluate(() => window.__DIVEATLAS_TEST__.map.fire('click', { latlng: window.L.latLng(0, 0) }));
  await expect.poll(() => requests.includes('history-query')).toBe(true);
  await expect(page.locator('.reef-condition-raster-popup')).toBeVisible();
  await expect(page.locator('.reef-condition-raster-popup')).toContainText('Thermal stress history');
  await expect(page.locator('.reef-condition-raster-popup')).toContainText('17.6 °C-weeks');
  await expect(page.locator('.reef-condition-raster-popup')).toContainText('2024');
  await expect(page.locator('.reef-condition-raster-popup')).toContainText('6 of 10 years');
  await expect(page.locator('.reef-condition-raster-popup')).toContainText('3 of 10 years');
  await expect(page.locator('.reef-condition-history-timeline')).toBeVisible();
  await expect(page.locator('.reef-condition-history-year')).toHaveCount(10);
  await expect(page.locator('.reef-condition-raster-popup')).toContainText('Environmental pressure');
  await expect(page.locator('.reef-condition-raster-popup')).not.toContainText('current reef condition');
  expect(requests.filter(item => item === 'history-query')).toHaveLength(1);
  const popupLayout = await page.locator('.leaflet-popup.coral-heat-stress-popup').evaluate(element => {
    const board = element.getBoundingClientRect();
    const content = element.querySelector('.reef-condition-raster-popup').getBoundingClientRect();
    const chart = element.querySelector('.reef-condition-history-chart').getBoundingClientRect();
    return { boardWidth: board.width, boardLeft: board.left, boardRight: board.right, contentLeft: content.left, contentRight: content.right, chartRight: chart.right };
  });
  expect(popupLayout.boardWidth).toBeGreaterThan(210);
  expect(popupLayout.boardWidth).toBeCloseTo(testInfo.project.name.includes('mobile') ? 320 : 360, 0);
  expect(popupLayout.contentLeft).toBeGreaterThanOrEqual(popupLayout.boardLeft);
  expect(popupLayout.contentRight).toBeLessThanOrEqual(popupLayout.boardRight);
  expect(popupLayout.chartRight).toBeLessThanOrEqual(popupLayout.boardRight);

  await openTopMenu(page);
  await page.locator('#temperatureUnitSwitch [data-temperature-unit="F"]').click();
  await closeTopMenu(page);
  await expect(page.locator('[data-reef-condition-raster-legend]')).toContainText('DHW (°F-weeks)');
  await expect(page.locator('[data-reef-condition-raster-legend]')).toContainText('7.2–<14.4 · Bleaching');
  await expect(page.locator('.reef-condition-raster-popup')).toContainText('31.7 °F-weeks');
  await expect(page.locator('.reef-condition-history-timeline')).toHaveAttribute('aria-label', /°F-weeks/u);
  await openTopMenu(page);
  await page.locator('#measurementUnitSwitch [data-length-unit="ft"]').click();
  await closeTopMenu(page);
  await expect(page.locator('[data-reef-condition-raster-resolution]')).toHaveText('3.1 mi');

  const ensurePanelExpanded = async () => {
    const panel = page.locator('#bioLegend');
    if (await panel.evaluate(element => element.classList.contains('is-collapsed'))) {
      await page.locator('#bioLegendTitle').click();
    }
    await page.locator('#bioLegendLayers').evaluate(element => { element.scrollTop = element.scrollHeight; });
  };
  const collapsePanel = async () => {
    if (!(await page.locator('#bioLegend').evaluate(element => element.classList.contains('is-collapsed')))) {
      await page.locator('#bioLegendTitle').click();
    }
    await expect(page.locator('#bioLegend')).toHaveClass(/is-collapsed/);
  };
  await ensurePanelExpanded();
  if (testInfo.project.name.includes('mobile') && await page.locator('#bioLegend').evaluate(element => element.classList.contains('is-collapsed'))) {
    await page.locator('#bioLegendTitle').click();
  }
  await page.locator('#reefConditionInfoDetails > summary').click();
  await expect(page.locator('#reefConditionInfoPopover')).toContainText('3.1 mi');
  await page.locator('#reefConditionInfoDetails > summary').click();
  if (testInfo.project.name.includes('mobile')) await page.locator('#bioLegendTitle').click();
  const historyInfo = page.locator('.reef-condition-history-info');
  const historyInfoButton = historyInfo.locator('summary');
  const historyInfoPopover = page.locator('#reefConditionHistoryInfoPopover');
  await expect(historyInfoPopover).toBeHidden();
  const infoControlMetrics = await historyInfoButton.evaluate(button => {
    const target = button.getBoundingClientRect();
    const circle = button.querySelector('span').getBoundingClientRect();
    const panelCircle = document.querySelector('#reefConditionInfoDetails > summary > span').getBoundingClientRect();
    const value = button.closest('.reef-condition-worst-value').querySelector('strong').getBoundingClientRect();
    const style = getComputedStyle(button);
    const circleStyle = getComputedStyle(button.querySelector('span'));
    return {
      targetWidth: target.width,
      targetHeight: target.height,
      circleWidth: circle.width,
      circleHeight: circle.height,
      panelCircleWidth: panelCircle.width,
      panelCircleHeight: panelCircle.height,
      targetGap: target.left - value.right,
      verticalCenterOffset: Math.abs((target.top + target.height / 2) - (value.top + value.height / 2)),
      color: style.color,
      borderColor: circleStyle.borderTopColor
    };
  });
  expect(infoControlMetrics).toMatchObject({
    targetWidth: 44,
    targetHeight: 44,
    color: 'rgb(104, 119, 138)',
    borderColor: 'rgb(154, 168, 184)'
  });
  expect(Math.abs(infoControlMetrics.circleWidth - infoControlMetrics.panelCircleWidth)).toBeLessThan(0.1);
  expect(Math.abs(infoControlMetrics.circleHeight - infoControlMetrics.panelCircleHeight)).toBeLessThan(0.1);
  expect(infoControlMetrics.targetGap).toBeGreaterThanOrEqual(0);
  expect(infoControlMetrics.targetGap).toBeLessThanOrEqual(2);
  expect(infoControlMetrics.verticalCenterOffset).toBeLessThan(2);
  await ensurePanelExpanded();
  if (testInfo.project.name.includes('mobile')) await collapsePanel();
  await historyInfoButton.click();
  await expect(historyInfoPopover).toBeVisible();
  await expect(historyInfoPopover).toContainText('6 of 10 years');
  await expect(historyInfoPopover).toContainText('54.4 °F-weeks');
  await expect(historyInfoPopover).toContainText('DHW ≥7.2 °F-weeks');
  await expect(page.locator('.reef-condition-raster-popup')).toBeVisible();
  await expect(page.locator('.reef-condition-raster-popup')).not.toContainText('6 of 10 years');
  await historyInfoButton.click();
  await expect(historyInfoPopover).toBeHidden();
  await page.locator('#languageMenuButton').click();
  await page.locator('#languageDropdown [data-language="zh"]').click();
  await closeTopMenu(page);
  await ensurePanelExpanded();
  await expect(page.locator('#reefSurveyConditionControls h2')).toHaveText('珊瑚礁状况');
  await expect(page.locator('[data-reef-condition-raster-legend]')).toContainText('珊瑚礁热压力历史');
  await expect(page.locator('.reef-condition-raster-popup')).toContainText('珊瑚礁热压力历史');
  await expect(page.locator('.reef-condition-raster-popup')).toContainText('31.7 °F-weeks');
  await expect(page.locator('[data-reef-condition-raster-resolution]')).toHaveText('3.1 mi');
  if (testInfo.project.name.includes('mobile')) await collapsePanel();
  await page.locator('.leaflet-popup .reef-condition-history-info > summary').click();
  await expect(page.locator('#reefConditionHistoryInfoPopover')).toContainText('严重热压力年份');
  await expect(page.locator('#reefConditionHistoryInfoPopover')).toContainText('54.4 °F-weeks');
  const reefLocales = {
    en: { panel: 'Reef Condition', metric: 'Environmental pressure', popup: 'Thermal stress history' },
    zh: { panel: '珊瑚礁状况', metric: '环境压力指标', popup: '珊瑚礁热压力历史' },
    ja: { panel: 'サンゴ礁の状態', metric: '環境ストレス指標', popup: 'サンゴ礁の熱ストレス履歴' },
    fr: { panel: 'État du récif', metric: 'Pression environnementale', popup: 'Historique du stress thermique' },
    de: { panel: 'Riffzustand', metric: 'Umweltdruck', popup: 'Verlauf des Hitzestresses' },
    nl: { panel: 'Rifconditie', metric: 'Milieudruk', popup: 'Geschiedenis van hittestress' },
    it: { panel: 'Condizione della barriera', metric: 'Pressione ambientale', popup: 'Storico dello stress termico' },
    ru: { panel: 'Состояние рифа', metric: 'Экологическое воздействие', popup: 'История теплового стресса' },
    pt: { panel: 'Condição do recife', metric: 'Pressão ambiental', popup: 'Histórico de estresse térmico' },
    sv: { panel: 'Revets tillstånd', metric: 'Miljöpåverkan', popup: 'Historik över värmestress' },
    no: { panel: 'Revens tilstand', metric: 'Miljøpåvirkning', popup: 'Historikk over varmestress' },
    es: { panel: 'Estado del arrecife', metric: 'Presión ambiental', popup: 'Historial del estrés térmico' },
    ko: { panel: '산호초 상태', metric: '환경 압력', popup: '열 스트레스 이력' },
    id: { panel: 'Kondisi terumbu', metric: 'Tekanan lingkungan', popup: 'Riwayat stres panas' }
  };
  for (const [language, copy] of Object.entries(reefLocales)) {
    await page.locator('#languageMenuButton').click();
    await page.locator(`#languageDropdown [data-language="${language}"]`).click();
    await ensurePanelExpanded();
    await expect(page.locator('#reefSurveyConditionControls h2')).toHaveText(copy.panel);
    await expect(page.locator('#environmentReefConditionLabel')).toHaveText(copy.panel);
    await expect(page.locator('#environmentViewSelect option[value="reef-survey-condition"]')).toHaveText(copy.panel);
    await expect(page.locator('#reefSurveyMetric optgroup')).toHaveAttribute('label', copy.metric);
    await expect(page.locator('[data-reef-condition-raster-legend]')).toContainText(copy.popup.toLocaleUpperCase());
    await expect(page.locator('.reef-condition-raster-popup')).toContainText(copy.popup);
    await expect(page.locator('.reef-condition-raster-popup')).toContainText(/31[.,]7 °F-weeks/u);
    if (testInfo.project.name.includes('mobile')) await collapsePanel();
    await page.locator('.leaflet-popup .reef-condition-history-info > summary').click();
    await expect(page.locator('#reefConditionHistoryInfoPopover')).toBeVisible();
    const layout = await page.evaluate(() => {
      const panel = document.querySelector('#reefSurveyConditionControls');
      const board = document.querySelector('.leaflet-popup.coral-heat-stress-popup');
      const content = board?.querySelector('.reef-condition-raster-popup');
      const chart = board?.querySelector('.reef-condition-history-chart');
      const boardRect = board?.getBoundingClientRect();
      const contentRect = content?.getBoundingClientRect();
      const chartRect = chart?.getBoundingClientRect();
      return {
        panelOverflow: panel.scrollWidth > panel.clientWidth,
        popupFitsBoard: !!boardRect && !!contentRect && contentRect.left >= boardRect.left && contentRect.right <= boardRect.right,
        chartFitsBoard: !!boardRect && !!chartRect && chartRect.right <= boardRect.right
      };
    });
    expect(layout).toEqual({ panelOverflow: false, popupFitsBoard: true, chartFitsBoard: true });
    await page.locator('.leaflet-popup .reef-condition-history-info > summary').click();
    if (testInfo.project.name.includes('mobile')) await ensurePanelExpanded();
    const legend = page.locator('#bioLegend');
    const isCollapsed = await legend.evaluate(element => element.classList.contains('is-collapsed'));
    if (!isCollapsed) await page.locator('#bioLegendTitle').click();
    await expect(page.locator('#bioLegendCollapsedSummary')).toHaveText(copy.panel);
    if (!isCollapsed) await page.locator('#bioLegendTitle').click();
  }
  await page.locator('.leaflet-popup-close-button').click();
  await expect(page.locator('.reef-condition-raster-popup')).toBeHidden();
});

test('missing historical summary is reported without loading field fixtures', async ({ page }, testInfo) => {
  await page.route('**/data/reef-condition/field-observations.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }));
  await page.route('**/data/reef-condition/thermal-stress-history/metadata.json', route => route.fulfill({ status: 404, body: 'missing' }));
  await openReefCondition(page, testInfo);
  await page.locator('#reefSurveyMetric').selectOption('thermalStressHistory');
  await expect(page.locator('[data-reef-survey-dataset-status]')).toHaveText('Unavailable');
  await expect(page.locator('[data-reef-survey-error]')).toBeVisible();
  const state = await page.evaluate(() => window.__DIVEATLAS_TEST__.getReefSurveyState());
  expect(state.providerId).toBe('noaa-crw-thermal-history');
  expect(state.layerVisible).toBe(false);
  await expect(page.locator('#reefSurveyMetric optgroup[label="Environmental pressure"] option')).toHaveCount(2);
  await expect(page.locator('#reefSurveyConditionControls')).toContainText('Unavailable');
});
