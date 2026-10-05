const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const { test } = require('node:test');

async function loadModule(path) {
  return import(`${path}?test=${Math.random().toString(36).slice(2)}`);
}

function buildChunk({ lat0 = 44.875, lon0 = -125.125, invalidCell = -1 } = {}) {
  const rows = 3, columns = 3, constituentCount = 17, recordSize = 1 + constituentCount * 8;
  const buffer = Buffer.alloc(28 + rows * columns * recordSize);
  buffer.write('EOT1', 0, 'ascii');
  buffer.writeUInt8(1, 4);
  buffer.writeUInt8(constituentCount, 5);
  buffer.writeUInt16LE(rows, 6);
  buffer.writeUInt16LE(columns, 8);
  buffer.writeUInt16LE(recordSize, 10);
  buffer.writeDoubleLE(lat0, 12);
  buffer.writeDoubleLE(lon0, 20);
  for (let cell = 0; cell < rows * columns; cell += 1) {
    const offset = 28 + cell * recordSize;
    buffer.writeUInt8(cell === invalidCell ? 0 : 1, offset);
    for (let index = 0; index < constituentCount; index += 1) {
      buffer.writeFloatLE(100 + index, offset + 1 + index * 8);
      buffer.writeFloatLE(-2, offset + 5 + index * 8);
    }
  }
  return gzipSync(buffer);
}

function mockFetch({ invalidCell = -1, missingChunk = false } = {}) {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async input => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith('manifest.json')) {
      return new Response(JSON.stringify({ chunkTemplate: 'coeff/{ty}_{tx}.bin.gz' }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }
    if (missingChunk) return new Response('', { status: 404 });
    const match = /coeff\/(\d+)_(\d+)\.bin\.gz/.exec(url);
    if (!match) return new Response('', { status: 404 });
    const ty = Number(match[1]), tx = Number(match[2]);
    const lon0 = tx === 71 ? 179.875 : tx === 0 ? -180.125 : -125.125;
    const lat0 = ty === 18 ? -0.125 : 44.875;
    return new Response(buildChunk({ lat0, lon0, invalidCell }), { status: 200 });
  };
  return { requests, restore: () => { global.fetch = originalFetch; } };
}

test('astronomical predictions are deterministic and independent of browser timezone', async () => {
  const { predictHarmonic } = await loadModule('../../js/tides/astronomy.js');
  const coefficients = Array.from({ length: 17 }, (_, index) => [index * 4 - 12, index / 3]);
  const timestamp = Date.parse('2026-09-30T12:00:00Z');
  const originalZone = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  const berlinValue = predictHarmonic(coefficients, timestamp);
  process.env.TZ = 'Pacific/Auckland';
  const aucklandValue = predictHarmonic(coefficients, timestamp);
  if (originalZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalZone;
  assert.equal(berlinValue, aucklandValue);
  assert.equal(berlinValue, predictHarmonic(coefficients, timestamp));
  assert.ok(Number.isFinite(berlinValue));
});

test('turning points are ordered and labeled as height extrema only', async () => {
  const { findTideExtrema } = await loadModule('../../js/tides/runtime.js');
  const values = [0, 1, 0, -1, 0, 2, 1].map((level_m, index) => ({ time_utc: index * 600_000, level_m }));
  assert.deepEqual(findTideExtrema(values).map(({ kind, time_utc }) => [kind, time_utc]), [
    ['high', 600_000], ['low', 1_800_000], ['high', 3_000_000]
  ]);
});

test('nearby locations reuse the coefficient chunk and interpolate all constituents', async () => {
  const mock = mockFetch();
  try {
    const { resolveCoefficients } = await loadModule('../../js/tides/model-loader.js');
    const first = await resolveCoefficients(44.9, -124.95);
    const nearby = await resolveCoefficients(44.92, -124.91);
    assert.equal(first.coefficients.length, 17);
    assert.equal(nearby.coefficients.length, 17);
    assert.ok(first.coefficients.every(([real, imaginary]) => Number.isFinite(real) && Number.isFinite(imaginary)));
    assert.equal(mock.requests.filter(url => url.includes('/coeff/')).length, 1);
  } finally { mock.restore(); }
});

test('land, missing tiles, and both sides of the longitude seam fail or resolve safely', async () => {
  const land = mockFetch({ invalidCell: 1 });
  try {
    const { resolveCoefficients } = await loadModule('../../js/tides/model-loader.js');
    assert.equal(await resolveCoefficients(44.9, -124.95), null);
  } finally { land.restore(); }

  const missing = mockFetch({ missingChunk: true });
  try {
    const { resolveCoefficients } = await loadModule('../../js/tides/model-loader.js');
    assert.equal(await resolveCoefficients(44.9, -124.95), null);
  } finally { missing.restore(); }

  const seam = mockFetch();
  try {
    const { resolveCoefficients } = await loadModule('../../js/tides/model-loader.js');
    const east = await resolveCoefficients(0, 179.99);
    const west = await resolveCoefficients(0, -179.99);
    assert.ok(east);
    assert.ok(west);
    assert.deepEqual(east.coefficients, west.coefficients);
  } finally { seam.restore(); }
});

function buildVisualizationChunk({ invalidIndex = -1 } = {}) {
  const rows = 5, columns = 5, recordSize = 137;
  const buffer = Buffer.alloc(36 + rows * columns * recordSize);
  buffer.write('TVZ1', 0, 'ascii');
  buffer.writeUInt8(1, 4);
  buffer.writeUInt8(17, 5);
  buffer.writeUInt16LE(rows, 6);
  buffer.writeUInt16LE(columns, 8);
  buffer.writeUInt16LE(recordSize, 10);
  buffer.writeDoubleLE(-2, 12);
  buffer.writeDoubleLE(178, 20);
  buffer.writeDoubleLE(1, 28);
  for (let cell = 0; cell < rows * columns; cell += 1) {
    const offset = 36 + cell * recordSize;
    buffer.writeUInt8(cell === invalidIndex ? 0 : 1, offset);
    for (let index = 0; index < 17; index += 1) {
      buffer.writeFloatLE(20 + index, offset + 1 + index * 8);
      buffer.writeFloatLE(-3 - index, offset + 5 + index * 8);
    }
  }
  return gzipSync(buffer);
}

function mockVisualizationFetch(invalidIndex = -1) {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async input => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith('manifest.json')) return new Response(JSON.stringify({
      tiles: { '3_11': { path: 'chunks/3_11.bin.gz' } }
    }), { status: 200 });
    return new Response(buildVisualizationChunk({ invalidIndex }), { status: 200 });
  };
  return { requests, restore: () => { global.fetch = originalFetch; } };
}

