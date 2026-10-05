(function attachCoralHeatStressView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasCoralHeatStressView = api;
})(typeof window === 'undefined' ? globalThis : window, function buildCoralHeatStressApi() {
  const HEADER_BYTES = 12;
  const MISSING = 255;
  const QUERY_MISSING = -32768;
  // Keep nearest-pixel fallback local so it cannot imply conditions across a broad region.
  const LOCAL_ESTIMATE_MAX_DISTANCE_KM = 25;

  function normalizeLongitude(longitude) {
    return ((longitude + 180) % 360 + 360) % 360 - 180;
  }

  function createCoralHeatStressView({ L, map, onStatus = () => {}, fetchImpl = (...args) => fetch(...args), queryCacheEntries = 32 }) {
    const style = globalThis.DiveAtlasCoralHeatStressStyle;
    let metadata = null;
    let metadataPromise = null;
    let enabled = false;
    let layer = null;
    let activation = 0;
    let retainedOpacity = 0;
    const queryCache = new Map();
    const pendingQueries = new Map();

    function validateMetadata(value) {
      if (!value || value.schema_version !== 1 || !value.asset_base || value.productVersion !== '3.1' ||
          value.classification?.scheme !== 'NOAA CRW revised BAA classification' ||
          value.classification.effectiveSince !== '2023-12-15' || value.classification.min !== 0 || value.classification.max !== 7 ||
          value.encoding?.missing !== MISSING || value.encoding.query_bytes_per_cell !== 5 ||
          !value.grid || !value.map_tile_template || !value.query_tile_template || !value.dataDate || !value.attribution) {
        throw new TypeError('Heat Stress metadata is incomplete or unsupported');
      }
      return value;
    }

    function loadMetadata() {
      metadataPromise ||= Promise.resolve().then(() => fetchImpl('data/coral-heat-stress/metadata.json', { cache: 'no-cache' }))
        .then(response => { if (!response.ok) throw new Error('Heat Stress metadata unavailable'); return response.json(); })
        .then(validateMetadata).catch(error => { metadataPromise = null; throw error; });
      return metadataPromise;
    }

    function removeLayer() {
      if (layer && map.hasLayer(layer)) {
        retainedOpacity = layer.options.opacity ?? 1;
        map.removeLayer(layer);
      }
      layer = null;
    }

    function mapUrl() {
      return `${metadata.asset_base}/${metadata.map_tile_template}?v=${encodeURIComponent(metadata.version)}`;
    }

    function activate() {
      if (enabled) return;
      enabled = true;
      const requestActivation = ++activation;
      onStatus({ state: 'loading-metadata' });
      loadMetadata().then(value => {
        if (!enabled || activation !== requestActivation) return;
        metadata = value;
        onStatus({ state: 'metadata', metadata });
        const nextLayer = L.tileLayer(mapUrl(), {
          pane: 'coralHeatStressPane', minZoom: 2, maxZoom: 19,
          minNativeZoom: metadata.encoding.map_zoom,
          maxNativeZoom: metadata.encoding.max_native_zoom,
          tileSize: 256, opacity: style?.zoomOpacityAt(map.getZoom()) ?? 1, updateWhenZooming: false, keepBuffer: 1,
          className: 'coral-heat-stress-tiles', crossOrigin: true
        });
        nextLayer.on('load', () => {
          if (enabled && activation === requestActivation && layer === nextLayer) onStatus({ state: 'ready' });
        });
        nextLayer.on('tileerror', () => {
          if (enabled && activation === requestActivation && layer === nextLayer) onStatus({ state: 'unavailable' });
        });
        layer = nextLayer;
        nextLayer.addTo(map);
        if (retainedOpacity > 0 && globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === false && typeof nextLayer.setOpacity === 'function') {
          const destination = style?.zoomOpacityAt(map.getZoom()) ?? 1;
          nextLayer.setOpacity(retainedOpacity);
          requestAnimationFrame(() => nextLayer.setOpacity(destination));
        }
        map.on?.('zoomend', updateZoomOpacity);
      }).catch(error => {
        if (enabled && activation === requestActivation) onStatus({ state: 'unavailable', error });
      });
    }

    function updateZoomOpacity() {
      if (layer) layer.setOpacity(globalThis.DiveAtlasCoralHeatStressStyle?.zoomOpacityAt(map.getZoom()) ?? 1);
    }

    function queryAddress(latitude, longitude) {
      const grid = metadata.grid;
      const column = Math.round((normalizeLongitude(longitude) - grid.longitude_min) / grid.longitude_step);
      const wrappedColumn = ((column % grid.width) + grid.width) % grid.width;
      const row = Math.round((latitude - grid.latitude_min) / grid.latitude_step);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || row < 0 || row >= grid.height) return null;
      const size = metadata.encoding.query_tile_size_cells;
      return { column: wrappedColumn, row, tileColumn: Math.floor(wrappedColumn / size), tileRow: Math.floor(row / size), innerColumn: wrappedColumn % size, innerRow: row % size };
    }

    async function loadQueryTile(address, signal) {
      const key = `${metadata.version}/${address.tileColumn}/${address.tileRow}`;
      if (queryCache.has(key)) return queryCache.get(key);
      if (pendingQueries.has(key)) return pendingQueries.get(key);
      const promise = (async () => {
        const path = metadata.query_tile_template.replace('{column}', String(address.tileColumn)).replace('{row}', String(address.tileRow));
        const response = await fetchImpl(`${metadata.asset_base}/${path}?v=${encodeURIComponent(metadata.version)}`, { signal });
        if (!response.ok) throw new Error('Heat Stress sample unavailable');
        if (typeof DecompressionStream !== 'function') throw new Error('Compressed Heat Stress samples are unsupported');
        const compressed = await response.arrayBuffer();
        const decoded = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
        const view = new DataView(decoded);
        if (view.byteLength !== HEADER_BYTES + metadata.encoding.query_tile_size_cells ** 2 * 5 ||
            String.fromCharCode(...new Uint8Array(decoded, 0, 4)) !== 'DCHS' ||
            view.getUint8(4) !== 1 || view.getUint8(5) !== 5 ||
            view.getUint16(6, true) !== metadata.encoding.query_tile_size_cells ||
            view.getUint16(8, true) !== address.tileColumn || view.getUint16(10, true) !== address.tileRow) {
          throw new TypeError('Heat Stress sample tile is invalid');
        }
        queryCache.set(key, decoded);
        if (queryCache.size > queryCacheEntries) queryCache.delete(queryCache.keys().next().value);
        return decoded;
      })().finally(() => pendingQueries.delete(key));
      pendingQueries.set(key, promise);
      return promise;
    }

    async function sample(latitude, longitude, { signal, allowInactive = false } = {}) {
      if (!enabled && !allowInactive) return null;
      if (!metadata) metadata = await loadMetadata();
      if ((!enabled && !allowInactive) || signal?.aborted) return null;
      const address = queryAddress(latitude, longitude);
      if (!address) return null;
      const bytes = await loadQueryTile(address, signal);
      if ((!enabled && !allowInactive) || signal?.aborted) return null;
      const view = new DataView(bytes);
      const offset = HEADER_BYTES + (address.innerRow * metadata.encoding.query_tile_size_cells + address.innerColumn) * 5;
      const category = view.getUint8(offset);
      const hotspot = view.getInt16(offset + 1, true);
      const dhw = view.getInt16(offset + 3, true);
      if (category === MISSING || category > 7) return null;
      return {
        category,
        hotspot_c: hotspot === QUERY_MISSING ? null : hotspot * 0.01,
        dhw_c_weeks: dhw === QUERY_MISSING ? null : dhw * 0.01,
        source_latitude: metadata.grid.latitude_min + address.row * metadata.grid.latitude_step,
        source_longitude: metadata.grid.longitude_min + address.column * metadata.grid.longitude_step
      };
    }

    async function sampleNearest(latitude, longitude, options = {}) {
      const { signal, allowInactive = false } = options;
      const direct = await sample(latitude, longitude, options);
      if (direct?.dhw_c_weeks != null) return direct;
      if (!metadata) metadata = await loadMetadata();
      if (signal?.aborted || (!enabled && !allowInactive)) return null;

      const grid = metadata.grid;
      const latitudeStep = Number(grid.latitude_step);
      const longitudeStep = Number(grid.longitude_step);
      const row = Math.round((Number(latitude) - Number(grid.latitude_min)) / latitudeStep);
      const column = Math.round((normalizeLongitude(Number(longitude)) - Number(grid.longitude_min)) / longitudeStep);
      const maxRows = Math.ceil(LOCAL_ESTIMATE_MAX_DISTANCE_KM / (110.574 * latitudeStep));
      const maxColumns = Math.ceil(LOCAL_ESTIMATE_MAX_DISTANCE_KM /
        (Math.max(11.1, 111.32 * Math.cos(Number(latitude) * Math.PI / 180)) * longitudeStep));
      const candidates = [];
      for (let rowOffset = -maxRows; rowOffset <= maxRows; rowOffset += 1) {
        const candidateRow = row + rowOffset;
        if (candidateRow < 0 || candidateRow >= grid.height) continue;
        const candidateLatitude = Number(grid.latitude_min) + candidateRow * latitudeStep;
        for (let columnOffset = -maxColumns; columnOffset <= maxColumns; columnOffset += 1) {
          const candidateLongitude = normalizeLongitude(Number(grid.longitude_min) + column + columnOffset * longitudeStep);
          const dLat = (candidateLatitude - Number(latitude)) * Math.PI / 180;
          const dLon = ((candidateLongitude - normalizeLongitude(Number(longitude)) + 540) % 360 - 180) * Math.PI / 180;
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(Number(latitude) * Math.PI / 180) *
            Math.cos(candidateLatitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
          const distanceKm = 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          if (distanceKm > 0 && distanceKm <= LOCAL_ESTIMATE_MAX_DISTANCE_KM) {
            candidates.push({ latitude:candidateLatitude, longitude:candidateLongitude, distanceKm });
          }
        }
      }
      candidates.sort((a, b) => a.distanceKm - b.distanceKm);
      for (const candidate of candidates) {
        if (signal?.aborted) return null;
        const result = await sample(candidate.latitude, candidate.longitude, options);
        if (result?.dhw_c_weeks != null) return result;
      }
      return null;
    }

    return Object.freeze({
      activate,
      deactivate() { enabled = false; activation += 1; map.off?.('zoomend', updateZoomOpacity); removeLayer(); onStatus({ state: 'off' }); },
      sample, sampleNearest,
      get metadata() { return metadata; },
      get state() { return { enabled, hasLayer: Boolean(layer), cachedQueryTiles: queryCache.size }; }
    });
  }

  return { createCoralHeatStressView, normalizeLongitude };
});
