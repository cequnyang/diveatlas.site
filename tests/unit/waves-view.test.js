const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createWavesView, normalizeLongitude } = require('../../js/waves-view.js');

const metadata = {
  schema_version: 1,
  version: 'test-v1',
  asset_base: 'data/waves',
  available_months: Array.from({ length: 12 }, (_, index) => index + 1),
  climatology_period: '1993-2020',
  grid: { width: 1800, height: 899, longitude_min: -180, longitude_step: 0.2, latitude_min: -89.8, latitude_step: 0.2, resolution_degrees: 0.2 },
  encoding: { query_tile_size_cells: 128, map_zoom: 3, max_native_zoom: 3 },
  map: { tile_template: 'tiles/{month}/{z}/{x}/{y}.png' },
  query: { tile_template: 'query/{month}/{column}_{row}.bin.gz' },
  variables: {
    height: { scale_factor: 0.01 },
    mean_period: { scale_factor: 0.01 }
  },
  attribution: 'Copernicus Marine'
};

function queryTile({ height = 0, period = 456, column = 0, row = 0 } = {}) {
  const bytes = Buffer.alloc(16 + 128 * 128 * 4);
  bytes.write('DATW', 0, 'ascii');
  bytes.writeUInt8(1, 4);
  bytes.writeUInt8(2, 5);
  bytes.writeUInt16LE(128, 8);
  bytes.writeUInt16LE(column, 10);
  bytes.writeUInt16LE(row, 12);
  bytes.writeInt16LE(height, 16);
  bytes.writeInt16LE(period, 18);
  return zlib.gzipSync(bytes);
}

function createMap() {
  const attached = new Set();
  const layers = [];
  const map = {
    hasLayer: layer => attached.has(layer),
    addLayer(layer) { attached.add(layer); },
    removeLayer(layer) { attached.delete(layer); },
    attached,
    layers
  };
  const L = {
    tileLayer(url, options) {
      const handlers = {};
      const layer = {
        url, options, handlers,
        on(event, callback) { handlers[event] = callback; return this; },
        addTo(target) { target.addLayer(this); return this; }
      };
      layers.push(layer);
      return layer;
    }
  };
  return { L, map };
}

test('Waves query sampling works without activating or attaching its map layer', async () => {
  const { L, map } = createMap();
  const requests = [];
  const view = createWavesView({
    L, map,
    metadataLoader: async () => metadata,
    fetchImpl: async url => {
      requests.push(url);
      return new Response(queryTile(), { status: 200 });
    }
  });

  const sample = await view.sample(89.8, 180, 1);
  assert.equal(sample.height_m, 0);
  assert.equal(sample.mean_period_s, 4.5600000000000005);
  assert.equal(requests.length, 1);
  assert.equal(map.layers.length, 0);
  assert.match(requests[0], /query\/01\/0_0\.bin\.gz/);
  assert.equal(normalizeLongitude(180), -180);
  assert.equal(normalizeLongitude(-180), -180);
  const annual = await view.sampleYear(89.8, -180);
  assert.deepEqual(annual.map(point => point.month), Array.from({ length: 12 }, (_, index) => index + 1));
  assert.equal(annual.every(point => point.value_m === 0), true);
  assert.equal(requests.length, 12);
  assert.equal(map.attached.size, 0);
  assert.equal(await view.sample(-90, 0, 1), null);
});

test('a month selected during metadata load wins and stale tile events are ignored', async () => {
  const { L, map } = createMap();
  const statuses = [];
  let resolveMetadata;
  const view = createWavesView({
    L, map,
    metadataLoader: () => new Promise(resolve => { resolveMetadata = resolve; }),
    onStatus: status => statuses.push(status)
  });
  view.activate(9);
  await Promise.resolve();
  view.selectMonth(2);
  resolveMetadata(metadata);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(map.layers.length, 1);
  assert.match(map.layers[0].url, /tiles\/02\//);
  const newestLayer = map.layers[0];
  view.selectMonth(3);
  const staleLayer = newestLayer;
  staleLayer.handlers.load();
  assert.equal(statuses.at(-1).state, 'loading');
  map.layers.at(-1).handlers.load();
  assert.equal(statuses.at(-1).state, 'ready');
  assert.equal(statuses.at(-1).month, 3);
  view.deactivate();
});

test('query preserves missing cells and reports failed static tiles for retry', async () => {
  const { L, map } = createMap();
  let tileResponse = queryTile({ height: -32768, period: -32768 });
  const statuses = [];
  const view = createWavesView({
    L, map, metadataLoader: async () => metadata,
    onStatus: status => statuses.push(status),
    fetchImpl: async () => new Response(tileResponse, { status: 200 })
  });
  view.activate(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await view.sample(89.8, -180, 1), null);
  view.deactivate();
  assert.equal(await view.retry(), false);
  assert.equal(statuses.at(-1).state, 'off');
});