test('Tide visualization uses masked coarse ocean nodes and resolves dateline locations', async () => {
  const mock = mockVisualizationFetch();
  try {
    const [{ tideVisualizationLevel }, { predictHarmonic }] = await Promise.all([
      loadModule('../../js/tides/visualization.js'), loadModule('../../js/tides/astronomy.js')
    ]);
    const timestamp = Date.parse('2026-09-30T12:00:00Z');
    const actual = await tideVisualizationLevel(0.5, 179.5, timestamp);
    const coefficients = Array.from({ length: 17 }, (_, index) => [20 + index, -3 - index]);
    assert.equal(actual, predictHarmonic(coefficients, timestamp));
    assert.equal(mock.requests.filter(url => url.includes('/chunks/')).length, 1);
  } finally { mock.restore(); }
});

test('Tide visualization withholds color when the conservative coast stencil includes land', async () => {
  const mock = mockVisualizationFetch(12);
  try {
    const { tideVisualizationLevel } = await loadModule('../../js/tides/visualization.js');
    assert.equal(await tideVisualizationLevel(0.5, 179.5, Date.now()), null);
  } finally { mock.restore(); }
});

test('Tide assets use versioned local paths and no remote service URL', async () => {
  const source = require('node:fs').readFileSync('index.html', 'utf8');
  const loader = require('node:fs').readFileSync('js/tides/model-loader.js', 'utf8');
  const timezone = require('node:fs').readFileSync('js/tides/timezone.js', 'utf8');
  const visualization = require('node:fs').readFileSync('js/tides/visualization.js', 'utf8');
  const assetConfig = require('node:fs').readFileSync('js/tides/asset-config.js', 'utf8');
  assert.match(loader, /tideAssetUrl\(`\$\{ROOT\}manifest\.json`\)/);
  assert.match(timezone, /tideAssetUrl\(`\$\{BASE\}manifest\.json`\)/);
  assert.match(visualization, /tideAssetUrl\(`\$\{ROOT\}manifest\.json`\)/);
  assert.match(assetConfig, /new URL\('\.\.\/\.\.\/data\/tides\//);
  assert.doesNotMatch(`${loader}\n${timezone}\n${visualization}`, /data\/tides\/(?:eot20|timezones)/);
  const tideUi = source.slice(source.indexOf('function selectTideLocation'), source.indexOf('function renderTidePopup'));
  assert.doesNotMatch(`${tideUi}\n${loader}\n${timezone}`, /(?:https?:)?\/\/[^'"\s]*(?:tide|waterlevel|noaa)[^'"\s]*/i);
});

test('Tide asset resolver supports local, relative, and absolute configured bases safely', async () => {
  const { createTideAssetResolver } = await loadModule('../../js/tides/asset-config.js');
  const moduleUrl = 'https://diveatlas.example/js/tides/asset-config.js';
  const local = createTideAssetResolver(null, moduleUrl);
  assert.equal(local('eot20-v1/coeff/2_3.bin.gz').href,
    'https://diveatlas.example/data/tides/eot20-v1/coeff/2_3.bin.gz');

  const relative = createTideAssetResolver('static/tides/v1', moduleUrl);
  assert.equal(relative('eot20-viz-v1/chunks/3_11.bin.gz').href,
    'https://diveatlas.example/static/tides/v1/eot20-viz-v1/chunks/3_11.bin.gz');

  const external = createTideAssetResolver('https://cdn.example.net/diveatlas/tides/v1/', moduleUrl);
  assert.equal(external('timezones-2026d/12_09.json.gz').href,
    'https://cdn.example.net/diveatlas/tides/v1/timezones-2026d/12_09.json.gz');
  assert.equal(external('eot20-v1/chunks/a b.bin.gz').href,
    'https://cdn.example.net/diveatlas/tides/v1/eot20-v1/chunks/a%20b.bin.gz');
});

test('Tide asset resolver rejects unsafe origins and traversal paths', async () => {
  const { createTideAssetResolver } = await loadModule('../../js/tides/asset-config.js');
  const moduleUrl = 'https://diveatlas.example/js/tides/asset-config.js';
  assert.throws(() => createTideAssetResolver('http://cdn.example.net/tides/', moduleUrl), /HTTPS/);
  assert.throws(() => createTideAssetResolver('https://user:pass@cdn.example.net/tides/', moduleUrl), /credentials/);
  assert.throws(() => createTideAssetResolver('https://cdn.example.net/tides/?cache=1', moduleUrl), /query/);
  const resolve = createTideAssetResolver(null, moduleUrl);
  assert.throws(() => resolve('../unrelated/file'), /traversal/);
  assert.throws(() => resolve('/absolute/file'), /relative paths/);
});
