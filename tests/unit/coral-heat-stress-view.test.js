const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createCoralHeatStressView } = require('../../js/coral-heat-stress-view.js');

const metadata = {
  schema_version: 1, version: '20260928-p1', asset_base: 'data/coral-heat-stress/releases/20260928-p1',
  productVersion: '3.1', dataDate: '2026-09-28', attribution: 'NOAA Coral Reef Watch',
  classification: { scheme: 'NOAA CRW revised BAA classification', effectiveSince: '2023-12-15', min: 0, max: 7 },
  grid: { width: 4, height: 4, longitude_min: -0.2, longitude_step: 0.1, latitude_min: -0.2, latitude_step: 0.1 },
  encoding: { missing: 255, query_bytes_per_cell: 5, query_tile_size_cells: 2, map_zoom: 5, max_native_zoom: 5 },
  map_tile_template: 'tiles/{z}/{x}/{y}.png', query_tile_template: 'query/{column}_{row}.bin.gz'
};

function queryTile(column, row) {
  const payload = Buffer.alloc(12 + 2 * 2 * 5, 255);
  payload.write('DCHS', 0, 'ascii');
  payload.writeUInt8(1, 4); payload.writeUInt8(5, 5);
  payload.writeUInt16LE(2, 6); payload.writeUInt16LE(column, 8); payload.writeUInt16LE(row, 10);
  payload.writeUInt8(5, 12);
  payload.writeInt16LE(120, 13); payload.writeInt16LE(1300, 15);
  return zlib.gzipSync(payload);
}

function createMap() {
  const attached = new Set(); const layers = [];
  const map = { hasLayer: layer => attached.has(layer), addLayer(layer) { attached.add(layer); }, removeLayer(layer) { attached.delete(layer); } };
  const L = { tileLayer(url, options) {
    const events = {};
    const layer = { url, options, on(name, callback) { events[name] = callback; return this; }, addTo(target) { target.addLayer(this); return this; } };
    layers.push(layer); return layer;
  } };
  return { L, map, layers };
}

test('Heat Stress stays lazy, decodes category 5, and reuses metadata and point chunks after toggles', async () => {
  const { L, map, layers } = createMap();
  const requests = [];
  const view = createCoralHeatStressView({
    L, map,
    fetchImpl: async url => {
      requests.push(url);
      if (url.endsWith('/metadata.json')) return Response.json(metadata);
      return new Response(queryTile(1, 1));
    }
  });
  assert.equal(await view.sample(0, 0), null);
  assert.equal(requests.length, 0);
  view.activate();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(layers.length, 1);
  assert.match(layers[0].url, /tiles\/\{z\}\/\{x\}\/\{y\}\.png/);
  const sample = await view.sample(0, 0);
  assert.deepEqual(sample, { category: 5, hotspot_c: 1.2, dhw_c_weeks: 13, source_latitude: 0, source_longitude: 0 });
  assert.equal(requests.filter(url => url.endsWith('/metadata.json')).length, 1);
  assert.equal(requests.filter(url => url.includes('/query/')).length, 1);
  view.deactivate();
  assert.equal(map.hasLayer(layers[0]), false);
  view.activate();
  await new Promise(resolve => setImmediate(resolve));
  await view.sample(0, 0);
  assert.equal(requests.filter(url => url.endsWith('/metadata.json')).length, 1);
  assert.equal(requests.filter(url => url.includes('/query/')).length, 1);
});

test('Heat Stress metadata rejects an unsupported classification contract', async () => {
  const { L, map, layers } = createMap();
  const states = [];
  const view = createCoralHeatStressView({ L, map, onStatus: status => states.push(status.state), fetchImpl: async () => Response.json({ ...metadata, classification: { ...metadata.classification, max: 4 } }) });
  view.activate();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(states, ['loading-metadata', 'unavailable']);
  assert.equal(layers.length, 0);
});
