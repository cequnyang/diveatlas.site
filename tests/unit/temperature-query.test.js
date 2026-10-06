const test = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const { createTemperatureQuery } = require('../../js/temperature-query.js');

function makeMetadata() {
  return {
    format: 'diveatlas-temperature-query', format_version: 1,
    designation: 'development-validation', source_resolution_degrees: 1,
    generation_version: 'test', available_months: [9], available_depths_m: [20],
    grid: { latitude_count: 1, longitude_count: 60, latitude_first_center: 0,
      longitude_first_center: 0.5, latitude_step_degrees: 1, longitude_step_degrees: 1,
      latitude_order: 'north_to_south', longitude_convention: '0_to_360' },
    chunk_degrees: 10, chunk_halo_cells: 1, chunk_grid: { rows: 1, columns: 6 },
    value_encoding: { scale_c: 0.01, missing_sentinel: -32768 }
  };
}

function makeChunk(value) {
  const raw = Buffer.alloc(12 * 2);
  for (let index = 0; index < 12; index += 1) raw.writeInt16LE(value, index * 2);
  return gzipSync(raw);
}

test('query chunk cache is bounded and refetches only after eviction', async () => {
  const metadata = makeMetadata();
  const fetchCounts = new Map();
  const fetchImpl = async url => {
    const key = String(url);
    fetchCounts.set(key, (fetchCounts.get(key) || 0) + 1);
    if (key === 'metadata.json') return new Response(JSON.stringify(metadata), { status: 200 });
    const index = Number(/c(\d+)/.exec(key)[1]);
    return new Response(makeChunk(2600 + index), { status: 200 });
  };
  const query = createTemperatureQuery({ metadataUrl: 'metadata.json', fetchImpl, maxChunks: 4 });

  for (let chunkIndex = 0; chunkIndex < 5; chunkIndex += 1) {
    const result = await query.query({ lat: 0, lng: 5.5 + chunkIndex * 10 }, { month: 9, depth: 20 });
    assert.equal(result.unavailable, undefined);
  }
  assert.equal(query.cachedChunkCount, 4);
  const firstChunkUrl = [...fetchCounts.keys()].find(url => url.includes('r00_c00'));
  const before = fetchCounts.get(firstChunkUrl);
  await query.query({ lat: 0, lng: 5.5 }, { month: 9, depth: 20 });
  assert.equal(fetchCounts.get(firstChunkUrl), before + 1);
  assert.equal(query.cachedChunkCount, 4);
});

test('missing query sentinel stays unavailable instead of becoming zero degrees', async () => {
  const metadata = makeMetadata();
  const fetchImpl = async url => String(url) === 'metadata.json'
    ? new Response(JSON.stringify(metadata), { status: 200 })
    : new Response(makeChunk(-32768), { status: 200 });
  const query = createTemperatureQuery({ metadataUrl: 'metadata.json', fetchImpl });
  const result = await query.query({ lat: 0, lng: 5.5 }, { month: 9, depth: 20 });
  assert.equal(result.unavailable, true);
  assert.equal(result.value_c, undefined);
});

test('falls back to the nearest valid same-month cell within 100 km and marks the estimate', async () => {
  const metadata = makeMetadata();
  // At the equator, a valid cell 0.5 degrees away is outside 25 km but inside 100 km.
  metadata.grid.longitude_count = 12;
  metadata.grid.longitude_first_center = 0.5;
  metadata.chunk_degrees = 4;
  metadata.chunk_halo_cells = 1;
  metadata.chunk_grid = { rows:1, columns:3 };
  const fetchImpl = async url => {
    if (String(url) === 'metadata.json') return new Response(JSON.stringify(metadata), { status:200 });
    const columnChunk = Number(/c(\d+)/.exec(String(url))[1]);
    const raw = Buffer.alloc(6 * 2);
    for (let index = 0; index < 6; index += 1) raw.writeInt16LE(columnChunk === 0 && index === 2 ? 2450 : -32768, index * 2);
    return new Response(gzipSync(raw), { status:200 });
  };
  const query = createTemperatureQuery({ metadataUrl:'metadata.json', fetchImpl });
  const result = await query.query({ lat:0, lng:1 }, { month:9, depth:20, maxDistanceKm:100 });
  assert.equal(result.value_c, 24.5);
  assert.equal(result.nearby_estimate, true);
  assert.ok(result.sample_distance_km > 25 && result.sample_distance_km <= 100);
});
