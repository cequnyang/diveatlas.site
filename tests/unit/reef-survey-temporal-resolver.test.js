const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  SUPPORTED_METRICS,
  resolveLatestAvailableMetric,
  groupEventsBySourceSite
} = require('../../js/reef-survey-temporal-resolver.js');
const { getMetricCandidates } = require('../../js/reef-survey-schema.js');

function protocol({ method = 'PIT', sourceMethod = 'benthicpit', live = null, hard = null, macro = null } = {}) {
  const metric = valuePct => ({ valuePct, sdPct: null, basis: 'benthic-cover' });
  return {
    method,
    sourceMethod,
    metrics: {
      ...(live !== undefined ? { liveCoralCover: metric(live) } : {}),
      ...(hard !== undefined ? { hardCoralCover: metric(hard) } : {}),
      ...(macro !== undefined ? { macroalgaeCover: metric(macro) } : {})
    }
  };
}

function event({
  id,
  sourceSiteId = 'site-a',
  provider = 'MERMAID',
  date,
  protocols = []
}) {
  return {
    schemaVersion: 2,
    id: `mermaid:${id}`,
    location: { lat: -2, lon: 130, siteName: 'Example Reef', sourceSiteId, region: null, country: 'Indonesia' },
    survey: { date },
    protocols,
    quality: { confidenceLevel: null },
    provenance: { provider, sourceRecordId: id }
  };
}

test('supports live coral, source-labeled hard coral, and macroalgae temporal resolution', () => {
  assert.deepEqual(SUPPORTED_METRICS, ['liveCoralCover', 'hardCoralCover', 'macroalgaeCover']);
  assert.throws(() => resolveLatestAvailableMetric([], 'bleaching'), RangeError);
});

test('source-labeled hard coral remains a separate metric from live coral', () => {
  const record = event({ id: 'hard-coral', provider: 'XL Catlin Seaview Survey', date: '2018-05-05', protocols: [protocol({ hard: 34.7 })] });
  assert.equal(resolveLatestAvailableMetric([record], 'hardCoralCover').value, 34.7);
  assert.equal(resolveLatestAvailableMetric([record], 'liveCoralCover').status, 'missing');
});

test('A: the newest event with one live-coral candidate is selected', () => {
  const older = event({ id: 'old', date: '2020-01-01', protocols: [protocol({ live: 25 })] });
  const newest = event({ id: 'new', date: '2022-06-15', protocols: [protocol({ live: 40 })] });
  const result = resolveLatestAvailableMetric([older, newest], 'liveCoralCover');
  assert.deepEqual(result, {
    status: 'unique', value: 40, metric: 'liveCoralCover', observationDate: '2022-06-15',
    observationDatePrecision: 'day', ageDays: null, ageApproximate: false, resolutionMethod: 'latest-available-metric',
    sourceEventId: 'new', sourceSiteId: 'site-a', protocol: 'benthicpit'
  });
});

test('a measured zero remains a unique metric value', () => {
  const zero = event({ id: 'measured-zero', date: '2022-06-15', protocols: [protocol({ live: 0 })] });
  assert.equal(resolveLatestAvailableMetric([zero], 'liveCoralCover').value, 0);
});

test('B: a newer event without macroalgae falls back to an older unique observation', () => {
  const older = event({ id: 'pit-old', date: '2019-05-12', protocols: [protocol({ macro: 1.67 })] });
  const newer = event({ id: 'fish-new', date: '2019-05-13', protocols: [protocol({ method: 'other', sourceMethod: 'beltfish' })] });
  const result = resolveLatestAvailableMetric([newer, older], 'macroalgaeCover');
  assert.deepEqual(result, {
    status: 'unique', value: 1.67, metric: 'macroalgaeCover', observationDate: '2019-05-12',
    observationDatePrecision: 'day', ageDays: null, ageApproximate: false, resolutionMethod: 'latest-available-metric',
    sourceEventId: 'pit-old', sourceSiteId: 'site-a', protocol: 'benthicpit'
  });
  assert.notEqual(result.observationDate, newer.survey.date, 'metric date belongs to the selected older event');
});

