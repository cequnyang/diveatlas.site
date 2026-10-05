'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { aggregateAtResolution, datasetCoverage, summarizeSites, writeOutputs } = require('../../tools/reef_condition/build_spatial_evidence.js');

function record({ id, site = 'site-a', provider = 'MERMAID', date = '2020-01-01', value = 20, lat = -0.5, lon = 130, name = site }) {
  return {
    schemaVersion: 2, id: `event-${id}`,
    location: { lat, lon, siteName: name, sourceSiteId: site, region: 'Raja Ampat', country: 'Indonesia' },
    survey: { date },
    protocols: value === null ? [] : [{ method: 'PIT', sourceMethod: 'benthicpit', metrics: { liveCoralCover: { valuePct: value, sdPct: null, basis: 'benthic-cover' } } }],
    quality: { confidenceLevel: null },
    provenance: { provider, sourceRecordId: id, projectId: null, projectName: null, suggestedCitation: null, license: null, sourceUrl: null }
  };
}

test('repeated surveys resolve to one site observation and measured zero remains evidence', () => {
  const records = [
    record({ id: 'old', date: '2018-01-01', value: 80 }),
    record({ id: 'new-missing', date: '2023-01-01', value: null }),
    record({ id: 'zero', site: 'site-b', date: '2022-01-01', value: 0, lon: 130.001 })
  ];
  const result = summarizeSites(records, '2024-01-01');
  assert.equal(result.groupedSiteCount, 2);
  assert.equal(result.resolved.length, 2);
  assert.equal(result.resolved.find(item => item.sourceSiteId === 'site-a').value, 80);
  assert.equal(result.resolved.find(item => item.sourceSiteId === 'site-a').sourceRecordId, 'old');
  assert.equal(result.resolved.find(item => item.sourceSiteId === 'site-b').value, 0);
});

test('multiple sites in a cell use the median and retain independent-site and source provenance', () => {
  const sites = [
    record({ id: 'a', site: 'a', value: 10, lon: 130 }),
    record({ id: 'b', site: 'b', value: 30, lon: 130.0001 }),
    record({ id: 'c', site: 'c', value: 0, lon: 130.0002 })
  ];
  const { collection, stats } = aggregateAtResolution(summarizeSites(sites, '2024-01-01').resolved, 10, '2024-01-01');
  assert.equal(collection.features.length, 1);
  const props = collection.features[0].properties;
  assert.equal(props.summaryValue, 10);
  assert.equal(props.evidenceCount, 3);
  assert.equal(props.sourceSiteCount, 3);
  assert.deepEqual(props.sourceSiteIds, ['a', 'b', 'c']);
  assert.deepEqual(props.sourceRecordIds, ['a', 'b', 'c']);
  assert.equal(props.oldestObservationDate, '2020-01-01');
  assert.equal(props.lastObservationDate, '2020-01-01');
  assert.equal(stats.occupiedCells, 1);
});

test('null-only sites do not create empty cells', () => {
  const result = summarizeSites([record({ id: 'missing', value: null })], '2024-01-01');
  assert.equal(result.states.missing, 1);
  assert.deepEqual(aggregateAtResolution(result.resolved, 5, '2024-01-01').collection.features, []);
});

test('grid output is deterministic for the same records and reference date', () => {
  const records = [record({ id: 'b', site: 'b', value: 30, lon: 130.002 }), record({ id: 'a', site: 'a', value: 10, lon: 130.001 })];
  const a = aggregateAtResolution(summarizeSites(records, '2024-01-01').resolved, 2, '2024-01-01');
  const b = aggregateAtResolution(summarizeSites(records, '2024-01-01').resolved, 2, '2024-01-01');
  assert.deepEqual(a, b);
});

test('different providers with the same sourceSiteId remain separate sites', () => {
  const records = [record({ id: 'a', provider: 'MERMAID', site: 'same', value: 10 }), record({ id: 'b', provider: 'OTHER', site: 'same', value: 30 })];
  const summary = summarizeSites(records, '2024-01-01');
  assert.equal(summary.groupedSiteCount, 2);
  assert.equal(summary.resolved.length, 2);
});

test('coverage report separates event availability from site-level latest-available metrics', () => {
  const records = [
    record({ id: 'older-value', site: 'repeat', date: '2020-01-01', value: 35 }),
    record({ id: 'newer-missing', site: 'repeat', date: '2022-01-01', value: null }),
    record({ id: 'zero', site: 'zero-site', value: 0 })
  ];
  const report = datasetCoverage(records, '2024-01-01');
  assert.equal(report.eventCount, 3);
  assert.equal(report.uniqueSites, 2);
  assert.deepEqual(report.eventMetricAvailability.liveCoralCover, { unique: 2, missing: 1, ambiguous: 0 });
  assert.deepEqual(report.siteMetricResolution.liveCoralCover, { unique: 2, missing: 0, ambiguous: 0 });
  assert.equal(report.bleachingTemporalResolution, 'unsupported');
  assert.deepEqual(report.countrySiteCounts, { Indonesia: 2 });
});

test('generator writes compressed candidate resolutions and comparison report under requested build output', () => {
  const directory = path.resolve(__dirname, '../../data/.build/reef_condition/test-spatial-evidence');
  try {
    fs.rmSync(directory, { recursive: true, force: true });
    const output = directory;
    const report = writeOutputs({ outputDirectory: output, referenceDate: '2024-01-01', resolutionsKm: [2, 5] }, [record({ id: 'a' })]);
    assert.deepEqual(report.resolutions.map(item => item.resolutionKm), [2, 5]);
    const compressed = fs.readFileSync(path.join(output, 'reef-survey-evidence-live-coral-r2km.geojson.gz'));
    const parsed = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
    assert.equal(parsed.features[0].properties.summaryValue, 20);
    assert.ok(fs.existsSync(path.join(output, 'reef-survey-evidence-live-coral-r2km-preview.svg')));
    assert.ok(fs.existsSync(path.join(output, 'reef-survey-evidence-live-coral-resolution-comparison.json')));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
