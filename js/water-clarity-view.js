(function attachWaterClarityView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasWaterClarityView = api;
})(typeof window === 'undefined' ? globalThis : window, function buildWaterClarityViewApi() {
  function createWaterClarityView({ L, map, onStatus = () => {}, metadataLoader } = {}) {
    let enabled = false;
    let month = 9;
    let metadata = null;
    let metadataPromise = null;
    let generation = 0;
    let visibleLayer = null;
    let pendingLayer = null;

    function removeLayer(target) {
      if (target && map.hasLayer(target)) map.removeLayer(target);
    }

    function loadMetadata() {
      if (!metadataPromise) {
        const loader = metadataLoader || (() => fetch('data/water_clarity/metadata.json').then(response => {
          if (!response.ok) throw new Error(`Water Clarity metadata returned HTTP ${response.status}`);
          return response.json();
        }));
        metadataPromise = Promise.resolve().then(loader).then(result => {
          if (result?.format !== 'diveatlas-water-clarity' || result.format_version !== 1 ||
              !Array.isArray(result.available_months) || !result.rendering?.tile_template ||
              !Number.isInteger(Number(result.rendering.max_native_zoom))) {
            throw new Error('Water Clarity metadata is missing required rendering fields');
          }
          return result;
        }).catch(error => {
          metadataPromise = null;
          throw error;
        });
      }
      return metadataPromise;
    }

    function tileUrl(selectedMonth) {
      const version = encodeURIComponent(metadata.generated_at_utc || 'dataset');
      const path = metadata.rendering.tile_template.replace('{month}', String(selectedMonth).padStart(2, '0'));
      return `data/water_clarity/${path}?v=${version}`;
    }

    function displayMonth(selectedMonth) {
      const request = ++generation;
      if (!metadata.available_months.map(Number).includes(selectedMonth)) {
        onStatus({ state: 'unavailable', month: selectedMonth });
        return false;
      }
      month = selectedMonth;
      removeLayer(pendingLayer);
      pendingLayer = null;
      onStatus({ state: 'loading', month });
      const nextLayer = L.tileLayer(tileUrl(month), {
        pane: 'temperaturePane',
        minZoom: 2,
        maxZoom: 19,
        minNativeZoom: Number(metadata.rendering.min_native_zoom),
        maxNativeZoom: Number(metadata.rendering.max_native_zoom),
        tileSize: 256,
        opacity: Number(metadata.rendering.opacity) || 0.58,
        updateWhenZooming: false,
        keepBuffer: 1,
        className: 'water-clarity-tiles',
        crossOrigin: true
      });
      pendingLayer = nextLayer;
      nextLayer.on('load', () => {
        if (request !== generation || !enabled || pendingLayer !== nextLayer) return;
        removeLayer(visibleLayer);
        visibleLayer = nextLayer;
        pendingLayer = null;
        onStatus({ state: 'ready', month });
      });
      nextLayer.on('tileerror', () => {
        if (request !== generation || !enabled || pendingLayer !== nextLayer) return;
        removeLayer(nextLayer);
        pendingLayer = null;
        removeLayer(visibleLayer);
        visibleLayer = null;
        onStatus({ state: 'unavailable', month });
      });
      nextLayer.addTo(map);
      return true;
    }

    return Object.freeze({
      activate(initialMonth = month) {
        if (enabled) return;
        enabled = true;
        month = Number(initialMonth);
        const request = ++generation;
        onStatus({ state: 'loading-metadata', month });
        loadMetadata().then(result => {
          if (!enabled || request !== generation) return;
          metadata = result;
          onStatus({ state: 'metadata', metadata });
          displayMonth(month);
        }).catch(error => {
          if (!enabled || request !== generation) return;
          onStatus({ state: 'unavailable', month, error });
        });
      },
      deactivate() {
        enabled = false;
        generation += 1;
        removeLayer(pendingLayer);
        removeLayer(visibleLayer);
        pendingLayer = null;
        visibleLayer = null;
        onStatus({ state: 'off', month });
      },
      selectMonth(nextMonth) {
        const value = Number(nextMonth);
        if (!enabled || !Number.isInteger(value) || value < 1 || value > 12) return false;
        month = value;
        if (!metadata) return true;
        return displayMonth(value);
      },
      get state() { return { enabled, month, generation, hasLayer: Boolean(visibleLayer || pendingLayer) }; },
      get metadata() { return metadata; }
    });
  }

  return { createWaterClarityView };
});
