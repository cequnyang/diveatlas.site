(function attachReefSurveyTemporalResolver(root, factory) {
  const schema = typeof module === 'object' && module.exports
    ? require('./reef-survey-schema.js')
    : root.DiveAtlasReefSurveySchema;
  const api = factory(schema);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasReefSurveyTemporalResolver = api;
})(typeof window === 'undefined' ? globalThis : window, function buildReefSurveyTemporalResolver(schema) {
  if (!schema || typeof schema.getMetricCandidates !== 'function' || typeof schema.getSurveySiteKey !== 'function') {
    throw new TypeError('Reef survey schema helpers are required.');
  }

  const SUPPORTED_METRICS = Object.freeze(['liveCoralCover', 'hardCoralCover', 'macroalgaeCover']);
  const RESOLUTION_METHOD = 'latest-available-metric';
  const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

  function eventIdentity(event) {
    const provider = event && event.provenance && event.provenance.provider;
    const sourceSiteId = event && event.location && event.location.sourceSiteId;
    const identity = schema.getSurveySiteKey(event, 'local-pilot');
    if (identity.type !== 'SOURCE_ID') {
      throw new TypeError('Temporal resolution requires a provider-scoped sourceSiteId.');
    }
    return { provider, sourceSiteId, key: identity.key };
  }

  function observationDate(event) {
    const value = event && event.survey && event.survey.date;
    const version = event && event.schemaVersion;
    const precision = event && event.survey && event.survey.datePrecision;
    const valid = value == null || (version === 2
      ? schema.isValidIsoDate(value)
      : precision
        ? schema.isValidSurveyDate(value, precision, version)
        : schema.isValidPartialIsoDate(value));
    if (!valid) {
      throw new TypeError('survey.date must be valid ISO day, month, year precision, or null.');
    }
    return value || null;
  }

  function datePrecision(event) {
    const value = observationDate(event);
    if (!value) return 'unknown';
    const precision = event && event.survey && event.survey.datePrecision;
    if (precision && ['day', 'month', 'year'].includes(precision)) return precision;
    return value.length === 4 ? 'year' : value.length === 7 ? 'month' : 'day';
  }

  function observationTimestamp(event) {
    const value = observationDate(event);
    if (!value) return null;
    const precision = datePrecision(event);
    if (precision === 'year') return Date.UTC(Number(value), 6, 1);
    if (precision === 'month') {
      const [year, month] = value.split('-').map(Number);
      return Date.UTC(year, month - 1, 15);
    }
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(timestamp)) throw new TypeError('survey.date could not be ordered at its declared precision.');
    return timestamp;
  }

  function orderedEvents(events) {
    return events.map((event, index) => ({ event, index, date: observationDate(event), timestamp: observationTimestamp(event) }))
      .sort((left, right) => {
        // Unknown dates follow dated observations but remain eligible if no dated event has the metric.
        if (left.timestamp == null && right.timestamp != null) return 1;
        if (left.timestamp != null && right.timestamp == null) return -1;
        if (left.timestamp !== right.timestamp) return left.timestamp < right.timestamp ? 1 : -1;
        return left.index - right.index;
      });
  }

  function referenceDayTimestamp(referenceDate) {
    if (referenceDate == null) return null;
    if (referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())) {
      return Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate());
    }
    if (typeof referenceDate === 'string' && schema.isValidIsoDate(referenceDate)) {
      return Date.parse(`${referenceDate}T00:00:00Z`);
    }
    throw new TypeError('referenceDate must be a valid Date, ISO date, or null.');
  }

  function result(status, metric, sourceSiteId, event = null, candidate = null, referenceDate = null, extra = {}) {
    const protocol = candidate
      ? (typeof candidate.sourceMethod === 'string' && candidate.sourceMethod.trim()
        ? candidate.sourceMethod
        : (typeof candidate.method === 'string' && candidate.method.trim() ? candidate.method : null))
      : null;
    const date = event ? observationDate(event) : null;
    const precision = event ? datePrecision(event) : 'unknown';
    const timestamp = event ? observationTimestamp(event) : null;
    const referenceTimestamp = referenceDayTimestamp(referenceDate);
    return {
      status,
      value: status === 'unique' ? candidate.valuePct : null,
      metric,
      observationDate: date,
      observationDatePrecision: precision,
      ageDays: timestamp != null && referenceTimestamp != null
        ? Math.floor((referenceTimestamp - timestamp) / MILLISECONDS_PER_DAY)
        : null,
      ageApproximate: precision !== 'day' && date != null,
      resolutionMethod: RESOLUTION_METHOD,
      sourceEventId: event
        ? ((event.provenance && event.provenance.sourceRecordId) || event.id || null)
        : null,
      sourceSiteId,
      protocol,
      ...extra
    };
  }

  function resolveLatestAvailableMetric(events, metric, referenceDate = null) {
    if (!SUPPORTED_METRICS.includes(metric)) {
      throw new RangeError(`Unsupported temporal metric: ${metric}`);
    }
    if (!Array.isArray(events)) throw new TypeError('events must be an array.');

    if (events.length === 0) return result('missing', metric, null, null, null, referenceDate);

    const firstIdentity = eventIdentity(events[0]);
    for (const event of events.slice(1)) {
      if (eventIdentity(event).key !== firstIdentity.key) {
        throw new TypeError('All events must belong to the same provider-scoped sourceSiteId.');
      }
    }

    const ordered = orderedEvents(events);
    for (let cursor = 0; cursor < ordered.length;) {
      const timestamp = ordered[cursor].timestamp;
      const tied = [];
      while (cursor < ordered.length && ordered[cursor].timestamp === timestamp) tied.push(ordered[cursor++].event);
      const available = tied.flatMap(event => schema.getMetricCandidates(event, metric).map(candidate => ({ event, candidate })));
      if (available.length === 0) continue;
      if (available.length > 1) {
        const event = tied.find(candidate => schema.getMetricCandidates(candidate, metric).length > 0);
        const sourceEventIds = [...new Set(available.map(item =>
          (item.event.provenance && item.event.provenance.sourceRecordId) || item.event.id || null).filter(Boolean))];
        return result('ambiguous', metric, firstIdentity.sourceSiteId, event, null, referenceDate,
          sourceEventIds.length > 1 ? { sourceEventId: null, sourceEventIds } : {});
      }
      return result('unique', metric, firstIdentity.sourceSiteId, available[0].event, available[0].candidate, referenceDate);
    }
    return result('missing', metric, firstIdentity.sourceSiteId, null, null, referenceDate);
  }

  function groupEventsBySourceSite(events) {
    if (!Array.isArray(events)) throw new TypeError('events must be an array.');
    const groups = new Map();
    events.forEach((event, index) => {
      const provider = event && event.provenance && event.provenance.provider;
      const sourceSiteId = event && event.location && event.location.sourceSiteId;
      const identity = schema.getSurveySiteKey(event, 'local-pilot');
      // Unknown identities stay separate; names or nearby coordinates are not a safe join key.
      const key = identity.type === 'SOURCE_ID'
        ? identity.key
        : JSON.stringify([provider || null, 'UNKNOWN', (event && event.id) || index]);
      if (!groups.has(key)) {
        groups.set(key, {
          provider: typeof provider === 'string' ? provider : null,
          sourceSiteId: typeof sourceSiteId === 'string' && sourceSiteId.trim() ? sourceSiteId : null,
          identityType: identity.type,
          events: []
        });
      }
      groups.get(key).events.push(event);
    });
    return Array.from(groups.values());
  }

  return Object.freeze({ SUPPORTED_METRICS, RESOLUTION_METHOD, resolveLatestAvailableMetric, groupEventsBySourceSite });
});
