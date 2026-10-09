const test = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const { classify, createWaterClarityQuery } = require('../../js/water-clarity-query.js');

test('clarity categories use centralized thresholds and reject invalid values', () => {
  assert.equal(classify(4.9), 'Very low clarity');
  assert.equal(classify(5), 'Low clarity');
  assert.equal(classify(10), 'Moderate clarity');
  assert.equal(classify(20), 'High clarity');
  assert.equal(classify(30), 'Very high clarity');
  assert.equal(classify(-1), null);
  assert.equal(classify(Number.NaN), null);
});

test('query decoder returns the selected month value and preserves No Data', async () => {
  const metadata = {
    format: 'diveatlas-water-clarity', format_version: 1,
    generated_at_utc: 'fixture', available_months: Array.from({ length: 12 }, (_, index) => index + 1),
    grid: { latitude_count: 2, longitude_count: 4, latitude_first_center: -0.5,
      longitude_first_center: 0.5, latitude_step_degrees: 1, longitude_step_degrees: 1 },
    value_encoding: { scale_m: 0.5, missing_sentinel: 255 },
    query: { chunk_degrees: 10, chunks: [{ row: 0, column: 0, file: 'r00_c00.u8.gz',
      row_start: 0, column_start: 0, rows: 2, columns: 4 }] }
  };
  const values = Buffer.alloc(12 * 2 * 4, 255);
  values[(8 * 2 + 1) * 4] = 24;
  let chunkRequests = 0;
  const fetchImpl = async url => String(url) === 'metadata.json'
    ? new Response(JSON.stringify(metadata), { status: 200 })
    : (chunkRequests += 1, new Response(gzipSync(values), { status: 200 }));
  const query = createWaterClarityQuery({ metadataUrl: 'metadata.json', fetchImpl });

  const current = await query.query({ lat: 0.5, lng: 0.5 }, { month: 9 });
  assert.equal(current.value_m, 12);
  assert.equal(current.classification, 'Moderate clarity');
  const missing = await query.query({ lat: 0.5, lng: 0.5 }, { month: 10 });
  assert.equal(missing.unavailable, true);
  assert.equal(missing.value_m, undefined);
  assert.equal(chunkRequests, 1);
});

test('query wraps longitudes around the dateline and rejects points beyond grid latitude', async () => {
  const metadata = {
    format: 'diveatlas-water-clarity', format_version: 1, available_months: [1],
    grid: { latitude_count: 1, longitude_count: 4, latitude_first_center: 0,
      longitude_first_center: -179, latitude_step_degrees: 90, longitude_step_degrees: 90 },
    value_encoding: { scale_m: 0.5, missing_sentinel: 255 },
    query: { chunk_degrees: 360, chunks: [{ row: 0, column: 0, file: 'all.u8.gz',
      row_start: 0, column_start: 0, rows: 1, columns: 4 }] }
  };
  const fetchImpl = async url => String(url) === 'metadata.json'
    ? new Response(JSON.stringify(metadata), { status: 200 })
    : new Response(gzipSync(Buffer.from([2, 4, 6, 8, ...Array(44).fill(255)])), { status: 200 });
  const query = createWaterClarityQuery({ metadataUrl: 'metadata.json', fetchImpl });
  const wrapped = await query.query({ lat: 0, lng: 180 }, { month: 1 });
  assert.equal(wrapped.value_m, 1);
  assert.equal((await query.query({ lat: 91, lng: 180 }, { month: 1 })).unavailable, true);
});

test('v2 clarity fetches and caches only the selected month plane', async () => {
  const metadata = {
    format:'diveatlas-water-clarity-query', format_version:2, generated_at_utc:'fixture',
    available_months:[8, 9],
    grid:{ latitude_count:2, longitude_count:4, latitude_first_center:-0.5,
      longitude_first_center:0.5, latitude_step_degrees:1, longitude_step_degrees:1 },
    value_encoding:{ scale_m:0.5, missing_sentinel:255 },
    query:{ chunk_degrees:10, chunk_file_template:'chunks/{month}/r{row}_c{column}.u8.gz',
      chunks:[{ row:0, column:0, row_start:0, column_start:0, rows:2, columns:4 }] }
  };
  const requests = [];
  const fetchImpl = async url => {
    const key = String(url);
    if (key === 'metadata.json') return new Response(JSON.stringify(metadata), { status:200 });
    requests.push(key);
    const plane = key.includes('/09/') ? [2, 4, 6, 8, 2, 4, 6, 8] : [2, 4, 6, 8, 10, 12, 14, 16];
    return new Response(gzipSync(Buffer.from(plane)), { status:200 });
  };
  const query = createWaterClarityQuery({ metadataUrl:'metadata.json', fetchImpl });
  const first = await query.query({ lat:0.5, lng:0.5 }, { month:9 });
  const again = await query.query({ lat:0.5, lng:0.5 }, { month:9 });
  const otherMonth = await query.query({ lat:0.5, lng:0.5 }, { month:8 });
  assert.equal(first.value_m, 1);
  assert.equal(again.value_m, 1);
  assert.equal(otherMonth.value_m, 5);
  assert.equal(requests.length, 2);
  assert.match(requests[0], /data\/water_clarity\/query\/v2\/chunks\/09\/r00_c00\.u8\.gz\?/);
  assert.match(requests[1], /data\/water_clarity\/query\/v2\/chunks\/08\/r00_c00\.u8\.gz\?/);
});

test('defaults to v1 clarity metadata only when the v2 metadata asset is not published yet', async () => {
  const metadata = {
    format:'diveatlas-water-clarity', format_version:1, available_months:[9],
    grid:{ latitude_count:1, longitude_count:1, latitude_first_center:0,
      longitude_first_center:0, latitude_step_degrees:1, longitude_step_degrees:1 },
    value_encoding:{ scale_m:0.5, missing_sentinel:255 },
    query:{ chunk_degrees:10, chunks:[{ row:0, column:0, file:'r00_c00.u8.gz',
      row_start:0, column_start:0, rows:1, columns:1 }] }
  };
  const requests = [];
  const fetchImpl = async url => {
    requests.push(String(url));
    if (String(url) === 'data/water_clarity/query/v2/metadata.json') return new Response('', { status:404 });
    if (String(url) === 'data/water_clarity/metadata.json') return new Response(JSON.stringify(metadata), { status:200 });
    const planes = Buffer.alloc(12, 255);
    planes[8] = 30;
    return new Response(gzipSync(planes), { status:200 });
  };
  const query = createWaterClarityQuery({ fetchImpl });
  const result = await query.query({ lat:0, lng:0 }, { month:9 });
  assert.equal(result.value_m, 15);
  assert.deepEqual(requests.slice(0, 2), [
    'data/water_clarity/query/v2/metadata.json', 'data/water_clarity/metadata.json'
  ]);
  assert.ok(requests[2].includes('data/water_clarity/query/chunks/'));
});
