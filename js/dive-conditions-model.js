(function attachDiveConditionsModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasConditionsModel = api;
})(typeof window === 'undefined' ? globalThis : window, function buildDiveConditionsModel() {
  const METRICS = Object.freeze(['temperature', 'clarity', 'current', 'waves']);

  // Seven consumer-facing bands per physical measure. These are experience
  // heuristics (not safety limits); raw units stay dimension-specific.
  const SCORE_BANDS = Object.freeze({
    temperature:Object.freeze([
      Object.freeze({ maximumInclusive:18, category:'Very cool', score:0 }),
      Object.freeze({ maximumInclusive:20, category:'Cool', score:20 }),
      Object.freeze({ maximumInclusive:23, category:'Mild', score:40 }),
      Object.freeze({ maximumInclusive:24, category:'Comfortably mild', score:70 }),
      Object.freeze({ maximumInclusive:25, category:'Comfortably warm', score:80 }),
      Object.freeze({ maximumInclusive:30, category:'Warm', score:100 }),
      Object.freeze({ maximumInclusive:Infinity, category:'Very warm', score:60 })
    ]),
    clarity:Object.freeze([
      Object.freeze({ maximumExclusive:2, category:'Very low', score:0 }),
      Object.freeze({ maximumExclusive:5, category:'Low', score:20 }),
      Object.freeze({ maximumExclusive:8, category:'Fair', score:40 }),
      Object.freeze({ maximumExclusive:12, category:'Moderate', score:60 }),
      Object.freeze({ maximumExclusive:15, category:'Good', score:80 }),
      Object.freeze({ maximumExclusive:20, category:'Very good', score:90 }),
      Object.freeze({ maximumExclusive:Infinity, category:'High', score:100 })
    ]),
    current:Object.freeze([
      Object.freeze({ maximumExclusive:0.1, category:'Very light', score:100 }),
      Object.freeze({ maximumExclusive:0.3, category:'Light', score:80 }),
      Object.freeze({ maximumExclusive:0.45, category:'Moderate', score:60 }),
      Object.freeze({ maximumExclusive:0.6, category:'Moderately strong', score:40 }),
      Object.freeze({ maximumExclusive:0.9, category:'Strong', score:30 }),
      Object.freeze({ maximumInclusive:1.2, category:'Very strong', score:20 }),
      Object.freeze({ maximumInclusive:Infinity, category:'Extreme', score:0 })
    ]),
    waves:Object.freeze([
      Object.freeze({ maximumExclusive:0.25, category:'Calm wave height', score:100 }),
      Object.freeze({ maximumExclusive:0.5, category:'Very low wave height', score:80 }),
      Object.freeze({ maximumExclusive:0.75, category:'Low wave height', score:60 }),
      Object.freeze({ maximumExclusive:1.25, category:'Moderate wave height', score:40 }),
      Object.freeze({ maximumExclusive:1.6, category:'Elevated wave height', score:30 }),
      Object.freeze({ maximumExclusive:2, category:'High wave height', score:20 }),
      Object.freeze({ maximumInclusive:Infinity, category:'Very high wave height', score:0 })
    ])
  });

  function scoreBand(metric, value) {
    const n = Number(value);
    const bands = SCORE_BANDS[metric];
    if (!bands || value == null || !Number.isFinite(n) || (metric !== 'temperature' && n < 0)) return null;
    return bands.find(band => band.maximumExclusive != null ? n < band.maximumExclusive : n <= band.maximumInclusive) || null;
  }

  function classify(metric, value) {
    return scoreBand(metric, value)?.category ?? null;
  }

  function metricScore(metric, value) {
    return scoreBand(metric, value)?.score ?? null;
  }

  function scoreSuitability(metrics) {
    if (!metrics || METRICS.some(key => metricScore(key, metrics[key]?.value) == null)) {
      return Object.freeze({ score: null, level: 'incomplete' });
    }
    // Equal-weighted category points make a compact summary without pretending
    // the unlike physical measurements share one raw unit or imply dive safety.
    const score = Math.round(METRICS.reduce((total, key) => total + metricScore(key, metrics[key].value), 0) / METRICS.length);
    const level = score >= 85 ? 'excellent' : score >= 65 ? 'good' : score >= 40 ? 'mixed' : 'challenging';
    return Object.freeze({ score, level });
  }

  function confidence(availableCount) {
    return availableCount >= 4 ? 'High' : availableCount >= 2 ? 'Moderate' : availableCount === 1 ? 'Limited' : 'Unavailable';
  }

  function createResult({ location, month, samples }) {
    const metrics = {};
    for (const key of METRICS) {
      const sample = samples[key];
      const numericValue = sample?.value != null && Number.isFinite(Number(sample.value)) ? Number(sample.value) : null;
      const value = numericValue != null && (key === 'temperature' || numericValue >= 0) ? numericValue : null;
      metrics[key] = { value, unit: sample?.unit || null, interpretation: value == null ? null : classify(key, value),
        provenance: sample?.provenance || null, sourceLocation: sample?.sourceLocation || null,
        sourceLatitude:sample?.sourceLatitude ?? null, sourceLongitude:sample?.sourceLongitude ?? null,
        sampleDistanceKm: sample?.sampleDistanceKm ?? null, resolution: sample?.resolution || null, period: sample?.period || null };
    }
    const availableCount = METRICS.filter(key => metrics[key].value != null).length;
    const confidenceReason = availableCount === 4
      ? 'All four measures are available; current and wave values are regional model estimates.'
      : availableCount === 0 ? 'No valid ocean samples are available at this location.'
      : `${METRICS.filter(key => metrics[key].value == null).map(key => `${key} data unavailable`).join('; ')}.`;
    return Object.freeze({ location: Object.freeze({ lat: Number(location.lat), lon: Number(location.lng ?? location.lon) }),
      month: Number(month), metrics: Object.freeze(metrics), dataConfidence: confidence(availableCount), availableCount,
      suitability: scoreSuitability(metrics),
      confidenceReason,
      caveat: 'Typical historical conditions — not a live forecast.' });
  }

  return Object.freeze({ METRICS, SCORE_BANDS, classify, scoreBand, metricScore, scoreSuitability, confidence, createResult });
});
