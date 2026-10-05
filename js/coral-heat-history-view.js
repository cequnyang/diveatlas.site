(function attachCoralHeatStressHistoryView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasCoralHeatStressHistory = api;
})(typeof window === 'undefined' ? globalThis : window, function buildCoralHeatStressHistoryApi() {
  const HEADER_BYTES = 17;
  const RECORD_PREFIX_BYTES = 2;
  const POINT_TILE_MAGIC = 'DCHH';
  const POINT_TILE_VERSION = 1;
  const POINT_TILE_SIZE = 256;
  const GLOBAL_VALUE_TILE_MAGIC = 'DCHG';
  const GLOBAL_VALUE_TILE_SIZE = 256;
  const GLOBAL_VALUE_TILE_HEADER_BYTES = 17;

  function normalizeLongitude(longitude) {
    return ((longitude + 180) % 360 + 360) % 360 - 180;
  }

  function validateMetadata(value) {
    if (!value || value.schema_version !== 1 || value.productVersion !== '3.7.0' ||
        value.variable !== 'ann_max_dhw' || value.metric !== 'Annual Maximum Degree Heating Week' ||
        value.yearStart !== 1985 || !Number.isInteger(value.yearEnd) || value.yearEnd < 1985 ||
        !Array.isArray(value.years) || value.years.length !== value.yearEnd - value.yearStart + 1 ||
        value.years.some((year, index) => year !== value.yearStart + index) ||
        value.grid?.width !== 7200 || value.grid?.height !== 1390 ||
        value.encoding?.mapZoom !== 5 || value.encoding?.pointTileSizeCells !== POINT_TILE_SIZE ||
        value.encoding?.pointHeaderBytes !== HEADER_BYTES ||
        value.encoding?.pointRecordBytes !== RECORD_PREFIX_BYTES + value.years.length * 4 ||
        !value.asset_base || !value.encoding?.mapTileTemplate || !value.pointTileTemplate) {
      throw new TypeError('Thermal History metadata is incomplete or unsupported');
    }
    return value;
  }

  function validateMapMetadata(value) {
    if (!value || value.schema_version !== 1 || value.variable !== 'degree_heating_week' ||
        value.yearStart !== 2016 || value.yearEnd !== 2025 ||
        JSON.stringify(value.years) !== JSON.stringify(Array.from({ length: 10 }, (_, index) => 2016 + index)) ||
        value.grid?.width !== 7200 || value.grid?.height !== 3600 ||
        value.encoding?.mapZoom !== 5 || !value.asset_base || !value.encoding?.mapTileTemplate) {
      throw new TypeError('Global Thermal History map metadata is incomplete or unsupported');
    }
    if (value.encoding.valueTileTemplate &&
        (value.encoding.valueTileSizeCells !== GLOBAL_VALUE_TILE_SIZE ||
         value.encoding.valueTileHeaderBytes !== GLOBAL_VALUE_TILE_HEADER_BYTES ||
         value.encoding.valueTileBytesPerCell !== 2 || value.encoding.valueMissing !== 65535 ||
         value.encoding.valueScaleFactor !== 0.01 || value.grid?.row_order !== 'north-to-south')) {
      throw new TypeError('Global Thermal History value-tile metadata is incomplete or unsupported');
    }
    return value;
  }

  function createCoralHeatStressHistoryView({ L, map, onStatus = () => {}, fetchImpl = (...args) => fetch(...args) }) {
    const style = globalThis.DiveAtlasCoralHeatStressStyle;
    let metadata = null;
    let metadataPromise = null;
    let mapMetadata = null;
    let mapMetadataPromise = null;
    let enabled = false;
    let activation = 0;
    let selectedYear = null;
    let activeYear = null;
    let activeLayer = null;
    let retainedOpacity = 0;
    const yearLayers = new Map();
    const pointCache = new Map();
    const globalValueCache = new Map();

    function loadMetadata() {
      metadataPromise ||= Promise.resolve()
        .then(() => fetchImpl('data/coral-heat-stress/history/metadata.json', { cache: 'no-cache' }))
        .then(response => { if (!response.ok) throw new Error('Thermal History metadata unavailable'); return response.json(); })
        .then(validateMetadata)
        .catch(error => { metadataPromise = null; throw error; });
      return metadataPromise;
    }

    function loadMapMetadata() {
      mapMetadataPromise ||= Promise.resolve()
        .then(() => fetchImpl('data/coral-heat-stress/history/global-maps/metadata.json', { cache: 'no-cache' }))
        .then(response => { if (!response.ok) throw new Error('Global Thermal History map metadata unavailable'); return response.json(); })
        .then(validateMapMetadata)
        .catch(error => { mapMetadataPromise = null; throw error; });
      return mapMetadataPromise;
    }

    function evictOldYearLayers() {
      while (yearLayers.size > 3) {
        const oldestYear = yearLayers.keys().next().value;
        const oldestLayer = yearLayers.get(oldestYear);
        if (oldestLayer && map.hasLayer(oldestLayer)) map.removeLayer(oldestLayer);
        yearLayers.delete(oldestYear);
      }
    }

    function selectYear(year) {
      if (!mapMetadata) return;
      const bounded = Math.max(mapMetadata.yearStart, Math.min(mapMetadata.yearEnd, Math.trunc(Number(year))));
      if (!Number.isFinite(bounded)) return;
      selectedYear = bounded;
      const requestActivation = activation;
      if (activeYear === bounded && activeLayer && map.hasLayer(activeLayer)) return;
      onStatus({ state: 'loading-year', year: bounded });
      if (activeLayer && map.hasLayer(activeLayer)) {
        retainedOpacity = activeLayer.options.opacity ?? 0;
        map.removeLayer(activeLayer);
      }
      activeLayer = yearLayers.get(bounded) || null;
      if (!activeLayer) {
        const template = mapMetadata.encoding.mapTileTemplate
          .replace('{year}', String(bounded))
          .replace('{z}', '{z}').replace('{x}', '{x}').replace('{y}', '{y}');
        activeLayer = L.tileLayer(`${mapMetadata.asset_base}/${template}?v=${encodeURIComponent(mapMetadata.release || mapMetadata.version)}`, {
          pane: 'coralHeatStressPane', minZoom: 2, maxZoom: 19,
          minNativeZoom: mapMetadata.encoding.mapZoom,
          maxNativeZoom: mapMetadata.encoding.maxNativeZoom || mapMetadata.encoding.mapZoom,
          tileSize: 256, opacity: style?.zoomOpacityAt(map.getZoom()) ?? 0.78, updateWhenZooming: false, keepBuffer: 1,
          className: 'coral-heat-stress-history-tiles', crossOrigin: true
        });
        yearLayers.set(bounded, activeLayer);
      } else {
        yearLayers.delete(bounded);
        yearLayers.set(bounded, activeLayer);
      }
      activeYear = bounded;
      activeLayer.on('load', () => {
        if (enabled && activation === requestActivation && selectedYear === bounded) onStatus({ state: 'ready', year: bounded });
      });
      activeLayer.on('tileerror', () => {
        if (enabled && activation === requestActivation && selectedYear === bounded) onStatus({ state: 'unavailable', year: bounded });
      });
      activeLayer.addTo(map);
        if (retainedOpacity > 0 && globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === false && typeof activeLayer.setOpacity === 'function') {
        const destination = style?.zoomOpacityAt(map.getZoom()) ?? 0.78;
        activeLayer.setOpacity(retainedOpacity);
        requestAnimationFrame(() => activeLayer?.setOpacity(destination));
      }
      map.on?.('zoomend', updateZoomOpacity);
      evictOldYearLayers();
    }

    function updateZoomOpacity() {
      if (activeLayer?.setOpacity) activeLayer.setOpacity(globalThis.DiveAtlasCoralHeatStressStyle?.zoomOpacityAt(map.getZoom()) ?? 0.78);
    }

    async function activate(year = mapMetadata?.yearEnd || 2025) {
      enabled = true;
      const requestActivation = ++activation;
      onStatus({ state: 'loading-metadata' });
      try {
        mapMetadata = await loadMapMetadata();
        if (!enabled || activation !== requestActivation) return;
        onStatus({ state: 'metadata', metadata: mapMetadata });
        selectYear(year ?? selectedYear ?? mapMetadata.yearEnd);
      } catch (error) {
        if (enabled && activation === requestActivation) onStatus({ state: 'unavailable', error });
      }
    }

    async function loadPointTile(address, signal) {
      const key = `${metadata.release || metadata.version}/${address.tileColumn}/${address.tileRow}`;
      if (pointCache.has(key)) {
        const value = pointCache.get(key);
        pointCache.delete(key);
        pointCache.set(key, value);
        return value;
      }
      const path = metadata.pointTileTemplate
        .replace('{column}', String(address.tileColumn)).replace('{row}', String(address.tileRow));
      const response = await fetchImpl(`${metadata.asset_base}/${path}?v=${encodeURIComponent(metadata.release || metadata.version)}`, { signal });
      // Sparse reef-history releases omit chunks with no reef/analyzed cells.
      // Treat that absence as missing point coverage so callers can use the
      // global annual product instead of aborting the location lookup.
      if (response.status === 404) {
        pointCache.set(key, null);
        if (pointCache.size > 12) pointCache.delete(pointCache.keys().next().value);
        return null;
      }
      if (!response.ok) throw new Error('Thermal History location data unavailable');
      if (typeof DecompressionStream !== 'function') throw new Error('Compressed Thermal History data is unsupported');
      const compressed = await response.arrayBuffer();
      const decoded = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      const view = new DataView(decoded);
      const size = metadata.encoding.pointRecordBytes;
      if (view.byteLength < HEADER_BYTES || String.fromCharCode(...new Uint8Array(decoded, 0, 4)) !== POINT_TILE_MAGIC ||
          view.getUint8(4) !== POINT_TILE_VERSION || view.getUint16(5, true) !== POINT_TILE_SIZE ||
          view.getUint16(7, true) !== metadata.years.length || view.getUint16(9, true) !== address.tileColumn ||
          view.getUint16(11, true) !== address.tileRow || view.byteLength !== HEADER_BYTES + view.getUint32(13, true) * size) {
        throw new TypeError('Thermal History point tile is invalid');
      }
      const parsed = { buffer: decoded, count: view.getUint32(13, true), recordSize: size };
      pointCache.set(key, parsed);
      if (pointCache.size > 12) pointCache.delete(pointCache.keys().next().value);
      return parsed;
    }

    function addressFor(latitude, longitude) {
      const grid = metadata.grid;
      const column = Math.round((normalizeLongitude(longitude) - grid.longitude_min) / grid.longitude_step);
      const wrappedColumn = ((column % grid.width) + grid.width) % grid.width;
      const row = Math.round((latitude - grid.latitude_min) / grid.latitude_step);
      if (!Number.isFinite(latitude) || latitude < grid.latitude_min - grid.latitude_step / 2 ||
          latitude > grid.latitude_max + grid.latitude_step / 2 || row < 0 || row >= grid.height) return null;
      return {
        row, column: wrappedColumn,
        tileColumn: Math.floor(wrappedColumn / POINT_TILE_SIZE),
        tileRow: Math.floor(row / POINT_TILE_SIZE),
        localCell: (row % POINT_TILE_SIZE) * POINT_TILE_SIZE + wrappedColumn % POINT_TILE_SIZE
      };
    }

    async function sample(latitude, longitude, { signal } = {}) {
      if (!enabled) return null;
      if (!metadata) metadata = await loadMetadata();
      if (!enabled || signal?.aborted) return null;
      const address = addressFor(latitude, longitude);
      if (!address) return null;
      const tile = await loadPointTile(address, signal);
      if (!tile || !enabled || signal?.aborted) return null;
      const view = new DataView(tile.buffer);
      let low = 0;
      let high = tile.count - 1;
      let recordOffset = -1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        const offset = HEADER_BYTES + middle * tile.recordSize;
        const cell = view.getUint16(offset, true);
        if (cell === address.localCell) { recordOffset = offset; break; }
        if (cell < address.localCell) low = middle + 1;
        else high = middle - 1;
      }
      if (recordOffset < 0) return null;
      const values = metadata.years.map((_, index) => view.getFloat32(recordOffset + 2 + index * 4, true));
      return {
        years: metadata.years,
        values,
        source_latitude: metadata.grid.latitude_min + address.row * metadata.grid.latitude_step,
        source_longitude: metadata.grid.longitude_min + address.column * metadata.grid.longitude_step
      };
    }

    async function loadGlobalValueTile(address, year, signal) {
      const key = `${mapMetadata.release || mapMetadata.version}/${year}/${address.tileColumn}/${address.tileRow}`;
      if (globalValueCache.has(key)) {
        const value = globalValueCache.get(key);
        globalValueCache.delete(key);
        globalValueCache.set(key, value);
        return value;
      }
      const path = mapMetadata.encoding.valueTileTemplate
        .replace('{year}', String(year))
        .replace('{column}', String(address.tileColumn))
        .replace('{row}', String(address.tileRow));
      const response = await fetchImpl(`${mapMetadata.asset_base}/${path}?v=${encodeURIComponent(mapMetadata.release || mapMetadata.version)}`, { signal });
      if (response.status === 404) {
        globalValueCache.set(key, null);
        if (globalValueCache.size > 12) globalValueCache.delete(globalValueCache.keys().next().value);
        return null;
      }
      if (!response.ok) throw new Error('Global annual DHW values unavailable');
      if (typeof DecompressionStream !== 'function') throw new Error('Compressed global DHW data is unsupported');
      const compressed = await response.arrayBuffer();
      const decoded = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      const expectedBytes = GLOBAL_VALUE_TILE_HEADER_BYTES + GLOBAL_VALUE_TILE_SIZE * GLOBAL_VALUE_TILE_SIZE * 2;
      const view = new DataView(decoded);
      if (view.byteLength !== expectedBytes || String.fromCharCode(...new Uint8Array(decoded, 0, 4)) !== GLOBAL_VALUE_TILE_MAGIC ||
          view.getUint8(4) !== 1 || view.getUint16(5, true) !== GLOBAL_VALUE_TILE_SIZE ||
          view.getUint16(7, true) !== address.tileColumn || view.getUint16(9, true) !== address.tileRow ||
          view.getUint32(13, true) === 0 || view.getUint32(13, true) > GLOBAL_VALUE_TILE_SIZE ** 2) {
        throw new TypeError('Global annual DHW value tile is invalid');
      }
      const tile = { buffer: decoded, count: view.getUint32(13, true) };
      globalValueCache.set(key, tile);
      if (globalValueCache.size > 12) globalValueCache.delete(globalValueCache.keys().next().value);
      return tile;
    }

    async function sampleGlobal(year, latitude, longitude, { signal } = {}) {
      if (!enabled) return null;
      if (!mapMetadata) mapMetadata = await loadMapMetadata();
      if (!enabled || signal?.aborted) return null;
      if (!mapMetadata.encoding.valueTileTemplate) return null;
      const selected = Math.trunc(Number(year));
      if (!Number.isFinite(selected) || !mapMetadata.years.includes(selected)) return null;
      const grid = mapMetadata.grid;
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude)) return null;
      const row = Math.round((90 - grid.latitude_step / 2 - latitude) / grid.latitude_step);
      const column = ((Math.round((normalizeLongitude(longitude) - grid.longitude_min) / grid.longitude_step) % grid.width) + grid.width) % grid.width;
      if (row < 0 || row >= grid.height) return null;
      const address = {
        row, column,
        tileColumn: Math.floor(column / GLOBAL_VALUE_TILE_SIZE),
        tileRow: Math.floor(row / GLOBAL_VALUE_TILE_SIZE),
        localCell: (row % GLOBAL_VALUE_TILE_SIZE) * GLOBAL_VALUE_TILE_SIZE + column % GLOBAL_VALUE_TILE_SIZE
      };
      const tile = await loadGlobalValueTile(address, selected, signal);
      if (!tile || !enabled || signal?.aborted) return null;
      const view = new DataView(tile.buffer);
      const value = view.getUint16(GLOBAL_VALUE_TILE_HEADER_BYTES + address.localCell * 2, true);
      if (value === mapMetadata.encoding.valueMissing) return null;
      return {
        year: selected,
        value: value * mapMetadata.encoding.valueScaleFactor,
        source_latitude: 90 - grid.latitude_step / 2 - row * grid.latitude_step,
        source_longitude: grid.longitude_min + column * grid.longitude_step
      };
    }

    async function sampleGlobalHistory(selectedYear, latitude, longitude, { signal } = {}) {
      if (!enabled) return null;
      if (!mapMetadata) mapMetadata = await loadMapMetadata();
      if (!enabled || signal?.aborted || !mapMetadata.encoding.valueTileTemplate) return null;
      const selected = Math.trunc(Number(selectedYear));
      if (!Number.isFinite(selected) || !mapMetadata.years.includes(selected)) return null;

      // Resolve the selected year first: it anchors the popup, and there is no
      // useful fallback chart if that clicked map cell has no selected-year value.
      const selectedResult = await sampleGlobal(selected, latitude, longitude, { signal });
      if (!selectedResult || !enabled || signal?.aborted) return null;

      const remaining = await Promise.all(mapMetadata.years
        .filter(year => year !== selected)
        .map(async year => {
          try {
            return { year, result: await sampleGlobal(year, latitude, longitude, { signal }), unavailable: false };
          } catch (error) {
            if (error?.name === 'AbortError' || signal?.aborted) throw error;
            return { year, result: null, unavailable: true };
          }
        }));
      if (!enabled || signal?.aborted) return null;

      const byYear = new Map([[selected, selectedResult]]);
      const unavailableYears = [];
      for (const entry of remaining) {
        byYear.set(entry.year, entry.result);
        if (entry.unavailable) unavailableYears.push(entry.year);
      }
      return {
        year: selected,
        value: selectedResult.value,
        years: mapMetadata.years,
        values: mapMetadata.years.map(year => byYear.get(year)?.value ?? NaN),
        unavailableYears,
        source_latitude: selectedResult.source_latitude,
        source_longitude: selectedResult.source_longitude
      };
    }

    function deactivate() {
      enabled = false;
      activation += 1;
      map.off?.('zoomend', updateZoomOpacity);
      for (const layer of yearLayers.values()) if (map.hasLayer(layer)) {
        retainedOpacity = layer.options.opacity ?? 0;
        map.removeLayer(layer);
      }
      activeLayer = null;
      activeYear = null;
      onStatus({ state: 'off' });
    }

    return Object.freeze({
      activate,
      deactivate,
      selectYear,
      sample,
      sampleGlobal,
      sampleGlobalHistory,
      get metadata() { return metadata; },
      get mapMetadata() { return mapMetadata; },
      get state() { return { enabled, selectedYear, activeYear, cachedYears: yearLayers.size, cachedYearOrder: [...yearLayers.keys()], cachedPointTiles: pointCache.size }; }
    });
  }

  return { createCoralHeatStressHistoryView, normalizeLongitude, validateMetadata, validateMapMetadata };
});
