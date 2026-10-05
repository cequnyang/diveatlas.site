(function attachReefConditionModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasReefConditionModel = api;
})(typeof window === 'undefined' ? globalThis : window, function buildReefConditionModel() {
  const DIMENSIONS = Object.freeze(['coralRecords', 'fishDensity', 'heatStress', 'temperature', 'clarity', 'current', 'waves']);
  const DEFAULT_PROFILE = Object.freeze(Object.fromEntries(DIMENSIONS.map(key => [key, Object.freeze({ enabled:true })])));

  function percentile(values, value) {
    const usable = (Array.isArray(values) ? values : [])
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (!Number.isFinite(Number(value)) || !usable.length) return null;
    let lower = 0;
    let equal = 0;
    for (const item of usable) {
      if (item < Number(value)) lower += 1;
      else if (item === Number(value)) equal += 1;
      else break;
    }
    return Math.round(((lower + equal / 2) / usable.length) * 100);
  }

  function percentileFromSorted(sortedValues, value) {
    const target = Number(value);
    if (!Number.isFinite(target) || !Array.isArray(sortedValues) || !sortedValues.length) return null;
    let low = 0;
    let high = sortedValues.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (sortedValues[middle] < target) low = middle + 1;
      else high = middle;
    }
    const firstEqual = low;
    high = sortedValues.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (sortedValues[middle] <= target) low = middle + 1;
      else high = middle;
    }
    const equalCount = low - firstEqual;
    return Math.round(((firstEqual + equalCount / 2) / sortedValues.length) * 100);
  }

  function heatStressScore(dhw) {
    const value = Number(dhw);
    if (!Number.isFinite(value) || value < 0) return null;
    if (value < 4) return 100;
    if (value < 8) return 50;
    return 0;
  }

  function normalizeProfile(profile) {
    const normalized = {};
    for (const key of DIMENSIONS) {
      const entry = profile?.[key] || DEFAULT_PROFILE[key];
      normalized[key] = Object.freeze({
        enabled:entry.enabled !== false && (entry.weight == null || Number(entry.weight) > 0)
      });
    }
    return Object.freeze(normalized);
  }

  function score(metrics, profile) {
    const normalized = normalizeProfile(profile);
    const included = DIMENSIONS
      .filter(key => normalized[key].enabled && Number.isFinite(metrics?.[key]?.score));
    const activeDimensions = DIMENSIONS.filter(key => normalized[key].enabled);
    const finalScore = included.length === activeDimensions.length && activeDimensions.length > 0
      ? Math.round(included.reduce((sum, key) => sum + metrics[key].score, 0) / included.length)
      : null;
    const estimated = included.some(key => metrics[key].estimated === true);
    return Object.freeze({ score:finalScore, estimated, included:Object.freeze(included), selected:Object.freeze(activeDimensions), profile:normalized });
  }

  return Object.freeze({ DIMENSIONS, DEFAULT_PROFILE, percentile, percentileFromSorted, heatStressScore, normalizeProfile, score });
});
