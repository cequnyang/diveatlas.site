const test = require('node:test');
const assert = require('node:assert/strict');
const {
  METRICS,
  metricBand,
  metricColor,
  buildSiteObservations,
  surveyAgeOpacity,
  formatPercentage,
  recordMetric,
  datasetStatusText,
  datasetStatusExplanation,
  popupMarkup,
  thermalSeverity,
  thermalHistoryTimeline,
  thermalHistoryPopupMarkup,
  oceanHeatHistoryPopupMarkup,
  decodeOceanHeatQueryRecord
} = require('../../js/reef-survey-condition-view.js');
const { SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS, validateRecord, validateDataset, getMetricCandidates, getSurveySiteKey } = require('../../js/reef-survey-schema.js');
const fixture = require('../fixtures/reef-condition/mock-raja-ampat.json');
const temporalResolver = require('../../js/reef-survey-temporal-resolver.js');
const seaviewLocal = require('../../js/reef-condition-seaview-local.js');

function makeSeaviewRecord({ id, date, hardCoral, macroalgae, sourceSiteId = 'transect-1' }) {
  return {
    schemaVersion: 3,
    id: `seaview-${id}`,
    location: { lat: -16.1, lon: 145.8, siteName: null, region: 'Pacific Australia', country: 'AUS', sourceSiteId },
    survey: { date, datePrecision: 'day', managementRegime: null, sampleId: id, sourceRowNumber: Number(id) },
    protocols: [{
      method: 'SVII transect photo-quadrat survey with automated benthic image classification',
      sourceMethod: 'Image classification', sampleUnitCount: 10, depth: null, dataPolicy: null,
      metrics: {
        hardCoralCover: { valuePct: hardCoral, sdPct: null, basis: 'benthic-cover' },
        macroalgaeCover: { valuePct: macroalgae, sdPct: null, basis: 'benthic-cover' }
      }
    }],
    quality: { confidenceLevel: null },
    provenance: {
      provider: 'XL Catlin Seaview Survey', projectId: null, sourceRecordId: id,
      projectName: 'XL Catlin Seaview Survey Project', suggestedCitation: 'Seaview source citation',
      license: null, sourceUrl: 'https://doi.org/10.14264/uql.2019.930'
    }
  };
}

function makeRecord(overrides = {}) {
  return {
    schemaVersion: 2,
    id: 'event-1',
    location: { lat: -0.55, lon: 130.6, siteName: 'Test Reef', sourceSiteId: null, region: null, country: 'Indonesia' },
    survey: { date: '2025-01-01', managementRegime: null },
    protocols: [{
      method: 'PIT', sourceMethod: null, sampleUnitCount: 4,
      depth: { meanM: 8, sdM: 1 },
      metrics: {
        liveCoralCover: { valuePct: 0, sdPct: 2, basis: 'benthic-cover' },
        macroalgaeCover: { valuePct: null, sdPct: null, basis: 'benthic-cover' }
      },
      dataPolicy: 'public summary'
    }],
    quality: { confidenceLevel: null },
    provenance: {
      provider: 'Test source', projectId: null, sourceRecordId: null, projectName: null,
      suggestedCitation: null, license: null, sourceUrl: null
    },
    ...overrides
  };
}

test('schema v2 accepts one benthic protocol and preserves zero separately from null', () => {
  const event = makeRecord();
  assert.equal(SCHEMA_VERSION, 3);
  assert.deepEqual(SUPPORTED_SCHEMA_VERSIONS, [2, 3]);
  assert.equal(validateRecord(event).valid, true);
  const coral = getMetricCandidates(event, 'liveCoralCover');
  assert.equal(coral.length, 1);
  assert.equal(coral[0].valuePct, 0);
  assert.deepEqual(getMetricCandidates(event, 'macroalgaeCover'), []);
  assert.equal(event.protocols[0].metrics.macroalgaeCover.valuePct, null);
});

test('schema v3 supports unknown dates without inventing month or day components', () => {
  const base = makeRecord({ schemaVersion: 3 });
  assert.equal(validateRecord({ ...base, survey: { date: null, datePrecision: 'unknown', managementRegime: null } }).valid, true);
  assert.equal(validateRecord({ ...base, survey: { date: '2019', datePrecision: 'year', managementRegime: null } }).valid, true);
  assert.equal(validateRecord({ ...base, survey: { date: '2019-13', datePrecision: 'month', managementRegime: null } }).valid, false);
});

