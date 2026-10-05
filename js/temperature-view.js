(function attachTemperatureView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasTemperatureView = api;
})(typeof window === 'undefined' ? globalThis : window, function buildTemperatureViewApi() {
const browserRoot = typeof window === 'undefined' ? globalThis : window;
function createTemperatureView({ L, map, onStatus = () => {}, metadataLoader }) {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  let month = 9;
  let depth = '20';
  let requestGeneration = 0;
  let layer = null;
  let estimatedLayer = null;
  let enabled = false;
  let metadata = null;
  let metadataPromise = null;
  const developmentMode = Boolean(browserRoot.location && /^(localhost|127\.0\.0\.1)$/.test(browserRoot.location.hostname));

  function debug(event, targetLayer, generation, detail = {}) {
    if (!developmentMode) return;
    const pane = map.getPane?.('temperaturePane');
    console.debug('[DiveAtlas temperature]', {
      event,
      datasetUrl: targetLayer?._url || null,
      month,
      depth,
      generation,
      layerAdded: Boolean(targetLayer && map.hasLayer(targetLayer)),
      paneZIndex: pane ? getComputedStyle(pane).zIndex : null,
      opacity: targetLayer?.options?.opacity ?? null,
      visibleTileCount: Object.keys(targetLayer?._tiles || {}).length,
      ...detail
    });
  }

  function removeVisibleLayer() {
    if (layer && map.hasLayer(layer)) map.removeLayer(layer);
    if (estimatedLayer && map.hasLayer(estimatedLayer)) map.removeLayer(estimatedLayer);
    layer = null;
    estimatedLayer = null;
  }

  function loadMetadata() {
    if (!metadataPromise) {
      const loader = metadataLoader || (() => fetch('data/temperature/metadata.json').then(response => {
        if (!response.ok) throw new Error(`Temperature metadata returned HTTP ${response.status}`);
        return response.json();
      }));
      metadataPromise = Promise.resolve().then(loader).then(result => {
        if (!result || !result.asset_base || !result.tile_template || !Number.isInteger(result.max_native_zoom) ||
            !result.temperature_scale || !Array.isArray(result.available_slices)) {
          throw new Error('Temperature metadata is missing required tile or scale fields');
        }
        return result;
      });
    }
    return metadataPromise;
  }

  function tileUrl(selectedMonth, selectedDepth) {
    const path = metadata.tile_template
      .replaceAll('{month}', String(selectedMonth).padStart(2, '0'))
      .replaceAll('{depth}', selectedDepth);
    const version = encodeURIComponent(metadata.generated_at_utc || metadata.generation_version || 'dataset');
    return `${metadata.asset_base.replace(/\/$/, '')}/${path}?v=${version}`;
  }

  function estimatedTileUrl(selectedMonth, selectedDepth) {
    if (!metadata.estimated_tile_template) return null;
    const path = metadata.estimated_tile_template
      .replaceAll('{month}', String(selectedMonth).padStart(2, '0'))
      .replaceAll('{depth}', selectedDepth);
    const version = encodeURIComponent(metadata.estimated_tile_generation_version || 'estimated-dataset');
    return `${metadata.asset_base.replace(/\/$/, '')}/${path}?v=${version}`;
  }

  function selectSlice(nextMonth, nextDepth) {
    const depthValue = Number(nextDepth);
    if (!enabled || !Number.isInteger(nextMonth) || nextMonth < 1 || nextMonth > 12 ||
        !Number.isInteger(depthValue) || depthValue < 0 || depthValue > 50) return false;

    month = nextMonth;
    depth = String(depthValue);
    const generation = ++requestGeneration;
    removeVisibleLayer();
    if (!metadata) {
      onStatus({ state: 'loading-metadata', month, depth });
      return true;
    }
    onStatus({ state: 'loading', month, depth });

    const sliceAvailable = metadata.available_slices.some(([availableMonth, availableDepth]) =>
      Number(availableMonth) === month && String(availableDepth) === depth
    );
    if (!sliceAvailable) {
      onStatus({ state: 'unavailable', month, depth });
      return false;
    }

    const nextLayer = L.tileLayer(
      tileUrl(month, depth),
      {
        pane: 'temperaturePane',
        minZoom: 2,
        maxZoom: 19,
        minNativeZoom: metadata.min_native_zoom ?? metadata.max_native_zoom,
        maxNativeZoom: metadata.max_native_zoom,
        tileSize: 256,
        opacity: 0.88,
        updateWhenZooming: false,
        keepBuffer: 1,
        className: 'temperature-tiles',
        crossOrigin: true
      }
    );
    debug('selection', nextLayer, generation);
    nextLayer.on('load', () => {
      debug('load', nextLayer, generation);
      if (generation !== requestGeneration || !enabled || layer !== nextLayer) return;
      onStatus({ state: 'ready', month, depth });
    });
    nextLayer.on('tileerror', event => {
      debug('tile-error', nextLayer, generation, {
        failedTileUrl: event?.tile?.src || null,
        tileCoordinates: event?.coords || null
      });
      if (generation !== requestGeneration || !enabled || layer !== nextLayer) return;
      onStatus({ state: 'unavailable', month, depth });
    });
    layer = nextLayer;
    nextLayer.addTo(map);
    const estimateUrl = estimatedTileUrl(month, depth);
    if (estimateUrl) {
      const nextEstimatedLayer = L.tileLayer(estimateUrl, {
        pane: 'temperaturePane', minZoom: 2, maxZoom: 19,
        minNativeZoom: metadata.min_native_zoom ?? metadata.max_native_zoom,
        maxNativeZoom: metadata.max_native_zoom, tileSize: 256,
        opacity: 0.72, updateWhenZooming: false, keepBuffer: 1,
        className: 'temperature-estimated-tiles', crossOrigin: true
      });
      estimatedLayer = nextEstimatedLayer;
      nextEstimatedLayer.on('tileerror', event => {
        debug('estimated-tile-error', nextEstimatedLayer, generation, {
          failedTileUrl: event?.tile?.src || null,
          tileCoordinates: event?.coords || null
        });
      });
      nextEstimatedLayer.addTo(map);
      debug('estimated-layer-added', nextEstimatedLayer, generation);
    }
    debug('added-to-map', nextLayer, generation);
    return true;
  }

  return Object.freeze({
    activate(initialMonth = month, initialDepth = depth) {
      if (enabled) return;
      enabled = true;
      month = initialMonth;
      depth = String(initialDepth);
      requestGeneration += 1;
      onStatus({ state: 'loading-metadata', month, depth });
      loadMetadata().then(result => {
        if (!enabled) return;
        metadata = result;
        onStatus({ state: 'metadata', metadata });
        selectSlice(month, depth);
      }).catch(error => {
        if (!enabled) return;
        debug('metadata-error', null, requestGeneration, { error: String(error) });
        onStatus({ state: 'unavailable', month, depth });
      });
    },
    deactivate() {
      enabled = false;
      requestGeneration += 1;
      debug('deactivate', layer, requestGeneration);
      removeVisibleLayer();
      onStatus({ state: 'off', month, depth });
    },
    selectSlice,
    get state() { return { enabled, month, depth, requestGeneration, hasLayer: Boolean(layer) }; },
    get metadata() { return metadata; },
    formatLabel() { return `${depth === '0' ? 'Surface' : `${depth} m`} · ${monthNames[month - 1]}`; }
  });
}
return { createTemperatureView };
});
