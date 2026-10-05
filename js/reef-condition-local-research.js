(function attachLocalReefResearch(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasLocalReefResearch = api;
})(typeof window === 'undefined' ? globalThis : window, function buildLocalReefResearch(root) {
  function isEnabled(location = root.location) {
    if (!location || !['localhost', '127.0.0.1', '[::1]'].includes(String(location.hostname || '').toLowerCase())) return false;
    return new URLSearchParams(location.search || '').get('reefConditionLocalResearch') === '1';
  }

  function addMetricOptions(metricSelect, definitions) {
    if (!metricSelect || !Array.isArray(definitions) || !definitions.length) return;
    const groups = new Map();
    for (const definition of definitions) {
      const label = definition.groupLabel || 'Local research · Seaview Survey';
      let group = groups.get(label);
      if (!group) {
        group = document.createElement('optgroup');
        group.label = label;
        group.setAttribute('data-local-research-metrics', '');
        groups.set(label, group);
      }
      const optionExists = Array.from(metricSelect.options || []).some(option => option.value === definition.value);
      if (!optionExists) {
        const option = document.createElement('option');
        option.value = definition.value;
        option.textContent = definition.label;
        group.append(option);
      }
    }
    const anchor = metricSelect.querySelector('optgroup[label="Environmental pressure"]');
    for (const group of groups.values()) {
      if (group.children.length) metricSelect.insertBefore(group, anchor);
    }
  }

  async function createFeature({ providerApi, schemaApi, metricSelect, location = root.location } = {}) {
    if (!isEnabled(location)) return Object.freeze({ enabled: false, providers: Object.freeze([]), metricDefinitions: Object.freeze([]) });
    let sourceApi;
    if (typeof module === 'object' && module.exports) {
      sourceApi = require('./reef-condition-seaview-local.js');
    } else {
      await import('./reef-condition-seaview-local.js');
      sourceApi = root.DiveAtlasSeaviewLocalResearch;
    }
    const feature = sourceApi.createFeature({ providerApi, schemaApi, location });
    if (feature.enabled) addMetricOptions(metricSelect, feature.metricDefinitions);
    return feature;
  }

  return Object.freeze({ isEnabled, addMetricOptions, createFeature });
});
