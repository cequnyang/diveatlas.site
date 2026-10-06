const test = require('node:test');
const assert = require('node:assert/strict');
const providerApi = require('../../js/reef-condition-provider.js');
const fixture = require('../fixtures/reef-condition/mock-raja-ampat.json');

test('provider kinds cover raster layers, field observations, and future models', () => {
  assert.deepEqual(Object.values(providerApi.PROVIDER_KINDS), [
    'raster-condition-layer', 'field-observations', 'future-model'
  ]);
  assert.equal(providerApi.createRasterConditionProvider({ load: async () => ({ url: 'tiles/{z}/{x}/{y}.png' }) }).kind, 'raster-condition-layer');
  assert.equal(providerApi.createFutureModelProvider({ load: async () => ({}) }).kind, 'future-model');
});

test('registry selects and loads only the active provider', async () => {
  const calls = [];
  const registry = providerApi.createProviderRegistry([
    providerApi.createProvider({ id: 'field', kind: providerApi.PROVIDER_KINDS.FIELD_OBSERVATIONS, load: async () => { calls.push('field'); return 'field-data'; } }),
    providerApi.createProvider({ id: 'model', kind: providerApi.PROVIDER_KINDS.FUTURE_MODEL, load: async () => { calls.push('model'); return 'model-data'; } })
  ]);

  assert.equal(registry.selectedId, 'field');
  assert.equal(await registry.load(), 'field-data');
  assert.equal(registry.select('unknown'), false);
  assert.equal(registry.select('model'), true);
  assert.equal(registry.selectedId, 'model');
  assert.equal(await registry.load(), 'model-data');
  assert.deepEqual(calls, ['field', 'model']);
});

test('field provider loads and validates a production canonical dataset from its configured path', async () => {
  const productionDataset = structuredClone(fixture);
  productionDataset.metadata.datasetType = 'production';
  const calls = [];
  const provider = providerApi.createFieldObservationsProvider({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => productionDataset };
    }
  });
  const loaded = await provider.load();

  assert.equal(providerApi.DEFAULT_FIELD_DATASET_URL, './data/reef-condition/field-observations.json');
  assert.deepEqual(calls.map(call => call.url), [providerApi.DEFAULT_FIELD_DATASET_URL]);
  assert.equal(loaded.kind, 'field-observations');
  assert.equal(loaded.dataset.metadata.datasetType, 'production');
  assert.equal(loaded.dataset.records.length, fixture.records.length);
});

test('missing production dataset rejects without trying mock or local pilot paths', async () => {
  const calls = [];
  const provider = providerApi.createFieldObservationsProvider({
    fetchImpl: async url => {
      calls.push(url);
      return { ok: false, status: 404 };
    }
  });

  await assert.rejects(provider.load(), /dataset is unavailable \(404\)/);
  assert.deepEqual(calls, ['./data/reef-condition/field-observations.json']);
  assert.equal(calls.some(url => /mock|\.build|mermaid/i.test(url)), false);
});

test('provider rejects invalid canonical datasets rather than displaying unvalidated records', async () => {
  const invalid = structuredClone(fixture);
  invalid.records[0].protocols[0].metrics.liveCoralCover.valuePct = 101;
  const provider = providerApi.createFieldObservationsProvider({
    fetchImpl: async () => ({ ok: true, json: async () => invalid })
  });
  await assert.rejects(provider.load(), /Invalid Reef Survey dataset/);
});

function historyMetadata(overrides = {}) {
  return {
    schema_version: 1,
    provider: 'NOAA Coral Reef Watch',
    product: 'Thermal History Annual History',
    productVersion: '3.7.0',
    sourceUrl: 'https://www.coralreefwatch.noaa.gov/product/thermal_history/annual_history.php',
    sourceMetadata: 'Annual maximum DHW summaries.',
    attribution: 'NOAA Coral Reef Watch',
    variable: 'ann_max_dhw',
    units: 'degrees_Celsius-weeks',
    periods: { fullStart: 1985, fullEnd: 2025, recentStart: 2016, recentEnd: 2025 },
    thresholds: [4, 8, 12, 16, 20],
    recentYears: 10,
    asset_base: 'data/reef-condition/thermal-stress-history',
    map_tile_template: 'tiles/{z}/{x}/{y}.png',
    query_tile_template: 'query/{column}_{row}.bin.gz',
    version: 'crw-3.7.0-1985-2025',
    grid: { width: 7200, height: 1390, longitude_min: -179.975, longitude_step: 0.05, latitude_min: -35.275, latitude_step: 0.05, row_order: 'south-to-north' },
    encoding: { map_zoom: 5, query_tile_size_cells: 256, query_bytes_per_cell: 38,
      query_format: 'gzip DCHR v2; yearly counts, full/recent extrema, and ten recent annual DHW values as uint16 hundredths' },
    categories: ['<4 · Lower accumulated heat stress', '4–<8 · Bleaching-level heat stress', '8–<12 · Severe heat stress', '12–<16 · Very severe heat stress', '16–<20 · Extreme heat stress', '20+ · Exceptional heat stress'],
    ...overrides
  };
}

