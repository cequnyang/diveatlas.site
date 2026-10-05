(function attachWavesView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasWavesView = api;
})(typeof window === 'undefined' ? globalThis : window, function buildWavesViewApi() {
  const MONTHS = Object.freeze(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']);
  const QUERY_HEADER_BYTES = 16;
  const MISSING = -32768;

  function normalizeLongitude(longitude) {
    return ((longitude + 180) % 360 + 360) % 360 - 180;
  }

  function createWavesView({ L, map, onStatus = () => {}, metadataLoader, fetchImpl = (...args) => fetch(...args), queryCacheEntries = 48 }) {
    let metadata = null;
    let metadataPromise = null;
    let enabled = false;
    let month = 9;
    let generation = 0;
    let activationGeneration = 0;
    let layer = null;
    const queryCache = new Map();
    const pendingQueries = new Map();

    function validateMetadata(value) {
      if (!value || value.schema_version !== 1 || !value.grid || !value.encoding ||
          !Number.isInteger(value.encoding.query_tile_size_cells) || !value.query?.tile_template ||
          !value.map?.tile_template || !Array.isArray(value.available_months) || !value.attribution) {
        throw new TypeError('Waves metadata is missing its grid, tile formats, or source attribution');
      }
      return value;
    }

    function loadMetadata() {
      metadataPromise ||= Promise.resolve().then(() => {
        const loader = metadataLoader || (() => fetchImpl('data/waves/metadata.json', { cache: 'no-cache' }).then(response => {
          if (!response.ok) throw new Error(`Waves metadata returned HTTP ${response.status}`);
          return response.json();
        }));
        return loader();
      }).then(validateMetadata).catch(error => {
        metadataPromise = null;
        throw error;
      });
      return metadataPromise;
    }

    function mapTileUrl(selectedMonth) {
      const path = metadata.map.tile_template
        .replace('{month}', String(selectedMonth).padStart(2, '0'));
      return `${metadataAssetBase()}/${path}?v=${encodeURIComponent(metadata.version)}`;
    }

    function metadataAssetBase() {
      return String(metadata.asset_base || 'data/waves').replace(/\/$/, '');
    }

    function removeLayer() {
      if (layer && map.hasLayer(layer)) map.removeLayer(layer);
      layer = null;
    }

    function selectMonth(nextMonth) {
      if (!enabled || !Number.isInteger(Number(nextMonth)) || Number(nextMonth) < 1 || Number(nextMonth) > 12) return false;
      month = Number(nextMonth);
      const requestGeneration = ++generation;
      removeLayer();
      if (!metadata) {
        onStatus({ state: 'loading-metadata', month });
        return true;
      }
      if (!metadata.available_months.includes(month)) {
        onStatus({ state: 'unavailable', month });
        return false;
      }
      onStatus({ state: 'loading', month });
      const nextLayer = L.tileLayer(mapTileUrl(month), {
        pane: 'wavesPane',
        minZoom: 2,
        maxZoom: 19,
        minNativeZoom: metadata.encoding.map_zoom,
        maxNativeZoom: metadata.encoding.max_native_zoom,
        tileSize: 256,
        opacity: 0.88,
        updateWhenZooming: false,
        keepBuffer: 1,
        className: 'waves-tiles',
        crossOrigin: true
      });
      nextLayer.on('load', () => {
        if (requestGeneration !== generation || !enabled || layer !== nextLayer) return;
        onStatus({ state: 'ready', month });
      });
      nextLayer.on('tileerror', () => {
        if (requestGeneration !== generation || !enabled || layer !== nextLayer) return;
        onStatus({ state: 'unavailable', month });
      });
      layer = nextLayer;
      nextLayer.addTo(map);
      return true;
    }

    function queryTileAddress(latitude, longitude) {
      const grid = metadata.grid;
      const tileSize = metadata.encoding.query_tile_size_cells;
      const normalizedLongitude = normalizeLongitude(longitude);
      const column = Math.round((normalizedLongitude - grid.longitude_min) / grid.longitude_step);
      const latitudeIndex = Math.round((latitude - grid.latitude_min) / grid.latitude_step);
      if (latitudeIndex < 0 || latitudeIndex >= grid.height) return null;
      const wrappedColumn = ((column % grid.width) + grid.width) % grid.width;
      const northRow = grid.height - 1 - latitudeIndex;
      return {
        column: wrappedColumn,
        row: northRow,
        tileColumn: Math.floor(wrappedColumn / tileSize),
        tileRow: Math.floor(northRow / tileSize),
        innerColumn: wrappedColumn % tileSize,
        innerRow: northRow % tileSize
      };
    }

    async function loadQueryTile(selectedMonth, address, signal) {
      const key = `${metadata.version}/${selectedMonth}/${address.tileColumn}/${address.tileRow}`;
      if (queryCache.has(key)) return queryCache.get(key);
      if (pendingQueries.has(key)) return pendingQueries.get(key);
      const promise = (async () => {
        const path = metadata.query.tile_template
          .replace('{month}', String(selectedMonth).padStart(2, '0'))
          .replace('{column}', String(address.tileColumn))
          .replace('{row}', String(address.tileRow));
        const response = await fetchImpl(`${metadataAssetBase()}/${path}?v=${encodeURIComponent(metadata.version)}`, { signal });
        if (!response.ok) throw new Error(`Waves query tile returned HTTP ${response.status}`);
        const compressed = await response.arrayBuffer();
        if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot decode compressed Waves query tiles');
        const decoded = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
        const view = new DataView(decoded);
        if (view.byteLength < QUERY_HEADER_BYTES ||
            String.fromCharCode(...new Uint8Array(decoded, 0, 4)) !== 'DATW' ||
            view.getUint8(4) !== 1 || view.getUint8(5) !== 2 ||
            view.getUint16(8, true) !== metadata.encoding.query_tile_size_cells ||
            view.getUint16(10, true) !== address.tileColumn || view.getUint16(12, true) !== address.tileRow) {
          throw new TypeError('Waves query tile header does not match its manifest or requested location');
        }
        const expectedLength = QUERY_HEADER_BYTES + metadata.encoding.query_tile_size_cells ** 2 * 4;
        if (view.byteLength !== expectedLength) throw new TypeError('Waves query tile length is invalid');
        queryCache.set(key, decoded);
        if (queryCache.size > queryCacheEntries) queryCache.delete(queryCache.keys().next().value);
        return decoded;
      })().finally(() => pendingQueries.delete(key));
      pendingQueries.set(key, promise);
      return promise;
    }

    async function sample(latitude, longitude, selectedMonth = month, { signal } = {}) {
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 ||
          !Number.isInteger(Number(selectedMonth)) || Number(selectedMonth) < 1 || Number(selectedMonth) > 12) return null;
      if (!metadata) metadata = await loadMetadata();
      if (!metadata.available_months.includes(Number(selectedMonth))) return null;
      const address = queryTileAddress(latitude, longitude);
      if (!address) return null;
      const bytes = await loadQueryTile(Number(selectedMonth), address, signal);
      if (signal?.aborted) return null;
      const view = new DataView(bytes);
      const offset = QUERY_HEADER_BYTES + (address.innerRow * metadata.encoding.query_tile_size_cells + address.innerColumn) * 4;
      const heightCode = view.getInt16(offset, true);
      const periodCode = view.getInt16(offset + 2, true);
      if (heightCode === MISSING && periodCode === MISSING) return null;
      return {
        month: Number(selectedMonth),
        height_m: heightCode === MISSING ? null : heightCode * metadata.variables.height.scale_factor,
        mean_period_s: periodCode === MISSING ? null : periodCode * metadata.variables.mean_period.scale_factor,
        source_latitude: metadata.grid.latitude_min + Math.round((latitude - metadata.grid.latitude_min) / metadata.grid.latitude_step) * metadata.grid.latitude_step,
        source_longitude: metadata.grid.longitude_min + address.column * metadata.grid.longitude_step
      };
    }

    async function sampleYear(latitude, longitude, { signal } = {}) {
      return Promise.all(MONTHS.map(async (_, index) => {
        const selectedMonth = index + 1;
        const result = await sample(latitude, longitude, selectedMonth, { signal });
        return { month: selectedMonth, value_m: result?.height_m ?? null };
      }));
    }

    async function retry() {
      if (!enabled) return false;
      generation += 1;
      removeLayer();
      onStatus({ state: 'loading-metadata', month });
      try {
        if (!metadata) {
          metadataPromise = null;
          metadata = await loadMetadata();
          if (!enabled) return false;
          onStatus({ state: 'metadata', metadata });
        }
        return selectMonth(month);
      } catch (error) {
        if (enabled) onStatus({ state: 'unavailable', month, error });
        return false;
      }
    }

    return Object.freeze({
      activate(initialMonth = month) {
        if (enabled) return;
        enabled = true;
        month = Number(initialMonth);
        generation += 1;
        const lifecycle = ++activationGeneration;
        onStatus({ state: 'loading-metadata', month });
        loadMetadata().then(result => {
          if (!enabled || lifecycle !== activationGeneration) return;
          metadata = result;
          onStatus({ state: 'metadata', metadata });
          selectMonth(month);
        }).catch(error => {
          if (!enabled || requestGeneration !== generation) return;
          onStatus({ state: 'unavailable', month, error });
        });
      },
      deactivate() {
        enabled = false;
        generation += 1;
        activationGeneration += 1;
        removeLayer();
        onStatus({ state: 'off', month });
      },
      selectMonth,
      retry,
      sample,
      sampleYear,
      get state() { return { enabled, month, hasLayer: Boolean(layer), generation }; },
      get metadata() { return metadata; },
      getMetadata() { return metadata || loadMetadata(); },
      get monthName() { return MONTHS[month - 1]; }
    });
  }

  return { createWavesView, normalizeLongitude };
});
