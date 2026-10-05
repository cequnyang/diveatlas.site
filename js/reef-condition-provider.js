(function attachReefConditionProvider(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasReefConditionProvider = api;
})(typeof window === 'undefined' ? globalThis : window, function buildReefConditionProvider(root) {
  const PROVIDER_KINDS = Object.freeze({
    RASTER_CONDITION: 'raster-condition-layer',
    FIELD_OBSERVATIONS: 'field-observations',
    FUTURE_MODEL: 'future-model'
  });
  const DEFAULT_FIELD_DATASET_URL = './data/reef-condition/field-observations.json';
  const DEFAULT_NOAA_HISTORY_METADATA_URL = './data/reef-condition/thermal-stress-history/metadata.json';
  const DEFAULT_NOAA_MHW_HISTORY_METADATA_URL = './data/reef-condition/ocean-heat-history/metadata.json';

  function createProvider({ id, kind, load }) {
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('Provider id is required.');
    if (!Object.values(PROVIDER_KINDS).includes(kind)) throw new TypeError(`Unsupported Reef Condition provider kind: ${kind}`);
    if (typeof load !== 'function') throw new TypeError('Provider load() is required.');
    return Object.freeze({ id, kind, load });
  }

  function createFieldObservationsProvider({
    id = 'field-observations',
    datasetUrl = DEFAULT_FIELD_DATASET_URL,
    fetchImpl = (...args) => fetch(...args)
  } = {}) {
    return createProvider({
      id,
      kind: PROVIDER_KINDS.FIELD_OBSERVATIONS,
      async load({ signal } = {}) {
        const response = await fetchImpl(datasetUrl, { signal, cache: 'force-cache' });
        if (!response || !response.ok) throw new Error(`Reef survey dataset is unavailable${response ? ` (${response.status})` : ''}.`);
        const dataset = await response.json();
        const schema = typeof module === 'object' && module.exports
          ? require('./reef-survey-schema.js')
          : root.DiveAtlasReefSurveySchema;
        if (!schema) throw new Error('Reef Survey schema validator is unavailable.');
        const validation = schema.validateDataset(dataset);
        if (!validation.valid) throw new TypeError(`Invalid Reef Survey dataset: ${validation.errors.join('; ')}`);
        return Object.freeze({ kind: PROVIDER_KINDS.FIELD_OBSERVATIONS, dataset });
      }
    });
  }

  function createRasterConditionProvider({ id = 'raster-condition', load } = {}) {
    return createProvider({ id, kind: PROVIDER_KINDS.RASTER_CONDITION, load });
  }

  function validateNoaaThermalHistoryMetadata(value) {
    const periods = value && value.periods;
    const grid = value && value.grid;
    const encoding = value && value.encoding;
    const minZoom = encoding?.min_zoom ?? 0;
    const maxNativeZoom = encoding?.max_native_zoom ?? encoding?.map_zoom;
    if (!value || value.schema_version !== 1 || value.provider !== 'NOAA Coral Reef Watch' ||
        value.product !== 'Thermal History Annual History' || !value.productVersion ||
        value.variable !== 'ann_max_dhw' || value.units !== 'degrees_Celsius-weeks' ||
        !value.attribution || !value.sourceUrl || !value.asset_base || !value.map_tile_template ||
        !value.query_tile_template || !Number.isInteger(periods?.fullStart) || !Number.isInteger(periods?.fullEnd) ||
        !Number.isInteger(periods?.recentStart) || !Number.isInteger(periods?.recentEnd) ||
        periods.fullStart > periods.recentStart || periods.recentStart > periods.recentEnd ||
        periods.recentEnd - periods.recentStart !== 9 ||
        value.recentYears !== 10 ||
        periods.fullEnd !== periods.recentEnd || !Array.isArray(value.thresholds) ||
        value.thresholds.length !== 5 || value.thresholds.some((threshold, index) => threshold !== [4, 8, 12, 16, 20][index]) ||
        !Number.isInteger(grid?.width) || !Number.isInteger(grid?.height) ||
        !Number.isFinite(grid?.longitude_min) || !Number.isFinite(grid?.longitude_step) ||
        !Number.isFinite(grid?.latitude_min) || !Number.isFinite(grid?.latitude_step) ||
        encoding?.query_format?.includes('DCHR v2') !== true || encoding?.query_format?.includes('uint16 hundredths') !== true ||
        minZoom !== 0 || encoding?.map_zoom !== 5 || maxNativeZoom !== 5 ||
        encoding?.query_tile_size_cells !== 256 || encoding?.query_bytes_per_cell !== 38) {
      throw new TypeError('NOAA thermal-history metadata is incomplete or unsupported.');
    }
    return Object.freeze({
      provider: value.provider,
      product: value.product,
      productVersion: value.productVersion,
      periods: Object.freeze({ ...periods }),
      variable: value.variable,
      units: value.units,
      thresholds: Object.freeze([...value.thresholds]),
      attribution: value.attribution,
      sourceUrl: value.sourceUrl,
      sourcePageUrl: value.sourcePageUrl || value.sourceUrl,
      sourceMetadata: value.sourceMetadata,
      assetBase: value.asset_base,
      tileTemplate: value.map_tile_template,
      queryTileTemplate: value.query_tile_template,
      queryTileSizeCells: encoding.query_tile_size_cells,
      queryBytesPerCell: encoding.query_bytes_per_cell,
      grid: Object.freeze({ ...grid }),
      version: value.version,
      minZoom,
      maxNativeZoom,
      categories: Object.freeze([...(value.categories || [])])
    });
  }

  function createNoaaThermalHistoryProvider({
    id = 'noaa-crw-thermal-history', metadataUrl = DEFAULT_NOAA_HISTORY_METADATA_URL,
    fetchImpl = (...args) => fetch(...args)
  } = {}) {
    let metadataPromise = null;
    return createRasterConditionProvider({
      id,
      async load({ signal } = {}) {
        if (!metadataPromise) {
          metadataPromise = Promise.resolve().then(() => fetchImpl(metadataUrl, { signal, cache: 'no-cache' }))
            .then(response => { if (!response || !response.ok) throw new Error(`NOAA thermal-history raster is unavailable${response ? ` (${response.status})` : ''}.`); return response.json(); })
            .then(validateNoaaThermalHistoryMetadata)
            .catch(error => { metadataPromise = null; throw error; });
        }
        return Object.freeze({ kind: PROVIDER_KINDS.RASTER_CONDITION, raster: await metadataPromise });
      }
    });
  }

  function validateNoaaMhwHistoryMetadata(value) {
    const period = value && value.sourcePeriod;
    const grid = value && value.displayGrid;
    const query = value && value.query;
    const categories = value && value.categories;
    const expectedLabels = ['No marine heatwave', 'Moderate', 'Strong', 'Severe', 'Extreme', 'Beyond extreme'];
    const isIsoDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
    if (!value || value.schemaVersion !== 1 || value.provider !== 'NOAA Coral Reef Watch' ||
        value.product !== 'Marine Heatwave Watch' || value.productVersion !== '1.0.1' ||
        value.sourceVariable !== 'heatwave_category' || value.metric !== 'Worst marine heatwave category' ||
        !value.attribution || !value.sourceUrl || value.assetBase !== './data/reef-condition/ocean-heat-history' ||
        value.tileTemplate !== 'tiles/{z}/{x}/{y}.png' || value.queryTileTemplate !== 'query/{column}_{row}.bin.gz' ||
        !Number.isInteger(period?.startYear) || !Number.isInteger(period?.endYear) ||
        period.endYear - period.startYear !== 9 || period.completeYears !== 10 ||
        !isIsoDate(period.start) || !isIsoDate(period.end) ||
        new Date(`${period.start}T00:00:00Z`).getUTCFullYear() !== period.startYear ||
        new Date(`${period.end}T00:00:00Z`).getUTCFullYear() !== period.endYear ||
        period.start !== `${period.startYear}-01-01` || period.end !== `${period.endYear}-12-31` ||
        grid?.width !== 1440 || grid?.height !== 720 || grid?.longitudeMin !== -179.875 ||
        grid?.latitudeMin !== -89.875 || grid?.stepDegrees !== 0.25 || grid?.rowOrder !== 'south-to-north' ||
        !Number.isInteger(value.tileMinZoom) || value.tileMinZoom !== 0 || value.tileMaxNativeZoom !== 5 ||
        query?.format !== 'MHW1' || query?.headerBytes !== 8 || query?.tileSizeCells !== 128 ||
        query?.bytesPerCell !== 15 || query?.missingValue !== 255 ||
        !Array.isArray(query?.fields) || query.fields.length !== 8 ||
        !Array.isArray(categories) || categories.length !== expectedLabels.length ||
        categories.some((category, index) => category?.code !== index || category?.label !== expectedLabels[index] ||
          typeof category.color !== 'string' || !/^#[\da-f]{6}$/i.test(category.color)) ||
        typeof value.version !== 'string' || !value.version.trim()) {
      throw new TypeError('NOAA ocean heat-history metadata is incomplete or unsupported.');
    }
    return Object.freeze({
      provider: value.provider,
      product: value.product,
      productVersion: value.productVersion,
      sourceVariable: value.sourceVariable,
      metric: value.metric,
      sourceUrl: value.sourceUrl,
      attribution: value.attribution,
      sourcePeriod: Object.freeze({ ...period }),
      displayGrid: Object.freeze({ ...grid }),
      semantics: value.semantics,
      temporalSpatialSemantics: value.temporalSpatialSemantics,
      categories: Object.freeze(categories.map(category => Object.freeze({ ...category }))),
      assetBase: value.assetBase,
      tileTemplate: value.tileTemplate,
      tileMinZoom: value.tileMinZoom,
      tileMaxNativeZoom: value.tileMaxNativeZoom,
      queryTileTemplate: value.queryTileTemplate,
      query: Object.freeze({ ...query, fields: Object.freeze([...query.fields]) }),
      version: value.version,
      generatedAt: value.generatedAt,
      assets: value.assets ? Object.freeze({ ...value.assets }) : null
    });
  }

  function createNoaaMhwHistoryProvider({
    id = 'noaa-crw-ocean-heat-history', metadataUrl = DEFAULT_NOAA_MHW_HISTORY_METADATA_URL,
    fetchImpl = (...args) => fetch(...args)
  } = {}) {
    let metadataPromise = null;
    return createRasterConditionProvider({
      id,
      async load({ signal } = {}) {
        if (!metadataPromise) {
          metadataPromise = Promise.resolve().then(() => fetchImpl(metadataUrl, { signal, cache: 'force-cache' }))
            .then(response => { if (!response || !response.ok) throw new Error(`NOAA ocean heat-history raster is unavailable${response ? ` (${response.status})` : ''}.`); return response.json(); })
            .then(validateNoaaMhwHistoryMetadata)
            .catch(error => { metadataPromise = null; throw error; });
        }
        return Object.freeze({ kind: PROVIDER_KINDS.RASTER_CONDITION, raster: await metadataPromise });
      }
    });
  }

  function createFutureModelProvider({ id = 'future-model', load } = {}) {
    return createProvider({ id, kind: PROVIDER_KINDS.FUTURE_MODEL, load });
  }

  function createProviderRegistry(providers, initialProviderId) {
    const entries = new Map((providers || []).map(provider => {
      if (!provider || !Object.values(PROVIDER_KINDS).includes(provider.kind) || typeof provider.load !== 'function') {
        throw new TypeError('Every provider must implement a supported kind and load().');
      }
      return [provider.id, provider];
    }));
    if (!entries.size) throw new TypeError('At least one Reef Condition provider is required.');
    let selectedId = initialProviderId || entries.keys().next().value;
    if (!entries.has(selectedId)) throw new TypeError(`Unknown initial Reef Condition provider: ${selectedId}`);
    return Object.freeze({
      get selectedId() { return selectedId; },
      get selected() { return entries.get(selectedId); },
      select(id) {
        if (!entries.has(id)) return false;
        selectedId = id;
        return true;
      },
      load(options) { return entries.get(selectedId).load(options); },
      list() { return [...entries.values()]; }
    });
  }

  return Object.freeze({
    PROVIDER_KINDS,
    DEFAULT_FIELD_DATASET_URL,
    DEFAULT_NOAA_HISTORY_METADATA_URL,
    DEFAULT_NOAA_MHW_HISTORY_METADATA_URL,
    createProvider,
    createFieldObservationsProvider,
    createRasterConditionProvider,
    validateNoaaThermalHistoryMetadata,
    validateNoaaMhwHistoryMetadata,
    createNoaaThermalHistoryProvider,
    createNoaaMhwHistoryProvider,
    createFutureModelProvider,
    createProviderRegistry
  });
});
