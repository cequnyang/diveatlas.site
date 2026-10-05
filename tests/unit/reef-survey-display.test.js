const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DISPLAY_MODES,
  buildSiteObservations,
  sitePopupMarkup
} = require('../../js/reef-survey-condition-view.js');
const resolver = require('../../js/reef-survey-temporal-resolver.js');

function event(id, date, liveCoral, macroalgae, siteId = 'source-site-1') {
  return {
    schemaVersion: 2,
    id,
    location: { lat: -0.55, lon: 130.6, siteName: 'Test Reef', sourceSiteId: siteId, region: 'Raja Ampat', country: 'Indonesia' },
    survey: { date, managementRegime: null },
    protocols: [{
      method: 'PIT', sourceMethod: null, sampleUnitCount: 4,
      depth: null,
      metrics: {
        liveCoralCover: liveCoral === 'absent' ? undefined : { valuePct: liveCoral, sdPct: null, basis: 'benthic-cover' },
        macroalgaeCover: macroalgae === 'absent' ? undefined : { valuePct: macroalgae, sdPct: null, basis: 'benthic-cover' }
      },
      dataPolicy: null
    }],
    quality: { confidenceLevel: null },
    provenance: { provider: 'MERMAID', projectId: null, sourceRecordId: null, projectName: null, suggestedCitation: null, license: null, sourceUrl: null }
  };
}

function popupFor(events, metric = 'liveCoralCoverPct', referenceDate = '2026-06-01') {
  const site = buildSiteObservations(events, resolver, referenceDate)[0];
  return { site, html: sitePopupMarkup(site, metric) };
}

test('site display groups a provider-scoped source site and resolves a newer event metric', () => {
  const observations = buildSiteObservations([
    event('older', '2019-05-20', 35, 2),
    event('newer', '2024-06-12', 48, 0)
  ], resolver);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].resolutions.liveCoralCoverPct.value, 48);
  assert.equal(observations[0].resolutions.liveCoralCoverPct.sourceEventId, 'newer');
  assert.equal(observations[0].resolutions.macroalgaeCoverPct.value, 0);
  assert.equal(DISPLAY_MODES.SITE_LATEST_AVAILABLE, 'site-latest-available');
});

test('a newer event without live coral resolves to the older available observation and shows its date', () => {
  const { site, html } = popupFor([
    event('older', '2019-05-20', 35, 2),
    event('newer', '2024-06-12', 'absent', 5)
  ]);
  assert.equal(site.resolutions.liveCoralCoverPct.value, 35);
  assert.equal(site.resolutions.liveCoralCoverPct.observationDate, '2019-05-20');
  assert.match(html, /35%/);
  assert.match(html, /Observed: May 2019/);
  assert.match(html, /Data age: ~7 years/);
  assert.match(html, /Source[\s\S]*?MERMAID/);
  assert.doesNotMatch(html, /current condition/i);
});

test('popup reports recent evidence age from the selected observation date', () => {
  const { html, site } = popupFor([event('recent', '2026-05-20', 55, 2)]);
  assert.equal(site.resolutions.liveCoralCoverPct.ageDays, 12);
  assert.match(html, /Observed: May 2026/);
  assert.match(html, /Data age: ~12 days/);
});

test('undated resolved metrics show no observation date or age', () => {
  const { html, site } = popupFor([event('undated', null, 55, 2)]);
  assert.equal(site.resolutions.liveCoralCoverPct.status, 'unique');
  assert.equal(site.resolutions.liveCoralCoverPct.ageDays, null);
  assert.match(html, /Observed: —/);
  assert.match(html, /Data age: —/);
});

test('an ambiguous newest event is unavailable with an explanation and does not fall back', () => {
  const newer = event('newer', '2024-06-12', 48, 5);
  newer.protocols.push({ ...newer.protocols[0], method: 'LIT', metrics: {
    liveCoralCover: { valuePct: 60, sdPct: null, basis: 'benthic-cover' }
  } });
  const { site, html } = popupFor([event('older', '2019-05-20', 35, 2), newer]);
  assert.equal(site.resolutions.liveCoralCoverPct.status, 'ambiguous');
  assert.equal(site.resolutions.liveCoralCoverPct.value, null);
  assert.match(html, /Unavailable/);
  assert.match(html, /Multiple compatible observations share the newest survey date/);
  assert.doesNotMatch(html, /Observed: May 2019/);
});

test('a missing metric is shown as unavailable while another site remains isolated', () => {
  const missing = event('missing', '2024-06-12', 'absent', 'absent');
  const otherSite = event('other', '2024-06-12', 91, 1, 'source-site-2');
  const observations = buildSiteObservations([missing, otherSite], resolver);
  assert.equal(observations.length, 2);
  assert.equal(observations[0].resolutions.liveCoralCoverPct.status, 'missing');
  assert.equal(observations[0].metricValues.liveCoralCoverPct, null);
  assert.equal(observations[1].resolutions.liveCoralCoverPct.value, 91);
  assert.match(sitePopupMarkup(observations[0], 'liveCoralCoverPct'), /No compatible metric observation is available/);
});
