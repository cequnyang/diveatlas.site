const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const api = require('../../js/destination-comparison-data.js');

const inventory = JSON.parse(fs.readFileSync(require.resolve('../../regions/area-index.json'), 'utf8'));
const sample = (value, status = value === null ? 'no_data' : 'available', cell = '1') => ({
  value, lookupStatus: status, sourceLatitude: Number(cell), sourceLongitude: 120
});

test('inventory includes public map records beyond the generated destination-page subset', () => {
  for (const destination of api.DESTINATIONS) {
    const sites = api.selectSites(inventory, destination);
    const expected = inventory.sites.filter(site => site.country === 'Indonesia' && site.region === destination.region);
    assert.deepEqual(sites.map(s => s.id), [...new Set(expected.map(s => s.site_id))]);
    assert.ok(sites.length > (destination.id === 'bali' ? 118 : 59));
  }
  assert.throws(() => api.selectSites({ schema: 'unsupported', sites: [] }, api.DESTINATIONS[0]), /Unsupported/);
});

test('coverage separates valid zero, missing source data, request failures and shared cells', () => {
  const samples = [sample(0), sample(0.3), sample(null), sample(null, 'request_failed')]
    .map(current => ({ result: { metrics: { current } } }));
  assert.deepEqual(api.summarize(samples, 'current'), { total: 4, valid: 2, missing: 1, failed: 1, min: 0, max: 0.3, cells: 1 });
});

test('destination catalog matches every public place membership, including single-site destinations', () => {
  const destinations = api.buildDestinations(inventory);
  const areas = inventory.areas.filter(area => area.kind === 'place');
  assert.equal(destinations.length, areas.length);
  for (const area of areas) {
    const destination = destinations.find(d => d.areaKey === area.key);
    assert.ok(destination, area.label);
    assert.deepEqual(destination.sites.map(s => s.id).sort(), [...new Set(area.site_indices.map(i => inventory.sites[i].site_id))].sort());
  }
  assert.ok(destinations.some(d => d.sites.length === 1));
});

test('identically named destinations in different countries are separate query targets', async () => {
  const sites = ['Country A', 'Country B'].map((country, i) => ({ site_id: String(i), name: 'Site ' + i, region: 'Same name', country, lat: i, lon: 100 }));
  const index = { schema: 'dive-site-region-index-v1', sites };
  const catalog = api.buildDestinations(index);
  assert.notEqual(catalog[0].id, catalog[1].id);
  const calls = [];
  const comparison = api.create({ fetchIndex: async () => index, service: { query: async site => {
    calls.push(site.id);
    return { metrics: Object.fromEntries(Object.keys(api.METRICS).map(key => [key, sample(1)])) };
  } } });
  const result = await comparison.query(catalog[1].id, 9);
  assert.equal(result.total, 1); assert.deepEqual(calls, ['1']);
});

test('bounded queries cache by destination/month and explicit retry requeries every record', async () => {
  let active = 0, maximum = 0, calls = 0;
  const index = { schema: 'dive-site-region-index-v1', sites: Array.from({ length: 7 }, (_, i) => ({
    site_id: String(i), name: 'Site ' + i, country: 'Indonesia', region: 'Bali', lat: -8, lon: 115
  })).concat({ site_id: 'komodo', name: 'Komodo', country: 'Indonesia', region: 'Komodo National Park', lat: -8, lon: 119 }) };
  const comparison = api.create({ concurrency: 2, fetchIndex: async () => index, service: { query: async () => {
    calls++; active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setImmediate(resolve)); active--;
    return { metrics: Object.fromEntries(Object.keys(api.METRICS).map(key => [key, sample(0)])) };
  } } });
  const first = comparison.query('bali', 9);
  assert.equal(first, comparison.query('bali', 9));
  const result = await first;
  assert.equal(result.complete, 7); assert.equal(maximum, 2); assert.equal(calls, 7);
  await comparison.query('bali', 4); assert.equal(calls, 14);
  await comparison.query('bali', 9, { retry: true }); assert.equal(calls, 21);
  await assert.rejects(comparison.query('bali', 13), /Invalid/);
});

test('failed inventory requests are retryable without reloading the page', async () => {
  let requests = 0;
  const comparison = api.create({ service: { query: async () => ({ metrics: Object.fromEntries(Object.keys(api.METRICS).map(key => [key, sample(1)])) }) },
    fetchIndex: async () => { if (++requests === 1) throw new Error('offline'); return inventory; } });
  await assert.rejects(comparison.query('komodo', 9), /offline/);
  const result = await comparison.query('komodo', 9);
  assert.equal(result.total, api.selectSites(inventory, api.DESTINATIONS[1]).length);
});


test('preferred ranges compare both endpoints and preserve neutral missing, tied or mixed results', () => {
  const range = (min, max, failed = 0) => ({min, max, failed});
  assert.equal(api.preferredRange('temperature', range(28,30), range(25,28)), 0);
  assert.equal(api.preferredRange('clarity', range(10,21), range(9,20)), 0);
  assert.equal(api.preferredRange('current', range(.02,.15), range(.06,.07)), -1);
  assert.equal(api.preferredRange('waves', range(.12,.54), range(.41,.88)), 0);
  assert.equal(api.preferredRange('waves', range(.41,.88), range(.12,.54)), 1);
  assert.equal(api.preferredRange('clarity', range(10,20), range(10,20)), -1);
  assert.equal(api.preferredRange('waves', range(0,0), range(1,2)), 0);
  assert.equal(api.preferredRange('waves', range(null,null), range(1,2)), -1);
  assert.equal(api.preferredRange('waves', undefined, range(1,2)), -1);
  assert.equal(api.preferredRange('waves', range(0,1,1), range(1,2)), -1);
});
