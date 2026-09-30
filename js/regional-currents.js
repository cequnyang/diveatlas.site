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

  function createCurrentView({ L, map, metadataUrl = 'data/currents/metadata.json', onStatus = () => {}, onInspect = () => {} }) {
    let metadata = null;
    let metadataPromise = null;
    let enabled = false;
    let month = 9;
    let depth = '20';
    let generation = 0;
    let refreshFrame = 0;
    const tileCache = new cacheApi.LruTileCache(96);
    const pendingTiles = new Map();
    const activeTiles = new Map();
    let activeTileColumns = 0;

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
      metadataPromise ||= fetch(metadataUrl).then(response => {
        if (!response.ok) throw new Error(`Current metadata returned HTTP ${response.status}`);
        return response.json();
      }).then(validateMetadata).catch(error => {
        metadataPromise = null;
        throw error;
      });
      return metadataPromise;
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
      if (cached) return { key, tile: cached, address, tier, requestGeneration };
      if (pendingTiles.has(key)) return pendingTiles.get(key);
      const task = (async () => {
        const response = await fetch(tileUrl(tier, address));
        if (!response.ok) throw new Error(`Current tile returned HTTP ${response.status}`);
        const compressed = await response.arrayBuffer();
        const buffer = await gunzip(compressed);
        const tile = cacheApi.decodeTile(buffer, {
          tileSize: metadata.tile_size, step: tier.step, column: address.column, row: address.row
        });
        tileCache.set(key, tile);
        return { key, tile, address, tier, requestGeneration };
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
      onStatus({ state: errors ? (results.length ? 'partial' : 'unavailable') : 'ready', loaded: results.length, errors });
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
    function sampleVelocity(latitude, longitude, output) {
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
        if (storedU === entry.tile.missingValue || storedV === entry.tile.missingValue) return false;
        u += storedU * entry.tile.scale * weight;
        v += storedV * entry.tile.scale * weight;
      }
      output[0] = u;
      output[1] = v;
      return true;
    }

    function handleClick(event) {
      if (!enabled || !activeTiles.size || !event.latlng) return;
      if (event.originalEvent?.target?.closest?.('.leaflet-marker-icon, .leaflet-interactive, .leaflet-popup, .leaflet-control')) return;
      const result = findNearest(event.latlng);
      if (result) {
        // The shared map-click controller runs after this handler and may see
        // an unrelated overlay beneath the same current sample. Keep that
        // second pass from replacing the popup opened for this inspection.
        event._diveAtlasPopupHandled = true;
        onInspect({ ...result, month, depth, latlng: event.latlng, metadata });
      }
    }

    map.on('click', handleClick);

    return Object.freeze({
      activate,
      deactivate,
      selectSlice,
      findNearest,
      destroy() { deactivate(); map.off('click', handleClick); tileCache.clear(); pendingTiles.clear(); },
      sampleVelocity,
      get state() { return { enabled, month, depth, cachedTiles: tileCache.size, pendingTiles: pendingTiles.size,
        loadedTiles: activeTiles.size }; }
    });
  }

  return Object.freeze({ createCurrentView, visibleTileAddresses, viewportTileAddresses, tierForZoom, MONTHS });
});
