const test = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const { createCoralHeatStressHistoryView, validateMetadata } = require('../../js/coral-heat-history-view.js');

const years = [1985, 1986, 1987];
const metadata = {
  schema_version: 1, version: '3.7.0', release: 'v3.7.0', asset_base: 'data/coral-heat-stress/history/releases/v3.7.0',
  productVersion: '3.7.0', yearStart: years[0], yearEnd: years.at(-1), years,
  variable: 'ann_max_dhw', metric: 'Annual Maximum Degree Heating Week',
  grid: { width: 7200, height: 1390, longitude_min: -179.975, longitude_step: 0.05, latitude_min: -35.275, latitude_max: 34.175, latitude_step: 0.05 },
  encoding: { mapZoom: 5, pointTileSizeCells: 256, pointHeaderBytes: 17, pointRecordBytes: 14, mapTileTemplate: 'maps/{year}/{z}/{x}/{y}.png' },
  pointTileTemplate: 'points/{column}_{row}.bin.gz'
};
const mapMetadata = {
  schema_version: 1, version: 'pilot', release: 'pilot-test', asset_base: 'data/coral-heat-stress/history/global-maps/releases/pilot-test',
  product: 'NOAA Coral Reef Watch global annual maximum Degree Heating Week composite',
  variable: 'degree_heating_week', yearStart: 2016, yearEnd: 2025, years: Array.from({ length: 10 }, (_, i) => 2016 + i),
  grid: { width: 7200, height: 3600, longitude_min: -179.975, longitude_step: 0.05, latitude_min: -89.975, latitude_step: 0.05, row_order: 'north-to-south' },
  encoding: {
    mapZoom: 5, mapTileTemplate: 'maps/{year}/{z}/{x}/{y}.png', valueTileTemplate: 'values/{year}/{column}_{row}.bin.gz',
    valueTileSizeCells: 256, valueTileHeaderBytes: 17, valueTileBytesPerCell: 2, valueMissing: 65535, valueScaleFactor: 0.01
  }
};

function historyTile(values) {
  const payload = Buffer.alloc(17 + 2 + values.length * 4);
  payload.write('DCHH', 0, 'ascii');
  payload.writeUInt8(1, 4);
  payload.writeUInt16LE(256, 5);
  payload.writeUInt16LE(values.length, 7);
  payload.writeUInt16LE(0, 9);
  payload.writeUInt16LE(0, 11);
  payload.writeUInt32LE(1, 13);
  payload.writeUInt16LE(0, 17);
  values.forEach((value, index) => payload.writeFloatLE(value, 19 + index * 4));
  return gzipSync(payload);
}

function globalValueTile(latitude, longitude, value) {
  const row = Math.round((90 - 0.025 - latitude) / 0.05);
  const column = ((Math.round((longitude + 179.975) / 0.05) % 7200) + 7200) % 7200;
  const tileRow = Math.floor(row / 256);
  const tileColumn = Math.floor(column / 256);
  const localCell = (row % 256) * 256 + column % 256;
  const payload = Buffer.alloc(17 + 256 * 256 * 2);
  payload.write('DCHG', 0, 'ascii');
  payload.writeUInt8(1, 4);
  payload.writeUInt16LE(256, 5);
  payload.writeUInt16LE(tileColumn, 7);
  payload.writeUInt16LE(tileRow, 9);
  payload.writeUInt32LE(1, 13);
  for (let offset = 17; offset < payload.length; offset += 2) payload.writeUInt16LE(65535, offset);
  if (value !== null) payload.writeUInt16LE(Math.round(value * 100), 17 + localCell * 2);
  else payload.writeUInt16LE(1, 17 + ((localCell + 1) % (256 * 256)) * 2);
  return gzipSync(payload);
}

function fakeLeaflet() {
  const map = { layers: new Set(), hasLayer(layer) { return this.layers.has(layer); }, removeLayer(layer) { this.layers.delete(layer); } };
  const L = { tileLayer(url, options) {
    return {
      url, options, events: {}, on(name, callback) { this.events[name] = callback; return this; },
      addTo(target) { target.layers.add(this); queueMicrotask(() => this.events.load?.()); return this; }
    };
  } };
  return { L, map };
}