test('NOAA Thermal History metadata validates source periods and annual DHW semantics', () => {
  const metadata = historyMetadata();
  const normalized = providerApi.validateNoaaThermalHistoryMetadata(metadata);
  assert.deepEqual(normalized.periods, { fullStart: 1985, fullEnd: 2025, recentStart: 2016, recentEnd: 2025 });
  assert.equal(normalized.variable, 'ann_max_dhw');
  assert.equal(normalized.productVersion, '3.7.0');
  assert.equal(normalized.queryBytesPerCell, 38);
  assert.match(metadata.encoding.query_format, /^gzip DCHR v2/);
  assert.equal(metadata.recentYears, 10);
  assert.match(metadata.encoding.query_format, /ten recent annual DHW values/);
});

test('NOAA Thermal History provider loads lazily only when selected by Reef Condition', async () => {
  const calls = [];
  const api = providerApi.createNoaaThermalHistoryProvider({ fetchImpl: async url => {
    calls.push(url);
    return { ok: true, json: async () => historyMetadata() };
  } });
  const registry = providerApi.createProviderRegistry([
    providerApi.createFieldObservationsProvider({ fetchImpl: async () => { throw new Error('field provider should not load'); } }),
    api
  ]);
  assert.equal(api.id, 'noaa-crw-thermal-history');
  assert.deepEqual(calls, []);
  assert.equal(registry.selectedId, 'field-observations');
  registry.select('noaa-crw-thermal-history');
  const loaded = await registry.load();
  assert.deepEqual(calls, [providerApi.DEFAULT_NOAA_HISTORY_METADATA_URL]);
  assert.equal(loaded.kind, providerApi.PROVIDER_KINDS.RASTER_CONDITION);
  assert.equal(loaded.raster.periods.recentStart, 2016);
  assert.equal(loaded.raster.thresholds[1], 8);
});

test('NOAA Thermal History provider fails gracefully when static metadata is unavailable or malformed', async () => {
  const unavailable = providerApi.createNoaaThermalHistoryProvider({ fetchImpl: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(unavailable.load(), /NOAA thermal-history raster is unavailable \(404\)/);
  const malformed = providerApi.createNoaaThermalHistoryProvider({ fetchImpl: async () => ({ ok: true, json: async () => historyMetadata({ periods: { fullStart: 2010, fullEnd: 2025, recentStart: 2000, recentEnd: 2025 } }) }) });
  await assert.rejects(malformed.load(), /metadata is incomplete or unsupported/);
});

test('NOAA Marine Heatwave provider validates and lazily loads the production period and categories', async () => {
  const metadata = require('../fixtures/reef-condition/noaa-mhw-history-metadata.json');
  const calls = [];
  const provider = providerApi.createNoaaMhwHistoryProvider({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => metadata };
    }
  });
  const registry = providerApi.createProviderRegistry([
    providerApi.createFieldObservationsProvider({ fetchImpl: async () => { throw new Error('field provider is not selected'); } }),
    providerApi.createNoaaThermalHistoryProvider({ fetchImpl: async () => { throw new Error('reef DHW provider is not selected'); } }),
    provider
  ]);

  assert.equal(provider.id, 'noaa-crw-ocean-heat-history');
  assert.deepEqual(calls, []);
  assert.equal(registry.selectedId, 'field-observations');
  registry.select(provider.id);
  const loaded = await registry.load();
  assert.deepEqual(calls.map(call => call.url), [providerApi.DEFAULT_NOAA_MHW_HISTORY_METADATA_URL]);
  assert.equal(loaded.kind, providerApi.PROVIDER_KINDS.RASTER_CONDITION);
  assert.deepEqual(
    loaded.raster.categories.map(category => category.label),
    ['No marine heatwave', 'Moderate', 'Strong', 'Severe', 'Extreme', 'Beyond extreme']
  );
  assert.deepEqual(loaded.raster.sourcePeriod, metadata.sourcePeriod);
  assert.equal(loaded.raster.productVersion, '1.0.1');
  assert.equal(loaded.raster.query.tileSizeCells, 128);
  assert.equal(loaded.raster.query.bytesPerCell, 15);
});

test('NOAA Marine Heatwave provider fails safely for unavailable or unsupported production metadata', async () => {
  const unavailable = providerApi.createNoaaMhwHistoryProvider({ fetchImpl: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(unavailable.load(), /NOAA ocean heat-history raster is unavailable \(404\)/);
  const metadata = require('../fixtures/reef-condition/noaa-mhw-history-metadata.json');
  const malformed = providerApi.createNoaaMhwHistoryProvider({ fetchImpl: async () => ({
    ok: true, json: async () => ({ ...metadata, sourcePeriod: { ...metadata.sourcePeriod, endYear: 2024 } })
  }) });
  await assert.rejects(malformed.load(), /metadata is incomplete or unsupported/);
});