test('C: ambiguity in the newest event is returned instead of falling back', () => {
  const older = event({ id: 'unique-old', date: '2021-01-01', protocols: [protocol({ live: 30 })] });
  const newest = event({ id: 'ambiguous-new', date: '2023-01-01', protocols: [
    protocol({ live: 20 }), protocol({ method: 'LIT', sourceMethod: 'benthiclit', live: 35 })
  ] });
  assert.equal(getMetricCandidates(newest, 'liveCoralCover').length, 2);
  assert.deepEqual(resolveLatestAvailableMetric([older, newest], 'liveCoralCover'), {
    status: 'ambiguous', value: null, metric: 'liveCoralCover', observationDate: '2023-01-01',
    observationDatePrecision: 'day', ageDays: null, ageApproximate: false, resolutionMethod: 'latest-available-metric',
    sourceEventId: 'ambiguous-new', sourceSiteId: 'site-a', protocol: null
  });
});

test('D: all-missing events return a missing result without inventing a date or value', () => {
  const records = [
    event({ id: 'new-missing', date: '2023-01-01', protocols: [protocol()] }),
    event({ id: 'old-missing', date: '2020-01-01', protocols: [] })
  ];
  assert.deepEqual(resolveLatestAvailableMetric(records, 'liveCoralCover'), {
    status: 'missing', value: null, metric: 'liveCoralCover', observationDate: null,
    observationDatePrecision: 'unknown', ageDays: null, ageApproximate: false, resolutionMethod: 'latest-available-metric',
    sourceEventId: null, sourceSiteId: 'site-a', protocol: null
  });
});

test('year-precision observations keep their source date and expose approximate age', () => {
  const older = event({ id: 'year-older', date: '2020', protocols: [protocol({ hard: 21 })] });
  older.schemaVersion = 3;
  older.survey.datePrecision = 'year';
  const newer = event({ id: 'year-newer', date: '2021', protocols: [protocol({ hard: 28 })] });
  newer.schemaVersion = 3;
  newer.survey.datePrecision = 'year';
  const result = resolveLatestAvailableMetric([older, newer], 'hardCoralCover', '2026-06-01');
  assert.equal(result.value, 28);
  assert.equal(result.observationDate, '2021');
  assert.equal(result.observationDatePrecision, 'year');
  assert.equal(result.ageApproximate, true);
  assert.equal(result.ageDays, Math.floor((Date.parse('2026-06-01T00:00:00Z') - Date.UTC(2021, 6, 1)) / (24 * 60 * 60 * 1000)));
});

test('same-precision-date events with multiple metric values are ambiguous, independent of row order', () => {
  const first = event({ id: 'same-date-a', date: '2018', protocols: [protocol({ hard: 12 })] });
  first.schemaVersion = 3;
  first.survey.datePrecision = 'year';
  const second = event({ id: 'same-date-b', date: '2018', protocols: [protocol({ hard: 44 })] });
  second.schemaVersion = 3;
  second.survey.datePrecision = 'year';
  const result = resolveLatestAvailableMetric([first, second], 'hardCoralCover', '2026-10-03');
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.value, null);
  assert.equal(result.observationDate, '2018');
  assert.equal(result.observationDatePrecision, 'year');
  assert.equal(result.sourceEventId, null);
  assert.deepEqual(result.sourceEventIds, ['same-date-a', 'same-date-b']);
  assert.equal(resolveLatestAvailableMetric([second, first], 'hardCoralCover').status, 'ambiguous');
});

test('E: dataset grouping keeps provider-scoped source sites isolated', () => {
  const siteA = event({ id: 'a-new', sourceSiteId: 'site-a', date: '2024-01-01', protocols: [protocol({ live: 10 })] });
  const siteB = event({ id: 'b-new', sourceSiteId: 'site-b', date: '2024-01-01', protocols: [protocol({ live: 90 })] });
  const groups = groupEventsBySourceSite([siteA, siteB]);
  assert.deepEqual(groups.map(group => group.sourceSiteId), ['site-a', 'site-b']);
  const results = groups.map(group => resolveLatestAvailableMetric(group.events, 'liveCoralCover'));
  assert.deepEqual(results.map(result => [result.sourceSiteId, result.value]), [['site-a', 10], ['site-b', 90]]);
  assert.throws(() => resolveLatestAvailableMetric([siteA, siteB], 'liveCoralCover'), /same provider-scoped sourceSiteId/);
});