test('Thermal History is lazy, loads one selected-year layer, and returns exact annual point history', async () => {
  const requests = [];
  const { L, map } = fakeLeaflet();
  const api = createCoralHeatStressHistoryView({
    L, map,
    fetchImpl: async (url) => {
      requests.push(url);
      if (url.endsWith('global-maps/metadata.json')) return { ok: true, json: async () => mapMetadata };
      if (url.endsWith('history/metadata.json')) return { ok: true, json: async () => metadata };
      const bytes = historyTile([0, 1.1443, NaN]);
      return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    }
  });
  assert.equal(requests.length, 0);
  await api.activate(2025);
  assert.equal(api.state.activeYear, 2025);
  assert.match(api.state.enabled && map.layers.values().next().value.url, /maps\/2025\/\{z\}\/\{x\}\/\{y\}\.png/);
  const first = await api.sample(-35.275, -179.975);
  assert.deepEqual(first.years, years);
  assert.equal(first.values[0], 0);
  assert.ok(Math.abs(first.values[1] - 1.1443) < 1e-6);
  assert.ok(Number.isNaN(first.values[2]));
  await api.sample(-35.275, -179.975);
  assert.equal(requests.filter(url => url.includes('/points/')).length, 1);
  assert.equal(await api.sample(-35.275, -179.925), null);
  api.selectYear(2016);
  assert.equal(api.state.activeYear, 2016);
  for (const year of [2025, 2024, 2023, 2022]) api.selectYear(year);
  assert.equal(api.state.activeYear, 2022);
  assert.equal(api.state.cachedYears, 3);
  assert.deepEqual(api.state.cachedYearOrder, [2024, 2023, 2022]);
  api.deactivate();
  assert.equal(api.state.enabled, false);
});

test('Thermal History metadata rejects a DHW or coverage schema mismatch', () => {
  assert.equal(validateMetadata(metadata), metadata);
  assert.throws(() => validateMetadata({ ...metadata, variable: 'withinyear_mean' }), /incomplete or unsupported/);
  assert.throws(() => validateMetadata({ ...metadata, years: [1985, 1987] }), /incomplete or unsupported/);
});

test('a missing sparse point tile returns no point history so callers can use the global fallback', async () => {
  const requests = [];
  const { L, map } = fakeLeaflet();
  const api = createCoralHeatStressHistoryView({
    L, map,
    fetchImpl: async url => {
      requests.push(url);
      if (url.endsWith('global-maps/metadata.json')) return { ok: true, json: async () => mapMetadata };
      if (url.endsWith('history/metadata.json')) return { ok: true, json: async () => metadata };
      return { ok: false, status: 404 };
    }
  });
  await api.activate(2025);
  assert.equal(await api.sample(-35.275, -179.975), null);
  assert.equal(await api.sample(-35.275, -179.975), null);
  assert.equal(requests.filter(url => url.includes('/points/')).length, 1);
  api.deactivate();
});

test('global annual fallback returns cached 2016–2025 values, no-data gaps, and failed-year markers', async () => {
  const requests = [];
  const { L, map } = fakeLeaflet();
  const latitude = 17.975;
  const longitude = -65.975;
  const api = createCoralHeatStressHistoryView({
    L, map,
    fetchImpl: async url => {
      requests.push(url);
      if (url.endsWith('global-maps/metadata.json')) return { ok: true, json: async () => mapMetadata };
      const year = Number(url.match(/\/values\/(\d{4})\//)?.[1]);
      if (year === 2019) return { ok: false, status: 503 };
      const value = year === 2018 ? null : year === 2025 ? 12.34 : year - 2015;
      const bytes = globalValueTile(latitude, longitude, value);
      return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    }
  });
  await api.activate(2025);
  const result = await api.sampleGlobalHistory(2025, latitude, longitude);
  assert.equal(result.year, 2025);
  assert.equal(result.value, 12.34);
  assert.deepEqual(result.years, mapMetadata.years);
  assert.deepEqual(result.unavailableYears, [2019]);
  assert.ok(Number.isNaN(result.values[result.years.indexOf(2018)]));
  assert.ok(Number.isNaN(result.values[result.years.indexOf(2019)]));
  assert.equal(result.values[result.years.indexOf(2020)], 5);
  assert.equal(requests.filter(url => url.includes('/values/')).length, 10);

  const repeated = await api.sampleGlobalHistory(2025, latitude, longitude);
  assert.equal(repeated.value, result.value);
  assert.equal(requests.filter(url => url.includes('/values/')).length, 11);
  api.deactivate();
});

test('a failed selected-year global value request rejects the fallback lookup', async () => {
  const { L, map } = fakeLeaflet();
  const api = createCoralHeatStressHistoryView({
    L, map,
    fetchImpl: async url => {
      if (url.endsWith('global-maps/metadata.json')) return { ok: true, json: async () => mapMetadata };
      return { ok: false, status: 503 };
    }
  });
  await api.activate(2025);
  await assert.rejects(api.sampleGlobalHistory(2025, 17.975, -65.975), /Global annual DHW values unavailable/);
  api.deactivate();
});

test('a selected-year global tile with no value returns no fallback series', async () => {
  const { L, map } = fakeLeaflet();
  const api = createCoralHeatStressHistoryView({
    L, map,
    fetchImpl: async url => {
      if (url.endsWith('global-maps/metadata.json')) return { ok: true, json: async () => mapMetadata };
      const bytes = globalValueTile(17.975, -65.975, null);
      return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    }
  });
  await api.activate(2025);
  assert.equal(await api.sampleGlobalHistory(2025, 17.975, -65.975), null);
  api.deactivate();
});
