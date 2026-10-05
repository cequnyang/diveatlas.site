(function attachRegionalCurrents(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasRegionalCurrents = api;
})(typeof window === 'undefined' ? globalThis : window, function buildRegionalCurrentsApi() {
  const math = typeof window !== 'undefined'
    ? window.DiveAtlasCurrentMath
    : typeof require === 'function'
    ? require('./current-math.js')
    : null;
  const cacheApi = typeof window !== 'undefined'
    ? window.DiveAtlasCurrentTileCache
    : typeof require === 'function'
    ? require('./current-tile-cache.js')
    : null;
  if (!math || !cacheApi) throw new Error('Regional Currents math and tile decoder modules must load first');

  const MONTHS = Object.freeze([
    'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
  ]);

  function tierForZoom(tiers, zoom) {
    return tiers.find(tier => zoom >= tier.min_zoom && zoom <= tier.max_zoom) || null;
  }

  function longitudeCopies(west, east) {
    const copies = [];
    const first = Math.floor((west + 180) / 360);
    const last = Math.floor((east + 180) / 360);
    for (let copy = first; copy <= last; copy += 1) {
      copies.push({ copy, west: Math.max(-180, west - copy * 360), east: Math.min(180, east - copy * 360) });
    }
    return copies.filter(item => item.east >= item.west);
  }

  function viewportTileAddresses(bounds, tier, metadata, centerLongitude, maxTilesPerWorldCopy = 48) {
    const addresses = longitudeCopies(bounds.getWest(), bounds.getEast()).flatMap(copy => {
      const worldBounds = {
        getWest: () => copy.west,
        getEast: () => copy.east,
        getSouth: () => bounds.getSouth(),
        getNorth: () => bounds.getNorth()
      };
      return visibleTileAddresses(worldBounds, tier, metadata, centerLongitude, maxTilesPerWorldCopy);
    });
    return [...new Map(addresses.map(address => [`${address.column}/${address.row}`, address])).values()];
  }

  function visibleTileAddresses(bounds, tier, metadata, centerLongitude, maxTiles = 48) {
    const tileSize = metadata.tile_size;
    const blockSpan = tileSize * tier.step;
    const longitudeCount = metadata.grid.width;
    const latitudeCount = metadata.grid.height;
    const maxColumn = Math.ceil(longitudeCount / blockSpan) - 1;
    const maxRow = Math.ceil(latitudeCount / blockSpan) - 1;
    const minLongitude = metadata.grid.longitude_min;
    const minLatitude = metadata.grid.latitude_min;
    const lonStep = metadata.grid.longitude_step;
    const latStep = metadata.grid.latitude_step;
    const minLon = Math.max(minLongitude, Math.min(bounds.getWest(), bounds.getEast()));
    const maxLon = Math.min(minLongitude + lonStep * (longitudeCount - 1), Math.max(bounds.getWest(), bounds.getEast()));
    const minLat = Math.max(minLatitude, Math.min(bounds.getSouth(), bounds.getNorth()));
    const maxLat = Math.min(metadata.grid.latitude_max, Math.max(bounds.getSouth(), bounds.getNorth()));
    if (minLat > maxLat || minLon > maxLon) return [];

    const firstColumn = Math.max(0, Math.floor((minLon - minLongitude) / (lonStep * blockSpan)));
    const lastColumn = Math.min(maxColumn, Math.floor((maxLon - minLongitude) / (lonStep * blockSpan)));
    const firstRow = Math.max(0, Math.floor((metadata.grid.latitude_max - maxLat) / (latStep * blockSpan)));
    const lastRow = Math.min(maxRow, Math.floor((metadata.grid.latitude_max - minLat) / (latStep * blockSpan)));
    const centerLon = Number.isFinite(centerLongitude) ? centerLongitude : (bounds.getWest() + bounds.getEast()) / 2;
    const addresses = [];
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const lon = minLongitude + (column * blockSpan + blockSpan / 2) * lonStep;
        const lat = metadata.grid.latitude_max - (row * blockSpan + blockSpan / 2) * latStep;
        const worldLon = lon + 360 * Math.round((centerLon - lon) / 360);
        addresses.push({ column, row, distance: Math.abs(worldLon - centerLon) + Math.abs(lat - (bounds.getSouth() + bounds.getNorth()) / 2) });
      }
    }
    return addresses.sort((a, b) => a.distance - b.distance).slice(0, maxTiles);
  }

  async function gunzip(buffer) {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot decode compressed current tiles');
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }

  function createCurrentView({ L, map, metadataUrl = 'data/currents/metadata.json', onStatus = () => {}, onInspect = () => {}, fetchImpl = (...args) => fetch(...args), tileCacheEntries = 96 }) {
    let metadata = null;
    let metadataPromise = null;
    let enabled = false;
    let month = 9;
    let depth = '20';
    let generation = 0;
    let refreshFrame = 0;
    const tileCache = new cacheApi.LruTileCache(tileCacheEntries);
    const pendingTiles = new Map();
    const activeTiles = new Map();
    let activeTileColumns = 0;
    let lastBatchMetrics = { requestCount: 0, downloadMs: 0, decompressionMs: 0, decodeMs: 0, compressedBytes: 0 };

    function validateMetadata(value) {
      if (!value || value.data_format_version !== 1 || !value.grid || !Array.isArray(value.zooms) ||
          !Number.isInteger(value.tile_size) || value.tile_size < 16 ||
          !Array.isArray(value.available_slices) || !value.asset_base || !value.tile_template ||
          !Number.isFinite(value.quantization?.scale_m_s)) {
        throw new TypeError('Regional Currents metadata is incomplete');
      }
      return value;
    }

    function loadMetadata() {
      metadataPromise ||= fetchImpl(metadataUrl).then(response => {
        if (!response.ok) throw new Error(`Current metadata returned HTTP ${response.status}`);
        return response.json();
      }).then(validateMetadata).catch(error => {
        metadataPromise = null;
        throw error;
      });
      return metadataPromise;
    }

    async function sample(latitude, longitude, selectedMonth = month, selectedDepth = depth, options = {}) {
      if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude)) ||
          !Number.isInteger(Number(selectedMonth)) || Number(selectedMonth) < 1 || Number(selectedMonth) > 12 ||
          !['0', '10', '20', '30'].includes(String(selectedDepth))) return null;
      if (!metadata) metadata = await loadMetadata();
      const depthLabel = String(selectedDepth) === '0' ? 'surface' : `${selectedDepth}m`;
      if (!metadata.available_slices.some(slice => Number(slice.month) === Number(selectedMonth) && String(slice.depth_label) === depthLabel)) return null;
      const grid = metadata.grid;
      // Query the finest static current tiles (step 4); step 1 source-grid files are not shipped.
      const step = metadata.zooms.reduce((finest, candidate) => candidate.step < finest.step ? candidate : finest).step;
      const rows = Math.ceil(grid.height / step);
      const columns = Math.ceil(grid.width / step);
      let column = Math.round((Number(longitude) - grid.longitude_min) / (grid.longitude_step * step));
      column = ((column % columns) + columns) % columns;
      const row = Math.round((grid.latitude_max - Number(latitude)) / (grid.latitude_step * step));
      if (row < 0 || row >= rows) return null;
      const address = { column: Math.floor(column / metadata.tile_size), row: Math.floor(row / metadata.tile_size) };
      const cacheKey = cacheApi.tileCacheKey({ version:metadata.version, month:Number(selectedMonth), depth:depthLabel,
        step, column:address.column, row:address.row });
      let tile = tileCache.get(cacheKey);
      if (!tile) {
        const path = metadata.tile_template
          .replaceAll('{format_version}', String(metadata.data_format_version))
          .replaceAll('{month}', MONTHS[Number(selectedMonth) - 1])
          .replaceAll('{depth}', depthLabel)
          .replaceAll('{step}', String(step))
          .replaceAll('{column}', String(address.column))
          .replaceAll('{row}', String(address.row));
        const url = `${metadata.asset_base.replace(/\/$/, '')}/${path}?v=${encodeURIComponent(metadata.version || '1')}`;
        const response = options?.signal ? await fetchImpl(url, { signal: options.signal }) : await fetchImpl(url);
        if (!response.ok) throw new Error(`Current tile returned HTTP ${response.status}`);
        tile = cacheApi.decodeTile(await gunzip(await response.arrayBuffer()), {
          tileSize: metadata.tile_size, step, column: address.column, row: address.row
        });
        tileCache.set(cacheKey, tile);
      }
      const localColumn = column - address.column * metadata.tile_size;
      const localRow = row - address.row * metadata.tile_size;
      const offset = (localRow * tile.width + localColumn) * 2;
      const storedU = tile.samples[offset], storedV = tile.samples[offset + 1];
      if (storedU === tile.missingValue || storedV === tile.missingValue) return null;
      const u = storedU * tile.scale, v = storedV * tile.scale;
      return { u, v, speed: math.currentSpeed(u, v), source_latitude: grid.latitude_max - row * grid.latitude_step * step,
        source_longitude: grid.longitude_min + column * grid.longitude_step * step, metadata };
    }

    function selectedSliceAvailable() {
      const depthLabel = depth === '0' ? 'surface' : `${depth}m`;
      return metadata.available_slices.some(slice => Number(slice.month) === month && String(slice.depth_label) === depthLabel);
    }

    function tileUrl(tier, address) {
      const monthPath = MONTHS[month - 1];
      const path = metadata.tile_template
        .replaceAll('{format_version}', String(metadata.data_format_version))
        .replaceAll('{month}', monthPath)
        .replaceAll('{depth}', depth === '0' ? 'surface' : `${depth}m`)
        .replaceAll('{step}', String(tier.step))
        .replaceAll('{column}', String(address.column))
        .replaceAll('{row}', String(address.row));
      const version = encodeURIComponent(metadata.version || '1');
      return `${metadata.asset_base.replace(/\/$/, '')}/${path}?v=${version}`;
    }

    function tileKey(tier, address) {
      return cacheApi.tileCacheKey({ version: metadata.version, month, depth, step: tier.step, column: address.column, row: address.row });
    }

    async function loadTile(tier, address, requestGeneration) {
      const key = tileKey(tier, address);
      const cached = tileCache.get(key);
      if (cached) return { key, tile: cached, address, tier, requestGeneration, fromCache: true,
        downloadMs: 0, decompressionMs: 0, decodeMs: 0, compressedBytes: 0 };
      if (pendingTiles.has(key)) return pendingTiles.get(key);
      const task = (async () => {
        const downloadStartedAt = performance.now();
        const response = await fetch(tileUrl(tier, address));
        if (!response.ok) throw new Error(`Current tile returned HTTP ${response.status}`);
        const compressed = await response.arrayBuffer();
        const downloadMs = performance.now() - downloadStartedAt;
        const decompressionStartedAt = performance.now();
        const buffer = await gunzip(compressed);
        const decompressionMs = performance.now() - decompressionStartedAt;
        const decodeStartedAt = performance.now();
        const tile = cacheApi.decodeTile(buffer, {
          tileSize: metadata.tile_size, step: tier.step, column: address.column, row: address.row
        });
        const decodeMs = performance.now() - decodeStartedAt;
        tileCache.set(key, tile);
        return { key, tile, address, tier, requestGeneration, fromCache: false, downloadMs, decompressionMs,
          decodeMs, compressedBytes: compressed.byteLength };
      })().finally(() => pendingTiles.delete(key));
      pendingTiles.set(key, task);
      return task;
    }

    async function refresh() {
      if (!enabled || !metadata) return;
      const zoom = map.getZoom();
      const tier = tierForZoom(metadata.zooms, zoom);
      const requestGeneration = ++generation;
      if (!tier) {
        activeTiles.clear();
        onStatus({ state: 'zoom', minZoom: metadata.zooms[0]?.min_zoom ?? 2 });
        return;
      }
      if (!selectedSliceAvailable()) {
        activeTiles.clear();
        onStatus({ state: 'unavailable' });
        return;
      }
      const bounds = map.getBounds();
      const centerLongitude = map.getCenter().lng;
      const uniqueAddresses = viewportTileAddresses(bounds, tier, metadata, centerLongitude);
      activeTiles.clear();
      activeTileColumns = Math.ceil(Math.ceil(metadata.grid.width / tier.step) / metadata.tile_size);
      onStatus({ state: 'loading', pending: uniqueAddresses.length });
      const results = [];
      let errors = 0;
      let renderFrame = 0;
      const queue = [...uniqueAddresses];
      const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
        while (queue.length && enabled && requestGeneration === generation) {
          const address = queue.shift();
          try {
            results.push(await loadTile(tier, address, requestGeneration));
            if (!renderFrame) {
              renderFrame = requestAnimationFrame(() => {
                renderFrame = 0;
                if (enabled && requestGeneration === generation) {
                  activeTiles.clear();
                  for (const entry of results) activeTiles.set(entry.address.row * activeTileColumns + entry.address.column, entry);
                }
              });
            }
          }
          catch (_) { errors += 1; }
        }
      });
      await Promise.all(workers);
      if (!enabled || requestGeneration !== generation) return;
      activeTiles.clear();
      for (const entry of results) activeTiles.set(entry.address.row * activeTileColumns + entry.address.column, entry);
      lastBatchMetrics = {
        requestCount: results.filter(entry => !entry.fromCache).length,
        downloadMs: results.reduce((sum, entry) => sum + entry.downloadMs, 0),
        decompressionMs: results.reduce((sum, entry) => sum + entry.decompressionMs, 0),
        decodeMs: results.reduce((sum, entry) => sum + entry.decodeMs, 0),
        compressedBytes: results.reduce((sum, entry) => sum + entry.compressedBytes, 0)
      };
      onStatus({ state: errors ? (results.length ? 'partial' : 'unavailable') : 'ready', loaded: results.length, errors,
        tileMetrics: lastBatchMetrics });
    }

    function scheduleRefresh() {
      if (refreshFrame || !enabled) return;
      refreshFrame = requestAnimationFrame(() => {
        refreshFrame = 0;
        void refresh();
      });
    }

    function activate(initialMonth = month, initialDepth = depth) {
      if (enabled) return;
      enabled = true;
      month = Number(initialMonth);
      depth = String(initialDepth);
      generation += 1;
      onStatus({ state: 'loading-metadata' });
      loadMetadata().then(result => {
        if (!enabled) return;
        metadata = result;
        map.on('moveend zoomend', scheduleRefresh);
        scheduleRefresh();
      }).catch(() => {
        if (enabled) onStatus({ state: 'unavailable' });
      });
    }

    function deactivate() {
      enabled = false;
      generation += 1;
      map.off('moveend zoomend', scheduleRefresh);
      if (refreshFrame) cancelAnimationFrame(refreshFrame);
      refreshFrame = 0;
      activeTiles.clear();
      onStatus({ state: 'off' });
    }

    function selectSlice(nextMonth, nextDepth) {
      if (!Number.isInteger(Number(nextMonth)) || Number(nextMonth) < 1 || Number(nextMonth) > 12 ||
          !['0', '10', '20', '30'].includes(String(nextDepth))) return false;
      month = Number(nextMonth);
      depth = String(nextDepth);
      if (enabled && metadata) void refresh();
      return true;
    }

    function findNearest(latlng) {
      if (!metadata || !activeTiles.size || !enabled) return null;
      const tier = tierForZoom(metadata.zooms, map.getZoom());
      if (!tier) return null;
      let closest = null;
      const maxDistance = metadata.grid.longitude_step * tier.step * 0.75;
      for (const entry of activeTiles.values()) {
        const { tile, address } = entry;
        for (let y = 0; y < tile.height; y += 1) {
          const row = address.row * metadata.tile_size + y;
          const lat = metadata.grid.latitude_max - row * tier.step * metadata.grid.latitude_step;
          if (Math.abs(lat - latlng.lat) > maxDistance) continue;
          const rowOffset = y * tile.width * 2;
          for (let x = 0; x < tile.width; x += 1) {
            const column = address.column * metadata.tile_size + x;
            const lon = metadata.grid.longitude_min + column * tier.step * metadata.grid.longitude_step;
            const longitudeDelta = Math.abs(lon - latlng.lng) % 360;
            const dx = Math.min(longitudeDelta, 360 - longitudeDelta) * Math.cos(latlng.lat * Math.PI / 180);
            const dy = Math.abs(lat - latlng.lat);
            const distance = Math.hypot(dx, dy);
            if (distance > maxDistance || (closest && distance >= closest.distance)) continue;
            const offset = rowOffset + x * 2;
            const storedU = tile.samples[offset];
            const storedV = tile.samples[offset + 1];
            if (storedU === tile.missingValue || storedV === tile.missingValue) continue;
            closest = { u: storedU * tile.scale, v: storedV * tile.scale, lat, lng: lon, distance };
          }
        }
      }
      if (!closest) return null;
      return Object.freeze({ ...closest, speed: math.currentSpeed(closest.u, closest.v), direction: math.currentDirection(closest.u, closest.v) });
    }

    // Flow samples the same viewport tiles as inspections, avoiding a second field download.
    // Writing into a caller-owned pair avoids per-particle objects.
    function sampleVelocity(latitude, longitude, output, maskAware = null) {
      if (!enabled || !metadata || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
      const tier = tierForZoom(metadata.zooms, map.getZoom());
      if (!tier) return false;
      const grid = metadata.grid;
      const step = tier.step;
      const longitudeCount = Math.ceil(grid.width / step);
      const latitudeCount = Math.ceil(grid.height / step);
      const longitudeStep = grid.longitude_step * step;
      const latitudeStep = grid.latitude_step * step;
      let x = (longitude - grid.longitude_min) / longitudeStep;
      x = ((x % longitudeCount) + longitudeCount) % longitudeCount;
      const y = (grid.latitude_max - latitude) / latitudeStep;
      if (y < 0 || y > latitudeCount - 1) return false;
      const x0 = Math.floor(x);
      const x1 = (x0 + 1) % longitudeCount;
      const y0 = Math.floor(y);
      const y1 = Math.min(y0 + 1, latitudeCount - 1);
      const fx = x - x0;
      const fy = y - y0;
      let u = 0;
      let v = 0;
      let validWeight = 0;
      for (let corner = 0; corner < 4; corner += 1) {
        const column = corner % 2 ? x1 : x0;
        const row = corner >= 2 ? y1 : y0;
        const weight = (corner % 2 ? fx : 1 - fx) * (corner >= 2 ? fy : 1 - fy);
        if (weight <= 1e-9) continue;
        const tileColumn = Math.floor(column / metadata.tile_size);
        const tileRow = Math.floor(row / metadata.tile_size);
        const entry = activeTiles.get(tileRow * activeTileColumns + tileColumn);
        if (!entry) return false;
        const offset = ((row % metadata.tile_size) * entry.tile.width + (column % metadata.tile_size)) * 2;
        const storedU = entry.tile.samples[offset];
        const storedV = entry.tile.samples[offset + 1];
        if (storedU === entry.tile.missingValue || storedV === entry.tile.missingValue) {
          if (!maskAware) return false;
          continue;
        }
        if (maskAware) {
          const sampleLatitude = grid.latitude_max - row * grid.latitude_step;
          const sampleLongitude = grid.longitude_min + column * grid.longitude_step;
          if (!maskAware(latitude, longitude, sampleLatitude, sampleLongitude)) continue;
        }
        u += storedU * entry.tile.scale * weight;
        v += storedV * entry.tile.scale * weight;
        validWeight += weight;
      }
      if (maskAware) {
        if (validWeight > 1e-9) {
          u /= validWeight;
          v /= validWeight;
        } else {
          // Zoom tiers intentionally thin the stored grid. Near coasts, an
          // entire bilinear cell can be no-data even though its ocean edge is
          // covered by the neighboring valid current cell. Reuse only an
          // already-loaded source sample one tier step away, and only across
          // an all-water bathymetry path; Flow keeps the strict sampler above.
          let nearest = null;
          for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
            const row = y0 + rowOffset;
            if (row < 0 || row >= latitudeCount) continue;
            const sampleLatitude = grid.latitude_max - row * grid.latitude_step;
            for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
              const column = ((x0 + columnOffset) % longitudeCount + longitudeCount) % longitudeCount;
              const sampleLongitude = grid.longitude_min + column * grid.longitude_step;
              if (!maskAware(latitude, longitude, sampleLatitude, sampleLongitude)) continue;
              const tileColumn = Math.floor(column / metadata.tile_size);
              const tileRow = Math.floor(row / metadata.tile_size);
              const entry = activeTiles.get(tileRow * activeTileColumns + tileColumn);
              if (!entry) continue;
              const offset = ((row % metadata.tile_size) * entry.tile.width + (column % metadata.tile_size)) * 2;
              const storedU = entry.tile.samples[offset];
              const storedV = entry.tile.samples[offset + 1];
              if (storedU === entry.tile.missingValue || storedV === entry.tile.missingValue) continue;
              const longitudeDistance = (((sampleLongitude - longitude + 540) % 360) - 180) *
                Math.cos(latitude * Math.PI / 180);
              const distance = Math.hypot(sampleLatitude - latitude, longitudeDistance);
              if (!nearest || distance < nearest.distance) nearest = {
                u: storedU * entry.tile.scale,
                v: storedV * entry.tile.scale,
                distance
              };
            }
          }
          if (!nearest) return false;
          u = nearest.u;
          v = nearest.v;
        }
      }
      output[0] = u;
      output[1] = v;
      return true;
    }

    function inspectAt(latlng) {
      if (!enabled || !activeTiles.size || !latlng) return false;
      const result = findNearest(latlng);
      if (!result) return false;
      onInspect({ ...result, month, depth, latlng, metadata });
      return true;
    }

    return Object.freeze({
      activate,
      deactivate,
      selectSlice,
      inspectAt,
      findNearest,
      sample,
      destroy() { deactivate(); tileCache.clear(); pendingTiles.clear(); },
      sampleVelocity,
      get state() { return { enabled, month, depth, cachedTiles: tileCache.size, pendingTiles: pendingTiles.size,
        loadedTiles: activeTiles.size, lastBatch: { ...lastBatchMetrics } }; }
    });
  }

  return Object.freeze({ createCurrentView, visibleTileAddresses, viewportTileAddresses, tierForZoom, MONTHS });
});