test('null survey dates sort after dated events and remain distinct from the selected metric date', () => {
  const undated = event({ id: 'undated', date: null, protocols: [protocol({ live: 5 })] });
  const dated = event({ id: 'dated', date: '2022-01-01', protocols: [protocol({ live: 25 })] });
  assert.equal(resolveLatestAvailableMetric([undated, dated], 'liveCoralCover').sourceEventId, 'dated');
});

test('evidence age uses the supplied reference date for recent and old metric observations', () => {
  const recent = event({ id: 'recent', date: '2026-05-20', protocols: [protocol({ live: 5 })] });
  const old = event({ id: 'old', date: '2019-05-12', protocols: [protocol({ live: 25 })] });
  const recentResult = resolveLatestAvailableMetric([recent], 'liveCoralCover', '2026-06-01');
  const oldResult = resolveLatestAvailableMetric([old], 'liveCoralCover', new Date('2026-06-01T18:00:00Z'));
  assert.equal(recentResult.ageDays, 12);
  assert.equal(oldResult.ageDays, Math.floor((Date.parse('2026-06-01T00:00:00Z') - Date.parse('2019-05-12T00:00:00Z')) / (24 * 60 * 60 * 1000)));
  assert.equal(oldResult.resolutionMethod, 'latest-available-metric');
});

test('evidence age is unavailable when the selected metric event has no date', () => {
  const undated = event({ id: 'undated', date: null, protocols: [protocol({ live: 5 })] });
  const result = resolveLatestAvailableMetric([undated], 'liveCoralCover', '2026-06-01');
  assert.equal(result.observationDate, null);
  assert.equal(result.ageDays, null);
});

test('evidence age follows the selected metric observation rather than the newest survey date', () => {
  const olderMetric = event({ id: 'older-metric', date: '2019-05-12', protocols: [protocol({ live: 25 })] });
  const newerSurvey = event({ id: 'newer-survey', date: '2019-05-13', protocols: [protocol()] });
  const result = resolveLatestAvailableMetric([newerSurvey, olderMetric], 'liveCoralCover', '2019-05-20');
  assert.equal(result.observationDate, '2019-05-12');
  assert.equal(result.ageDays, 8);
  assert.equal(result.sourceEventId, 'older-metric');
});

const pilotPath = path.join(__dirname, '../../data/.build/reef_condition/mermaid-pilot.json');
const hasLocalPilot = fs.existsSync(pilotPath);
test('dataset helper resolves current MERMAID pilot records independently by source site', { skip: !hasLocalPilot }, () => {
  const pilot = JSON.parse(fs.readFileSync(pilotPath, 'utf8'));
  const groups = groupEventsBySourceSite(pilot.records);
  assert.equal(groups.length, pilot.metadata.sourceSiteCount);
  assert.ok(groups.every(group => group.identityType === 'SOURCE_ID' && group.events.length === 1));

  for (const group of groups) {
    for (const metric of SUPPORTED_METRICS) {
      const result = resolveLatestAvailableMetric(group.events, metric);
      const candidates = getMetricCandidates(group.events[0], metric);
      assert.equal(result.sourceSiteId, group.sourceSiteId);
      assert.equal(result.status, candidates.length === 1 ? 'unique' : candidates.length > 1 ? 'ambiguous' : 'missing');
      if (candidates.length === 1) {
        assert.equal(result.sourceEventId, group.events[0].provenance.sourceRecordId);
        assert.equal(result.value, candidates[0].valuePct);
      } else if (candidates.length > 1) {
        assert.equal(result.sourceEventId, group.events[0].provenance.sourceRecordId);
      } else {
        assert.equal(result.sourceEventId, null);
      }
    }
  }
});
