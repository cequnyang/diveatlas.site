(function attachSeaviewLocalResearch(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasSeaviewLocalResearch = api;
})(typeof window === 'undefined' ? globalThis : window, function buildSeaviewLocalResearch(root) {
  const PROVIDER_ID = 'seaview-local-research';
  const PROVIDER_NAME = 'XL Catlin Seaview Survey';
  const METADATA_URL = './data/.build/reef_condition/seaview/metadata.json';
  const DATA_URL = './data/.build/reef_condition/seaview/canonical.json.gz';
  const LOCAL_ONLY_COPY = 'License under clarification — local evaluation only';
  const METRIC_DEFINITIONS = Object.freeze([
    Object.freeze({
      value: 'seaviewHardCoralCoverPct',
      schemaMetric: 'hardCoralCover',
      providerId: PROVIDER_ID,
      label: 'Hard Coral Cover',
      shortLabel: 'HARD CORAL COVER',
      colors: Object.freeze(['#edf3f8', '#bdd7e7', '#6baed6', '#2171b5', '#08306b']),
      bandUpperBounds: Object.freeze([10, 25, 50, 75, 100]),
      bandLabels: Object.freeze(['0–10%', '10–25%', '25–50%', '50–75%', '75–100%']),
      siteLevelDisplay: true,
      legendMarkup: seaviewLegendMarkup,
      popupMarkup: seaviewPopupMarkup
    }),
    Object.freeze({
      value: 'seaviewMacroalgaeCoverPct',
      schemaMetric: 'macroalgaeCover',
      providerId: PROVIDER_ID,
      label: 'Macroalgae Cover',
      shortLabel: 'MACROALGAE COVER',
      colors: Object.freeze(['#f2efe8', '#dfc27d', '#bf812d', '#80cdc1', '#35978f']),
      bandUpperBounds: Object.freeze([10, 25, 50, 75, 100]),
      bandLabels: Object.freeze(['0–10%', '10–25%', '25–50%', '50–75%', '75–100%']),
      siteLevelDisplay: true,
      legendMarkup: seaviewLegendMarkup,
      popupMarkup: seaviewPopupMarkup
    })
  ]);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function formatPercentage(value) {
    return value == null || !Number.isFinite(Number(value)) ? 'Unavailable' : `${Number(value).toFixed(1).replace(/\.0$/, '')}%`;
  }

  function formatDate(value) {
    if (!value) return 'Unavailable';
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? 'Unavailable' : new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
  }

  function formatAge(ageDays) {
    if (!Number.isInteger(ageDays)) return 'Unavailable';
    if (ageDays < 30) return `~${ageDays} days`;
    if (ageDays < 365) return `~${Math.max(1, Math.round(ageDays / 30.4375))} months`;
    return `~${Math.max(1, Math.round(ageDays / 365.2425))} years`;
  }

  function seaviewLegendMarkup(definition) {
    return `<div class="reef-survey-legend-title">${escapeHtml(definition.label.toUpperCase())} <span>Latest available survey observation</span></div><div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;margin-top:7px">${definition.bandLabels.map((label, index) => `<span style="display:flex;align-items:center;gap:4px;min-width:0;color:var(--layers-legend-meta,var(--text-muted));font-size:9px;line-height:1.2;font-variant-numeric:tabular-nums"><i style="flex:0 0 9px;width:9px;height:9px;border:1px solid rgba(25,40,55,.18);border-radius:2px;background:${definition.colors[index]}" aria-hidden="true"></i>${escapeHtml(label)}</span>`).join('')}</div><div style="margin-top:8px;color:var(--layers-legend-meta,var(--text-muted));font-size:10px;line-height:1.4">0–100% observed benthic cover · Source: Seaview Survey<br>Historical field evidence. Most observations are from 2012–2018.</div>`;
  }

  function seaviewPopupMarkup(site, definition, sourceMetadata) {
    const resolution = site.resolutions[definition.value];
    const selectedRecord = site.resolvedRecords[definition.value] || site.record;
    const protocol = selectedRecord.protocols.find(candidate => candidate.metrics?.[definition.schemaMetric]) || selectedRecord.protocols[0];
    const dates = site.events.map(event => event.survey.date).filter(Boolean).sort();
    const dateSpan = dates.length ? `${dates[0].slice(0, 4)}–${dates.at(-1).slice(0, 4)}` : '—';
    const value = resolution.status === 'unique' ? formatPercentage(resolution.value) : 'Unavailable';
    const age = resolution.status === 'unique' ? formatAge(resolution.ageDays) : 'Unavailable';
    const observationDate = resolution.status === 'unique' ? formatDate(resolution.observationDate) : 'Unavailable';
    const method = protocol?.method || 'Unavailable';
    const siteId = site.record.location.sourceSiteId || site.record.provenance.sourceRecordId || 'Unavailable';
    const repeat = site.events.length > 1 ? `${site.events.length} surveys · ${dateSpan}` : '1 survey';
    const doiPath = sourceMetadata.sourceDoi.split('/').map(encodeURIComponent).join('/');
    const doiUrl = `https://doi.org/${doiPath}`;
    const field = (label, content) => `<div class="bio-popup-field" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.35fr);align-items:start;gap:8px"><span class="bio-popup-field__label" style="min-width:0;white-space:normal;overflow-wrap:anywhere">${label}</span><span class="bio-popup-field__value" style="min-width:0;text-align:right;white-space:normal;overflow-wrap:anywhere;word-break:break-word">${content}</span></div>`;
    return `<div class="bio-popup reef-survey-popup" style="width:min(330px,calc(100vw - 56px));max-height:min(62vh,440px);overflow-y:auto"><div class="bio-popup-title">${escapeHtml(definition.shortLabel)}</div><div class="bio-popup-site">${escapeHtml(site.record.location.siteName || `Transect ${siteId}`)}</div><div class="reef-survey-popup-primary"><span>Observed benthic cover</span><strong>${value}</strong></div><div class="bio-popup-fields">${field('Observed', escapeHtml(observationDate))}${field('Data age', escapeHtml(age))}${field('Survey method', escapeHtml(method))}${field('Transect / site', escapeHtml(siteId))}${field('Repeat surveys', escapeHtml(repeat))}${field('Source', 'Seaview Survey')}${field('Citation', `<a href="${doiUrl}" target="_blank" rel="noopener">${escapeHtml(sourceMetadata.citation)}</a>`)}${field('License', escapeHtml(sourceMetadata.licenseDisplay))}</div><div style="margin-top:9px;padding-top:7px;border-top:1px solid var(--line);color:var(--layers-legend-meta,var(--text-muted));font-size:10px;line-height:1.4">Local research preview only. License terms are still under clarification.</div></div>`;
  }

  function isLocalResearchEnabled(location = root.location) {
    if (!location) return false;
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    if (!localHosts.has(String(location.hostname || '').toLowerCase())) return false;
    return new URLSearchParams(location.search || '').get('reefConditionLocalResearch') === '1';
  }

  function validateMetadata(value) {
    const dateRange = value && value.dateRange;
    const isIsoDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
    if (!value || value.schemaVersion !== 1 || value.provider !== PROVIDER_NAME ||
        value.sourceDoi !== '10.14264/uql.2019.930' || value.sourceUrl !== 'https://doi.org/10.14264/uql.2019.930' ||
        value.dataUrl !== DATA_URL || value.canonicalSchemaVersion !== 3 ||
        !Number.isInteger(value.eventCount) || value.eventCount < 1 ||
        !Number.isInteger(value.siteCount) || value.siteCount < 1 ||
        !isIsoDate(dateRange?.from) || !isIsoDate(dateRange?.to) || dateRange.from > dateRange.to ||
        value.licenseReview?.status !== 'conflicting' ||
        value.licenseReview?.productionRedistributionApproved !== false ||
        value.licenseDisplay !== LOCAL_ONLY_COPY || value.productionRedistributionApproved !== false ||
        typeof value.citation !== 'string' || !value.citation.trim() ||
        typeof value.methodology !== 'string' || !value.methodology.trim() ||
        typeof value.displayStatus !== 'string' || !value.displayStatus.trim() ||
        typeof value.displayExplanation !== 'string' || !value.displayExplanation.trim() ||
        !Number.isInteger(value.canonicalByteSize) || value.canonicalByteSize < 1) {
      throw new TypeError('Seaview local-research metadata is incomplete or outside its local-only contract.');
    }
    return Object.freeze({ ...value, dateRange: Object.freeze({ ...dateRange }), licenseReview: Object.freeze({ ...value.licenseReview }) });
  }

  async function decompressGzip(bytes) {
    if (typeof DecompressionStream === 'function' && typeof Blob === 'function' && typeof Response === 'function') {
      return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }
    if (typeof module === 'object' && module.exports) return require('node:zlib').gunzipSync(Buffer.from(bytes));
    throw new Error('This browser cannot decompress the local Seaview evaluation dataset.');
  }

  function createProvider({ providerApi, schemaApi, fetchImpl, location = root.location, enabled = false } = {}) {
    if (!providerApi || !schemaApi) throw new TypeError('Reef Condition provider and schema APIs are required.');
    const fetcher = fetchImpl || ((...args) => fetch(...args));
    let loadPromise = null;
    return providerApi.createProvider({
      id: PROVIDER_ID,
      kind: providerApi.PROVIDER_KINDS.FIELD_OBSERVATIONS,
      async load({ signal } = {}) {
        if (!enabled || !isLocalResearchEnabled(location)) {
          throw new Error('Seaview research data is available only on an explicitly enabled local development origin.');
        }
        if (!loadPromise) {
          loadPromise = (async () => {
            const metadataResponse = await fetcher(METADATA_URL, { signal, cache: 'force-cache' });
            if (!metadataResponse || !metadataResponse.ok) throw new Error(`Seaview local metadata is unavailable${metadataResponse ? ` (${metadataResponse.status})` : ''}.`);
            const metadata = validateMetadata(await metadataResponse.json());
            const dataResponse = await fetcher(metadata.dataUrl, { signal, cache: 'force-cache' });
            if (!dataResponse || !dataResponse.ok) throw new Error(`Seaview local observations are unavailable${dataResponse ? ` (${dataResponse.status})` : ''}.`);
            const compressed = await dataResponse.arrayBuffer();
            const decoded = await decompressGzip(compressed);
            const dataset = JSON.parse(new TextDecoder().decode(decoded));
            const validation = schemaApi.validateDataset(dataset);
            if (!validation.valid) throw new TypeError(`Invalid Seaview canonical dataset: ${validation.errors.join('; ')}`);
            if (dataset.schemaVersion !== metadata.canonicalSchemaVersion ||
                dataset.metadata.provider !== metadata.provider ||
                dataset.records.length !== metadata.eventCount ||
                dataset.metadata.sourceSiteCount !== metadata.siteCount ||
                dataset.metadata.licenseReview?.status !== 'conflicting' ||
                dataset.metadata.licenseReview?.productionRedistributionApproved !== false) {
              throw new TypeError('Seaview canonical data does not match its local-only metadata.');
            }
            return Object.freeze({
              kind: providerApi.PROVIDER_KINDS.FIELD_OBSERVATIONS,
              dataset,
              sourceMetadata: metadata
            });
          })().catch(error => { loadPromise = null; throw error; });
        }
        return loadPromise;
      }
    });
  }

  function createFeature({ providerApi, schemaApi, fetchImpl, location = root.location } = {}) {
    if (!isLocalResearchEnabled(location)) return Object.freeze({ enabled: false, providers: Object.freeze([]), metricDefinitions: METRIC_DEFINITIONS });
    return Object.freeze({
      enabled: true,
      providers: Object.freeze([createProvider({ providerApi, schemaApi, fetchImpl, location, enabled: true })]),
      metricDefinitions: METRIC_DEFINITIONS
    });
  }

  return Object.freeze({
    PROVIDER_ID,
    PROVIDER_NAME,
    METADATA_URL,
    DATA_URL,
    LOCAL_ONLY_COPY,
    METRIC_DEFINITIONS,
    formatPercentage,
    popupMarkup: seaviewPopupMarkup,
    isLocalResearchEnabled,
    validateMetadata,
    createProvider,
    createFeature
  });
});
