const test = require('node:test');
const assert = require('node:assert/strict');
const { currentSpeed, currentBearing, currentDirection } = require('../../js/current-math.js');
const { decodeTile, LruTileCache, tileCacheKey, HEADER_BYTES, MISSING_VALUE } = require('../../js/current-tile-cache.js');
const { visibleTileAddresses, viewportTileAddresses, tierForZoom } = require('../../js/regional-currents.js');
const { createCurrentView } = require('../../js/regional-currents.js');
const { gzipSync } = require('node:zlib');

test('current speed and direction use components toward which the water flows', () => {
  assert.equal(currentSpeed(0.3, 0.4), 0.5);
  assert.equal(currentSpeed(Number.NaN, 1), null);
  assert.equal(currentBearing(1, 0), 90);
  assert.equal(currentDirection(1, 0), 'E');
  assert.equal(currentDirection(0, 1), 'N');
  assert.equal(currentDirection(1, 1), 'NE');
  assert.equal(currentDirection(-1, 1), 'NW');
  assert.equal(currentDirection(-1, -1), 'SW');
  assert.equal(currentDirection(1, -1), 'SE');
  assert.equal(currentDirection(0, 0), null);
});

test('query-only current sampling uses the finest shipped tile and preserves masked cells', async () => {
  const metadata = {
    data_format_version: 1, grid: { width: 4320, height: 2041, longitude_min: -180, longitude_step: 1 / 12, latitude_max: 90, latitude_step: 1 / 12 },
    zooms: [{ min_zoom: 2, max_zoom: 4, step: 32 }, { min_zoom: 5, max_zoom: 7, step: 8 }, { min_zoom: 8, max_zoom: 22, step: 4 }],
    tile_size: 128, asset_base: 'data/currents', tile_template: 'v1/{month}/{depth}/s{step}/{column}_{row}.bin.gz',
    available_slices: [{ month: 9, depth_label: '10m' }], quantization: { scale_m_s: 1 }, version: 'fixture'
  };
  const makeTile = stored => {
    const bytes = Buffer.alloc(16 + 128 * 128 * 4);
    bytes.write('DATC', 0); bytes.writeUInt8(1, 4); bytes.writeUInt8(7, 5); bytes.writeUInt8(4, 6);
    bytes.writeUInt16LE(1, 8); bytes.writeUInt16LE(128, 10); bytes.writeUInt16LE(0, 12); bytes.writeUInt16LE(0, 14);
    bytes.writeInt16LE(stored, 16); bytes.writeInt16LE(0, 18);
    return gzipSync(bytes);
  };
  const requested = [];
  let storedValue = 100;
  const fetchImpl = async url => {
    requested.push(String(url));
    return requested.length === 1
      ? new Response(JSON.stringify(metadata), { status: 200 })
      : new Response(makeTile(storedValue), { status: 200 });
  };
  const view = createCurrentView({ L: {}, map: {}, fetchImpl });
  const result = await view.sample(90, -180, 9, '10');
  assert.equal(result.speed, 0.1);
  assert.match(requested[1], /\/s4\/0_0\.bin\.gz/);
  storedValue = MISSING_VALUE;
  const maskedView = createCurrentView({ L: {}, map: {}, fetchImpl: async url => {
    if (String(url).endsWith('metadata.json')) return new Response(JSON.stringify(metadata), { status: 200 });
    return new Response(makeTile(storedValue), { status: 200 });
  } });
  assert.equal(await maskedView.sample(90, -180, 9, '10'), null);
});

