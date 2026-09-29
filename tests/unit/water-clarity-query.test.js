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