test('events preserve multiple protocols and retrieve all compatible candidates without averaging', () => {
  const event = makeRecord({ protocols: [
    makeRecord().protocols[0],
    { ...makeRecord().protocols[0], method: 'LIT', metrics: {
      liveCoralCover: { valuePct: 80, sdPct: 5, basis: 'benthic-cover' }
    } }
  ] });
  const candidates = getMetricCandidates(event, 'liveCoralCover');
  assert.deepEqual(candidates.map(candidate => candidate.valuePct), [0, 80]);
  assert.equal(recordMetric(event, 'liveCoralCoverPct'), null, 'view does not choose or average candidates');
  assert.equal(event.protocols.length, 2, 'distinct protocol entries are retained');
});

test('repeated protocol methods are retained as separate entries', () => {
  const pit = makeRecord().protocols[0];
  const event = makeRecord({ protocols: [pit, { ...pit, metrics: {
    liveCoralCover: { valuePct: 30, sdPct: null, basis: 'benthic-cover' }
  } }] });
  assert.equal(validateRecord(event).valid, true);
  assert.deepEqual(getMetricCandidates(event, 'liveCoralCover').map(candidate => candidate.valuePct), [0, 30]);
});

test('known normalized metrics enforce their measurement basis', () => {
  const event = makeRecord();
  event.protocols[0].metrics.liveCoralCover.basis = 'coral-colonies';
  assert.ok(validateRecord(event).errors.some(error => error.includes('protocols[0].metrics.liveCoralCover.basis')));
  event.protocols[0].metrics.liveCoralCover.basis = 'benthic-cover';
  event.protocols[0].metrics.bleaching = {
    bleachedColoniesPct: 25, paleColoniesPct: 10, normalColoniesPct: 60,
    recentlyDeadColoniesPct: 5, colonyCount: 40, basis: 'coral-colonies'
  };
  assert.equal(validateRecord(event).valid, true);
  assert.ok(validateRecord({ ...event, protocols: [{ ...event.protocols[0], metrics: {
    ...event.protocols[0].metrics, bleaching: { ...event.protocols[0].metrics.bleaching, basis: 'benthic-cover' }
  } }] }).errors.some(error => error.includes('metrics.bleaching.basis')));
});

test('bleaching categories and recently-dead colony percentage remain explicit, not generic mortality', () => {
  const event = makeRecord({ protocols: [{
    method: 'bleaching', sourceMethod: 'Colony condition', sampleUnitCount: 10,
    depth: null,
    metrics: { bleaching: {
      bleachedColoniesPct: 25, paleColoniesPct: 10, normalColoniesPct: 60,
      recentlyDeadColoniesPct: 5, colonyCount: 40, basis: 'coral-colonies'
    } }, dataPolicy: null
  }] });
  assert.equal(getMetricCandidates(event, 'bleaching')[0].valuePct, 25);
  assert.equal(event.protocols[0].metrics.bleaching.recentlyDeadColoniesPct, 5);
  assert.equal(recordMetric(event, 'mortalityPct'), null);
  assert.equal(validateRecord(event).valid, true);
});

test('percentage, SD, count, location, date, and protocol shape validation reports field paths', () => {
  const event = makeRecord();
  event.protocols[0].metrics.liveCoralCover.valuePct = 101;
  event.protocols[0].metrics.liveCoralCover.sdPct = -1;
  event.protocols[0].sampleUnitCount = -1;
  event.location.lat = 91;
  event.survey.date = '2023-02-29';
  const errors = validateRecord(event).errors;
  for (const path of ['metrics.liveCoralCover.valuePct', 'metrics.liveCoralCover.sdPct', 'sampleUnitCount', 'location.lat', 'survey.date']) {
    assert.ok(errors.some(error => error.includes(path)), `expected error path ${path}`);
  }
  assert.ok(validateRecord(makeRecord({ protocols: {} })).errors.some(error => error.includes('protocols must be an array')));
  assert.ok(validateRecord(makeRecord({ protocols: [{ ...makeRecord().protocols[0], method: ' ' }] })).errors.some(error => error.includes('method')));
});

test('protocol data policy and provenance citation fields are retained', () => {
  const event = makeRecord();
  event.provenance.projectName = 'Coral monitoring project';
  event.provenance.suggestedCitation = 'Suggested citation text';
  assert.equal(validateRecord(event).valid, true);
  assert.equal(event.protocols[0].dataPolicy, 'public summary');
  assert.equal(event.provenance.suggestedCitation, 'Suggested citation text');
});