test('direction rounds into all eight compass sectors, including negative components', () => {
  assert.deepEqual([
    currentDirection(0, 1), currentDirection(1, 1), currentDirection(1, 0), currentDirection(1, -1),
    currentDirection(0, -1), currentDirection(-1, -1), currentDirection(-1, 0), currentDirection(-1, 1)
  ], ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
});

function encodeTile({ step = 8, row = 1, column = 3, width = 4, height = 4 } = {}) {
  const size = 2 ** 7;
  const buffer = new ArrayBuffer(HEADER_BYTES + size * size * 4);
  const bytes = new Uint8Array(buffer);
  bytes.set([68, 65, 84, 67]);
  const view = new DataView(buffer);
  view.setUint8(4, 1);
  view.setUint8(5, 7);
  view.setUint8(6, step);
  view.setUint16(8, 1, true);
  view.setUint16(10, size, true);
  view.setUint16(12, row, true);
  view.setUint16(14, column, true);
  const samples = new Int16Array(buffer, HEADER_BYTES);
  samples[0] = 321;
  samples[1] = -123;
  samples[2] = MISSING_VALUE;
  samples[3] = MISSING_VALUE;
  return buffer;
}

test('tile decoder checks header, address, payload, quantization, and no-data distinctly', () => {
  const tile = decodeTile(encodeTile(), { tileSize: 128, step: 8, row: 1, column: 3 });
  assert.equal(tile.samples[0] * tile.scale, 0.321);
  assert.equal(tile.samples[1] * tile.scale, -0.123);
  assert.notEqual(tile.samples[0], 0);
  assert.equal(tile.samples[2], MISSING_VALUE);
  assert.throws(() => decodeTile(encodeTile(), { tileSize: 128, step: 4, row: 1, column: 3 }), /header/);
  assert.throws(() => decodeTile(encodeTile().slice(0, 32), { tileSize: 128, step: 8, row: 1, column: 3 }), /length/);
});

test('tile cache keys include dataset version, month, depth, stride, and coordinates', () => {
  const base = { version: 'dataset-v1', month: 9, depth: '20', step: 8, column: 3, row: 1 };
  assert.notEqual(tileCacheKey(base), tileCacheKey({ ...base, month: 10 }));
  assert.notEqual(tileCacheKey(base), tileCacheKey({ ...base, depth: '30' }));
  assert.notEqual(tileCacheKey(base), tileCacheKey({ ...base, column: 4 }));
  assert.notEqual(tileCacheKey(base), tileCacheKey({ ...base, version: 'dataset-v2' }));
});

test('LRU current tile cache reuses recent blocks and evicts the oldest block at its bound', () => {
  const cache = new LruTileCache(2);
  cache.set('month9/surface/a', 1);
  cache.set('month9/surface/b', 2);
  assert.equal(cache.get('month9/surface/a'), 1);
  cache.set('month10/20/c', 3);
  assert.equal(cache.get('month9/surface/b'), undefined);
  assert.equal(cache.size, 2);
});

test('viewport picks only blocks intersecting the visible regular grid and zoom tiers are bounded', () => {
  const bounds = { getWest: () => 0, getEast: () => 10, getSouth: () => 0, getNorth: () => 10 };
  const metadata = {
    tile_size: 128,
    grid: { width: 4320, height: 2041, longitude_min: -180, latitude_min: -80, latitude_max: 90, longitude_step: 1 / 12, latitude_step: 1 / 12 }
  };
  const tier = { min_zoom: 5, max_zoom: 7, step: 8 };
  assert.deepEqual(visibleTileAddresses(bounds, tier, metadata, 5).map(({ column, row }) => [column, row]), [[2, 0], [2, 1]]);
  assert.deepEqual(tierForZoom([{ min_zoom: 2, max_zoom: 4 }, { min_zoom: 5, max_zoom: 7 }], 4), { min_zoom: 2, max_zoom: 4 });
  assert.equal(tierForZoom([{ min_zoom: 2, max_zoom: 4 }], 1), null);
});

test('viewport selection wraps both sides of the antimeridian onto the global edge tiles', () => {
  const bounds = { getWest: () => 170, getEast: () => 190, getSouth: () => -2, getNorth: () => 2 };
  const metadata = {
    tile_size: 128,
    grid: { width: 4320, height: 2041, longitude_min: -180, latitude_min: -80, latitude_max: 90, longitude_step: 1 / 12, latitude_step: 1 / 12 }
  };
  const tier = { min_zoom: 2, max_zoom: 4, step: 16 };
  const addresses = viewportTileAddresses(bounds, tier, metadata, 180);
  assert.ok(addresses.some(address => address.column === 0));
  assert.ok(addresses.some(address => address.column === 2));
  assert.equal(new Set(addresses.map(address => `${address.column}/${address.row}`)).size, addresses.length);
});
