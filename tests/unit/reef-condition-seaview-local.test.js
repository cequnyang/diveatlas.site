const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const localApi = require('../../js/reef-condition-seaview-local.js');
const providerApi = require('../../js/reef-condition-provider.js');
const schemaApi = require('../../js/reef-survey-schema.js');

function canonicalDataset() {
  const provider = localApi.PROVIDER_NAME;
  const record = {
    schemaVersion: 3,
    id: 'seaview-survey-1',
    location: { lat: -16.1, lon: 145.8, siteName: null, region: 'Pacific Australia', country: 'AUS', sourceSiteId: 'transect-1' },
    survey: { date: '2017-06-15', datePrecision: 'day', managementRegime: null, sampleId: 'survey-1', sourceRowNumber: 1 },
    protocols: [{
      method: 'SVII transect photo-quadrat survey with automated benthic image classification',
      sourceMethod: 'Image classification', sampleUnitCount: 10, depth: null, dataPolicy: null,
      metrics: {
        hardCoralCover: { valuePct: 0, sdPct: null, basis: 'benthic-cover' },
        macroalgaeCover: { valuePct: null, sdPct: null, basis: 'benthic-cover' }
      }
    }],
    quality: { confidenceLevel: null },
    provenance: {
      provider, projectId: null, sourceRecordId: 'survey-1', projectName: 'XL Catlin Seaview Survey Project',
      suggestedCitation: 'Source citation', license: null, sourceUrl: 'https://doi.org/10.14264/uql.2019.930'
    }
  };
  return {
    schemaVersion: 3,
    metadata: {
      provider, datasetType: 'local-pilot', eventCount: 1, sourceSiteCount: 1,
      generatedAt: '2026-10-02T00:00:00Z', redistributionApproved: null,
      dateRange: { from: '2017-06-15', to: '2017-06-15' },
      licenseReview: { status: 'conflicting', productionRedistributionApproved: false }
    },
    records: [record]
  };
}

function metadataFor(dataset, compressedBytes) {
  return {
    schemaVersion: 1,
    provider: localApi.PROVIDER_NAME,
    sourceDoi: '10.14264/uql.2019.930',
    sourceUrl: 'https://doi.org/10.14264/uql.2019.930',
    citation: 'Seaview source citation',
    dataUrl: localApi.DATA_URL,
    canonicalSchemaVersion: 3,
    generatedAt: '2026-10-02T00:00:00Z',
    eventCount: dataset.records.length,
    siteCount: dataset.metadata.sourceSiteCount,
    dateRange: dataset.metadata.dateRange,
    methodology: 'SVII transect photo-quadrat survey with automated benthic image classification',
    displayStatus: 'Seaview Survey · Local research',
    displayExplanation: 'License under clarification — local evaluation only.',
    licenseReview: { status: 'conflicting', productionRedistributionApproved: false },
    licenseDisplay: localApi.LOCAL_ONLY_COPY,
    productionRedistributionApproved: false,
    canonicalByteSize: compressedBytes
  };
}

test('Seaview feature gate requires both localhost and an explicit research query flag', () => {
  assert.equal(localApi.isLocalResearchEnabled({ hostname: 'localhost', search: '?reefConditionLocalResearch=1' }), true);
  assert.equal(localApi.isLocalResearchEnabled({ hostname: '127.0.0.1', search: '?reefConditionLocalResearch=1' }), true);
  assert.equal(localApi.isLocalResearchEnabled({ hostname: 'diveatlas.site', search: '?reefConditionLocalResearch=1' }), false);
  assert.equal(localApi.isLocalResearchEnabled({ hostname: 'localhost', search: '' }), false);
  const disabled = localApi.createFeature({ providerApi, schemaApi, location: { hostname: 'localhost', search: '' } });
  assert.equal(disabled.enabled, false);
  assert.deepEqual(disabled.providers, []);
});

test('Seaview provider stops before requests when disabled or outside the local flag', async () => {
  const requests = [];
  const feature = localApi.createFeature({
    providerApi, schemaApi,
    location: { hostname: 'diveatlas.site', search: '?reefConditionLocalResearch=1' },
    fetchImpl: async url => { requests.push(url); throw new Error('unexpected fetch'); }
  });
  assert.equal(feature.enabled, false);
  assert.deepEqual(requests, []);

  const provider = localApi.createProvider({
    providerApi, schemaApi,
    location: { hostname: 'localhost', search: '' },
    enabled: false,
    fetchImpl: async url => { requests.push(url); throw new Error('unexpected fetch'); }
  });
  await assert.rejects(provider.load(), /explicitly enabled local development origin/);
  assert.deepEqual(requests, []);
});

test('local Seaview provider lazily validates metadata and canonical gzip once, preserving zero and null', async () => {
  const dataset = canonicalDataset();
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(dataset)));
  const metadata = metadataFor(dataset, compressed.length);
  const requests = [];
  const feature = localApi.createFeature({
    providerApi, schemaApi,
    location: { hostname: '127.0.0.1', search: '?reefConditionLocalResearch=1' },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url === localApi.METADATA_URL) return { ok: true, json: async () => metadata };
      return { ok: true, arrayBuffer: async () => compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength) };
    }
  });

  assert.equal(feature.enabled, true);
  assert.equal(feature.providers[0].id, localApi.PROVIDER_ID);
  assert.deepEqual(requests, [], 'creating the feature does not fetch metadata or records');
  const loaded = await feature.providers[0].load();
  const loadedAgain = await feature.providers[0].load();
  assert.equal(loaded.kind, providerApi.PROVIDER_KINDS.FIELD_OBSERVATIONS);
  assert.equal(loaded.sourceMetadata.eventCount, 1);
  assert.equal(loaded.dataset.records[0].protocols[0].metrics.hardCoralCover.valuePct, 0);
  assert.equal(loaded.dataset.records[0].protocols[0].metrics.macroalgaeCover.valuePct, null);
  assert.equal(loadedAgain.dataset, loaded.dataset, 'metric switching can reuse the same decoded dataset');
  assert.deepEqual(requests.map(request => request.url), [localApi.METADATA_URL, localApi.DATA_URL]);
  assert.ok(requests.every(request => request.options.cache === 'force-cache'));
});

test('Seaview provider rejects production-approved metadata and mismatched canonical bundles', async () => {
  const dataset = canonicalDataset();
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(dataset)));
  const metadata = metadataFor(dataset, compressed.length);
  metadata.licenseReview = { status: 'CC BY 3.0', productionRedistributionApproved: true };
  const provider = localApi.createFeature({
    providerApi, schemaApi,
    location: { hostname: 'localhost', search: '?reefConditionLocalResearch=1' },
    fetchImpl: async url => url === localApi.METADATA_URL
      ? { ok: true, json: async () => metadata }
      : { ok: true, arrayBuffer: async () => compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength) }
  });
  await assert.rejects(provider.providers[0].load(), /metadata is incomplete or outside its local-only contract/);
});