test('percentage values map to five inclusive 20-point bands', () => {
  assert.deepEqual([0, 20, 21, 40, 41, 60, 61, 80, 81, 100].map(metricBand), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(metricColor('liveCoralCoverPct', 0), METRICS.liveCoralCoverPct.colors[0]);
  assert.equal(metricColor('liveCoralCoverPct', 100), METRICS.liveCoralCoverPct.colors[4]);
  assert.notEqual(metricColor('bleachingPct', 50), metricColor('mortalityPct', 50));
});

test('Seaview metrics use distinct numeric palettes and explicit cover ranges', () => {
  const hard = seaviewLocal.METRIC_DEFINITIONS[0];
  const macro = seaviewLocal.METRIC_DEFINITIONS[1];
  assert.deepEqual(hard.bandLabels, ['0–10%', '10–25%', '25–50%', '50–75%', '75–100%']);
  assert.deepEqual(macro.bandLabels, hard.bandLabels);
  assert.deepEqual([0, 10, 11, 25, 50, 75, 100].map(value => metricBand(value, hard)), [0, 0, 1, 1, 2, 3, 4]);
  assert.notEqual(metricColor(hard.value, 50, { [hard.value]: hard }), metricColor(macro.value, 50, { [macro.value]: macro }));
  assert.equal(seaviewLocal.formatPercentage(0), '0%');
  assert.equal(seaviewLocal.formatPercentage(null), 'Unavailable');
  assert.equal(seaviewLocal.formatPercentage(4.92813589), '4.9%');
});

test('Seaview site display resolves each metric independently and retains exact survey provenance', () => {
  const oldRecord = makeSeaviewRecord({ id: '10001', date: '2016-01-01', hardCoral: 34.8, macroalgae: 4.2 });
  const latestRecord = makeSeaviewRecord({ id: '10002', date: '2018-06-18', hardCoral: null, macroalgae: 0 });
  const definitions = Object.fromEntries(seaviewLocal.METRIC_DEFINITIONS.map(definition => [definition.value, definition]));
  const sites = buildSiteObservations([oldRecord, latestRecord], temporalResolver, new Date('2026-10-03T00:00:00Z'), definitions);

  assert.equal(sites.length, 1);
  assert.equal(sites[0].events.length, 2);
  assert.equal(sites[0].resolutions.seaviewHardCoralCoverPct.value, 34.8);
  assert.equal(sites[0].resolutions.seaviewHardCoralCoverPct.observationDate, '2016-01-01');
  assert.equal(sites[0].resolvedRecords.seaviewHardCoralCoverPct, oldRecord);
  assert.equal(sites[0].resolutions.seaviewMacroalgaeCoverPct.value, 0, 'measured zero remains available on the newest event');
  assert.equal(sites[0].resolutions.seaviewMacroalgaeCoverPct.observationDate, '2018-06-18');
  assert.equal(sites[0].resolvedRecords.seaviewMacroalgaeCoverPct, latestRecord);

  const metadata = { sourceDoi: '10.14264/uql.2019.930', citation: 'Seaview source citation', licenseDisplay: seaviewLocal.LOCAL_ONLY_COPY };
  const hardPopup = seaviewLocal.popupMarkup(sites[0], seaviewLocal.METRIC_DEFINITIONS[0], metadata);
  const macroPopup = seaviewLocal.popupMarkup(sites[0], seaviewLocal.METRIC_DEFINITIONS[1], metadata);
  assert.match(hardPopup, /34\.8%/);
  assert.match(hardPopup, /Jan 1, 2016/);
  assert.match(hardPopup, /Data age/);
  assert.match(hardPopup, /~11 years/);
  assert.match(hardPopup, /2 surveys · 2016–2018/);
  assert.match(hardPopup, /SVII transect photo-quadrat survey with automated benthic image classification/);
  assert.match(hardPopup, /License under clarification — local evaluation only/);
  assert.match(hardPopup, /https:\/\/doi\.org\/10\.14264\/uql\.2019\.930/);
  assert.match(macroPopup, /0%/);
  assert.match(macroPopup, /Jun 18, 2018/);
});

test('view formatting preserves zero and displays null as unavailable', () => {
  const event = makeRecord();
  assert.equal(metricBand(null), null);
  assert.equal(metricColor('liveCoralCoverPct', null), '#87939a');
  assert.equal(formatPercentage(null), '—');
  assert.equal(formatPercentage(undefined), '—');
  assert.equal(formatPercentage(0), '0%');
  assert.equal(recordMetric(event, 'liveCoralCoverPct'), 0);
});

test('survey freshness uses the supplied reference date and specified age bands', () => {
  const reference = new Date('2026-07-01T00:00:00Z');
  assert.equal(surveyAgeOpacity('2024-07-01', reference), 1);
  assert.equal(surveyAgeOpacity('2021-07-02', reference), 0.8);
  assert.equal(surveyAgeOpacity('2016-07-03', reference), 0.6);
  assert.equal(surveyAgeOpacity('2015-07-01', reference), 0.4);
  assert.equal(surveyAgeOpacity(null, reference), 0.4);
});

test('popup uses centralized candidates, preserves layout, and renders unavailable fields safely', () => {
  const event = makeRecord();
  event.protocols[0].metrics.bleaching = {
    bleachedColoniesPct: 0, paleColoniesPct: null, normalColoniesPct: null,
    recentlyDeadColoniesPct: null, colonyCount: null, basis: 'coral-colonies'
  };
  const html = popupMarkup(event, 'liveCoralCoverPct');
  assert.match(html, /LIVE CORAL/);
  assert.match(html, /0%/);
  assert.match(html, /Macroalgae[\s\S]*?—/);
  assert.match(html, /Bleaching[\s\S]*?0%/);
  assert.match(html, /Disease[\s\S]*?—/);
  assert.match(html, /Mortality[\s\S]*?—/);
  assert.match(html, /Sample units/);
});

test('thermal severity bands use DHW magnitude with exact boundary behavior', () => {
  const cases = [[3.99, 'Lower accumulated heat stress'], [4, 'Bleaching-level heat stress'], [8, 'Severe heat stress'], [12, 'Very severe heat stress'], [16, 'Extreme heat stress'], [20, 'Exceptional heat stress']];
  for (const [value, label] of cases) assert.equal(thermalSeverity(value).label, label);
  assert.equal(thermalSeverity(null), null);
});

test('thermal timeline is accessible and distinguishes missing annual values', () => {
  const html = thermalHistoryTimeline([0, 4, null], [2023, 2024, 2025]);
  assert.match(html, /2023: 0\.0 °C-weeks/);
  assert.match(html, /2024: 4\.0 °C-weeks/);
  assert.match(html, /2025: No data/);
  assert.match(html, /role="list"/);
});

test('thermal popup shows recent maximum, year, recurrence, source period, and factual semantics', () => {
  const metadata = { provider:'NOAA Coral Reef Watch', productVersion:'3.7.0', periods:{ fullStart:1985, fullEnd:2025, recentStart:2016, recentEnd:2025 } };
  const html = thermalHistoryPopupMarkup({
    fullValidYears:41, recentValidYears:10, fullHistoryYearsGte4:30, fullHistoryYearsGte8:8,
    recentYearsGte4:6, recentYearsGte8:3, lastSevereYear:2024,
    recentMaxDhw:17.6, recentMaxYear:2024, fullHistoryMaxDhw:30.2, fullHistoryMaxDhwYear:2015,
    recentAnnualValues:[1,3,5,8,11,12,4,13,17.6,5]
  }, metadata);
  for (const expected of ['17.6 °C-weeks', 'Extreme heat stress', '2024', '6 of 10 years', '3 of 10 years', '1985–2025', 'NOAA Coral Reef Watch', 'do not confirm observed bleaching or mortality']) assert.ok(html.includes(expected), expected);
  assert.doesNotMatch(html, /current reef condition|reef health/i);
});

test('Ocean Heat History decodes packed category and daily summary fields from MHW1 chunks', () => {
  const tileSize = 128;
  const column = 37;
  const row = 11;
  const cellIndex = 29;
  const buffer = new ArrayBuffer(8 + tileSize * tileSize * 15);
  const view = new DataView(buffer);
  new Uint8Array(buffer, 0, 4).set([77, 72, 87, 49]);
  view.setUint16(4, column, true);
  view.setUint16(6, row, true);
  const offset = 8 + cellIndex * 15;
  view.setUint8(offset, 3);
  [3652, 1713, 294, 22, 3, 96, 3653].forEach((value, index) => view.setUint16(offset + 1 + index * 2, value, true));

  assert.deepEqual(decodeOceanHeatQueryRecord(buffer, { tileColumn: column, tileRow: row, cellIndex, tileSize }), {
    category: 3, worstDayIndex: 3652, marineHeatwaveDays: 1713,
    strongOrWorseDays: 294, severeOrWorseDays: 22, extremeOrWorseDays: 3,
    longestEpisodeDays: 96, validDays: 3653
  });
  assert.throws(() => decodeOceanHeatQueryRecord(buffer, { tileColumn: 0, tileRow: row, cellIndex, tileSize }), /chunk is invalid/);
});

test('Ocean Heat History popup uses metadata period/category labels and factual NOAA source wording', () => {
  const metadata = require('../../data/reef-condition/ocean-heat-history/metadata.json');
  const html = oceanHeatHistoryPopupMarkup({
    category: 3, date: '2025-12-31', marineHeatwaveDays: 1713,
    strongOrWorseDays: 294, severeOrWorseDays: 22, extremeOrWorseDays: 3,
    longestEpisodeDays: 96, validDays: 3653
  }, metadata);
  for (const expected of [
    'Ocean heat history', 'Period', '2016–2025', 'Peak severity', 'Peak month', 'Dec 2025',
    '1,713', '294', '22', '96 days', 'NOAA Coral Reef Watch'
  ]) assert.ok(html.includes(expected), expected);
  assert.doesNotMatch(html, /reef health|bleaching occurred|mortality occurred/i);
  assert.match(oceanHeatHistoryPopupMarkup(null, metadata), /No valid source value/);
});

test('schema v2 fixture validates and retains representative null and zero cases', () => {
  assert.equal(fixture.schemaVersion, 2);
  assert.equal(validateDataset(fixture).valid, true);
  assert.ok(fixture.records.some(record => record.protocols.some(protocol => Object.values(protocol.metrics).some(metric => Object.values(metric).includes(0)))));
  assert.ok(fixture.records.some(record => record.protocols.some(protocol => Object.values(protocol.metrics).some(metric => Object.values(metric).includes(null)))));
  assert.ok(fixture.records.some(record => record.survey.date === null));
  assert.ok(fixture.records.some(record => record.survey.date && record.survey.date < '2016-01-01'));
  assert.ok(fixture.records.every(record => record.quality.confidenceLevel === null));
  assert.ok(fixture.records.every(record => !('disease' in record.protocols[0].metrics)));
  assert.ok(fixture.records.every(record => !('mortality' in record.protocols[0].metrics)));
});

test('dataset validator rejects unsupported schema versions and missing providers', () => {
  const unsupported = structuredClone(fixture);
  unsupported.schemaVersion = 1;
  assert.ok(validateDataset(unsupported).errors.some(error => error.includes('schemaVersion')));
  const missingProvider = structuredClone(fixture.records[0]);
  missingProvider.provenance.provider = '';
  assert.ok(validateRecord(missingProvider).errors.some(error => error.includes('provider')));
});

test('site grouping prefers provider-scoped source IDs and reports weak or unknown identity explicitly', () => {
  const first = makeRecord({ location: { ...makeRecord().location, sourceSiteId: 'site-42', siteName: 'Known Site' } });
  const renamed = makeRecord({ location: { ...first.location, siteName: 'Renamed Site' } });
  assert.deepEqual(getSurveySiteKey(first, 'local-pilot'), getSurveySiteKey(renamed, 'local-pilot'));
  assert.equal(getSurveySiteKey(first, 'local-pilot').type, 'SOURCE_ID');
  const differentSite = makeRecord({ location: { ...first.location, sourceSiteId: 'site-43', siteName: 'Known Site' } });
  assert.notEqual(getSurveySiteKey(first, 'local-pilot').key, getSurveySiteKey(differentSite, 'local-pilot').key);
  const synthetic = makeRecord();
  assert.equal(getSurveySiteKey(synthetic, 'synthetic').type, 'FALLBACK_NAME_COORDINATE');
  assert.equal(getSurveySiteKey(synthetic, 'local-pilot').type, 'UNKNOWN');
  assert.equal(getSurveySiteKey(makeRecord({ location: { ...synthetic.location, sourceSiteId: ' ' } }), 'local-pilot').type, 'UNKNOWN');
  assert.ok(validateRecord(makeRecord({ location: { ...synthetic.location, sourceSiteId: 12 } })).errors.some(error => error.includes('sourceSiteId')));
});

test('dataset source status is selected from metadata, not inferred from record shape', () => {
  assert.equal(datasetStatusText(fixture.metadata), 'DiveAtlas synthetic fixture');
  assert.equal(datasetStatusText({ provider: 'MERMAID' }), 'MERMAID');
  assert.match(datasetStatusExplanation(fixture.metadata), /supplied by DiveAtlas synthetic fixture/);
  assert.equal(datasetStatusText(null), 'Field observations');
  assert.equal(validateDataset(fixture).valid, true);
});
