(function attachReefSurveySchema(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasReefSurveySchema = api;
})(typeof window === 'undefined' ? globalThis : window, function buildReefSurveySchema() {
  const SCHEMA_VERSION = 3;
  const SUPPORTED_SCHEMA_VERSIONS = Object.freeze([2, 3]);
  const METRIC_DEFINITIONS = Object.freeze({
    liveCoralCover: Object.freeze({ value: 'valuePct', sd: 'sdPct', basis: 'benthic-cover' }),
    hardCoralCover: Object.freeze({ value: 'valuePct', sd: 'sdPct', basis: 'benthic-cover' }),
    macroalgaeCover: Object.freeze({ value: 'valuePct', sd: 'sdPct', basis: 'benthic-cover' }),
    bleaching: Object.freeze({ value: 'bleachedColoniesPct', basis: 'coral-colonies' })
  });
  const DATE_PRECISIONS = Object.freeze(['day', 'month', 'year', 'unknown']);
  const PROVENANCE_NULLABLE_FIELDS = Object.freeze([
    'projectId', 'sourceRecordId', 'projectName', 'suggestedCitation', 'license', 'sourceUrl'
  ]);
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isNullableString = value => value === null || typeof value === 'string';
  const isNullableNumber = value => value === null || (typeof value === 'number' && Number.isFinite(value));
  const isNullableInteger = value => value === null || (Number.isInteger(value) && value >= 0);

  function isValidIsoDate(value) {
    if (value === null) return true;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function isValidPartialIsoDate(value) {
    if (value === null) return true;
    if (typeof value !== 'string') return false;
    if (/^\d{4}$/.test(value)) return Number(value) >= 1;
    if (/^\d{4}-\d{2}$/.test(value)) {
      const [, month] = value.split('-').map(Number);
      return month >= 1 && month <= 12;
    }
    return isValidIsoDate(value);
  }

  function isValidSurveyDate(value, precision, schemaVersion) {
    if (schemaVersion === 2) return value === null || isValidIsoDate(value);
    if (!DATE_PRECISIONS.includes(precision)) return false;
    if (precision === 'unknown') return value === null;
    if (precision === 'day') return isValidIsoDate(value);
    if (precision === 'month') return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) && isValidPartialIsoDate(value);
    return typeof value === 'string' && /^\d{4}$/.test(value) && isValidPartialIsoDate(value);
  }

  function validateRecord(record) {
    const errors = [];
    const requireObject = (value, name) => {
      if (!isObject(value)) errors.push(`${name} must be an object`);
      return isObject(value);
    };
    const validateNullableNonnegative = (value, path) => {
      if (!isNullableNumber(value) || (value !== null && value < 0)) errors.push(`${path} must be a non-negative number or null`);
    };
    const validatePercentage = (value, path) => {
      if (!isNullableNumber(value) || (value !== null && (value < 0 || value > 100))) errors.push(`${path} must be between 0 and 100 or null`);
    };

    if (!requireObject(record, 'record')) return { valid: false, errors };
    if (!SUPPORTED_SCHEMA_VERSIONS.includes(record.schemaVersion)) errors.push(`schemaVersion must be one of ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`);
    if (typeof record.id !== 'string' || record.id.trim() === '') errors.push('id must be a non-empty string');

    if (requireObject(record.location, 'location')) {
      const { lat, lon, siteName, region, country, sourceSiteId } = record.location;
      if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) errors.push('location.lat must be between -90 and 90');
      if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) errors.push('location.lon must be between -180 and 180');
      for (const [key, value] of Object.entries({ siteName, region, country })) {
        if (!isNullableString(value)) errors.push(`location.${key} must be a string or null`);
      }
      if (!isNullableString(sourceSiteId) || (typeof sourceSiteId === 'string' && sourceSiteId.trim() === '')) {
        errors.push('location.sourceSiteId must be a non-empty string or null');
      }
    }

    if (requireObject(record.survey, 'survey')) {
      if (!isValidSurveyDate(record.survey.date, record.survey.datePrecision, record.schemaVersion)) {
        errors.push(record.schemaVersion === 2
          ? 'survey.date must be a valid ISO date or null'
          : 'survey.date and survey.datePrecision must be a matching day, month, year, or unknown value');
      }
      if (!isNullableString(record.survey.managementRegime)) errors.push('survey.managementRegime must be a string or null');
      if ('sampleId' in record.survey && !isNullableString(record.survey.sampleId)) errors.push('survey.sampleId must be a string or null');
      if ('sourceRowNumber' in record.survey && record.survey.sourceRowNumber !== null && (!Number.isInteger(record.survey.sourceRowNumber) || record.survey.sourceRowNumber < 1)) {
        errors.push('survey.sourceRowNumber must be a positive integer or null');
      }
    }

    if (!Array.isArray(record.protocols)) errors.push('protocols must be an array');
    else record.protocols.forEach((protocol, protocolIndex) => {
      const path = `protocols[${protocolIndex}]`;
      if (!isObject(protocol)) {
        errors.push(`${path} must be an object`);
        return;
      }
      if (typeof protocol.method !== 'string' || protocol.method.trim() === '') errors.push(`${path}.method must be a non-empty string`);
      if (!isNullableString(protocol.sourceMethod)) errors.push(`${path}.sourceMethod must be a string or null`);
      if (!isNullableInteger(protocol.sampleUnitCount)) errors.push(`${path}.sampleUnitCount must be a non-negative integer or null`);
      if (protocol.depth !== null) {
        if (requireObject(protocol.depth, `${path}.depth`)) {
          validateNullableNonnegative(protocol.depth.meanM, `${path}.depth.meanM`);
          validateNullableNonnegative(protocol.depth.sdM, `${path}.depth.sdM`);
        }
      }
      if (!isNullableString(protocol.dataPolicy)) errors.push(`${path}.dataPolicy must be a string or null`);
      if (!requireObject(protocol.metrics, `${path}.metrics`)) return;

      for (const [metricKey, definition] of Object.entries(METRIC_DEFINITIONS)) {
        if (!(metricKey in protocol.metrics)) continue;
        const metric = protocol.metrics[metricKey];
        const metricPath = `${path}.metrics.${metricKey}`;
        if (!isObject(metric)) {
          errors.push(`${metricPath} must be an object`);
          continue;
        }
        if (metric.basis !== definition.basis) errors.push(`${metricPath}.basis must be "${definition.basis}"`);
        if (metricKey === 'bleaching') {
          for (const field of ['bleachedColoniesPct', 'paleColoniesPct', 'normalColoniesPct', 'recentlyDeadColoniesPct']) {
            validatePercentage(metric[field], `${metricPath}.${field}`);
          }
          if (!isNullableInteger(metric.colonyCount)) errors.push(`${metricPath}.colonyCount must be a non-negative integer or null`);
        } else {
          validatePercentage(metric.valuePct, `${metricPath}.valuePct`);
          validateNullableNonnegative(metric.sdPct, `${metricPath}.sdPct`);
          if (metric.sdPct !== null && metric.sdPct > 100) errors.push(`${metricPath}.sdPct must be between 0 and 100 or null`);
        }
      }
    });

    if (requireObject(record.quality, 'quality')) {
      if (record.quality.confidenceLevel !== null) errors.push('quality.confidenceLevel must be null until confidence estimation is defined');
    }

    if (requireObject(record.provenance, 'provenance')) {
      if (typeof record.provenance.provider !== 'string' || record.provenance.provider.trim() === '') errors.push('provenance.provider is required');
      for (const key of PROVENANCE_NULLABLE_FIELDS) {
        if (!isNullableString(record.provenance[key])) errors.push(`provenance.${key} must be a string or null`);
      }
    }
    return { valid: errors.length === 0, errors };
  }

  function validateDataset(dataset) {
    if (!isObject(dataset)) return { valid: false, errors: ['dataset must be an object'] };
    const errors = [];
    if (!SUPPORTED_SCHEMA_VERSIONS.includes(dataset.schemaVersion)) errors.push(`dataset schemaVersion must be one of ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`);
    if (!isObject(dataset.metadata)) errors.push('dataset.metadata must be an object');
    else {
      const metadata = dataset.metadata;
      if (typeof metadata.provider !== 'string' || !metadata.provider.trim()) errors.push('dataset.metadata.provider is required');
      if (!['synthetic', 'local-pilot', 'local-testing', 'production'].includes(metadata.datasetType)) errors.push('dataset.metadata.datasetType is unsupported');
      if (!isNullableInteger(metadata.eventCount)) errors.push('dataset.metadata.eventCount must be a non-negative integer or null');
      if (!isNullableInteger(metadata.sourceSiteCount)) errors.push('dataset.metadata.sourceSiteCount must be a non-negative integer or null');
      if (!isNullableString(metadata.generatedAt)) errors.push('dataset.metadata.generatedAt must be a string or null');
      if (metadata.redistributionApproved !== null && typeof metadata.redistributionApproved !== 'boolean') errors.push('dataset.metadata.redistributionApproved must be a boolean or null');
      const dateValid = dataset.schemaVersion === 2 ? isValidIsoDate : isValidPartialIsoDate;
      if (!isObject(metadata.dateRange)
        || !dateValid(metadata.dateRange.from)
        || !dateValid(metadata.dateRange.to)) errors.push('dataset.metadata.dateRange must contain valid ISO dates at the declared schema precision or null');
    }
    if (!Array.isArray(dataset.records)) errors.push('dataset.records must be an array');
    else dataset.records.forEach((record, index) => {
      const result = validateRecord(record);
      for (const error of result.errors) errors.push(`records[${index}].${error}`);
    });
    if (isObject(dataset.metadata) && Array.isArray(dataset.records) && dataset.metadata.eventCount !== dataset.records.length) {
      errors.push('dataset.metadata.eventCount must match dataset.records.length');
    }
    return { valid: errors.length === 0, errors };
  }

  function getSurveySiteKey(record, datasetType) {
    const location = record && record.location;
    const provider = record && record.provenance && record.provenance.provider;
    if (typeof provider === 'string' && provider.trim() && location && typeof location.sourceSiteId === 'string' && location.sourceSiteId.trim()) {
      return Object.freeze({ type: 'SOURCE_ID', key: JSON.stringify([provider, location.sourceSiteId]) });
    }
    // Synthetic coordinates are useful for prototype grouping only. Real pilot records
    // without a provider site ID remain unknown so similar names are never conflated.
    if ((datasetType === 'synthetic' || datasetType === 'local-testing') && typeof provider === 'string' && provider.trim()
      && location && typeof location.siteName === 'string' && location.siteName.trim()
      && Number.isFinite(location.lat) && Number.isFinite(location.lon)) {
      return Object.freeze({ type: 'FALLBACK_NAME_COORDINATE', key: JSON.stringify([provider, location.siteName, location.lat, location.lon]) });
    }
    return Object.freeze({ type: 'UNKNOWN', key: null });
  }

  function getMetricCandidates(event, metricKey) {
    const definition = METRIC_DEFINITIONS[metricKey];
    if (!definition || !event || !Array.isArray(event.protocols)) return [];
    return event.protocols.flatMap(protocol => {
      const metric = protocol && protocol.metrics && protocol.metrics[metricKey];
      if (!isObject(metric) || metric.basis !== definition.basis) return [];
      const valuePct = metric[definition.value];
      if (valuePct == null) return [];
      return [{
        method: protocol.method,
        sourceMethod: protocol.sourceMethod,
        valuePct,
        sdPct: definition.sd ? metric[definition.sd] : null,
        basis: metric.basis
      }];
    });
  }

  return Object.freeze({ SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS, DATE_PRECISIONS, METRIC_DEFINITIONS, validateRecord, validateDataset, isValidIsoDate, isValidPartialIsoDate, isValidSurveyDate, getMetricCandidates, getSurveySiteKey });
});
