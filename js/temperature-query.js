(function attachTemperatureQuery(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasTemperatureQuery = api;
})(typeof window === 'undefined' ? globalThis : window, function buildTemperatureQueryApi() {
  function createTemperatureQuery({ metadataUrl = 'data/temperature/query/metadata.json', fetchImpl = fetch, maxChunks = 4 } = {}) {
    let metadataPromise = null;
    const chunks = new Map();
    const inflightChunks = new Map();

    async function loadMetadata(signal) {
      if (!metadataPromise) {
        metadataPromise = fetchImpl(metadataUrl, { signal }).then(response => {
          if (!response.ok) throw new Error(`Temperature query metadata returned HTTP ${response.status}`);
          return response.json();
        }).then(metadata => {
          if (metadata?.format !== 'diveatlas-temperature-query' || metadata.format_version !== 1 ||
              !Array.isArray(metadata.available_months) || !Array.isArray(metadata.available_depths_m) ||
              !metadata.chunk_grid || !metadata.grid || !metadata.value_encoding) {
            throw new Error('Temperature query metadata is missing required fields');
          }
          const numericFields = [metadata.source_resolution_degrees, metadata.grid.latitude_count,
            metadata.grid.longitude_count, metadata.grid.latitude_first_center,
            metadata.grid.longitude_first_center, metadata.grid.latitude_step_degrees,
            metadata.grid.longitude_step_degrees, metadata.chunk_degrees, metadata.chunk_halo_cells,
            metadata.value_encoding.scale_c, metadata.value_encoding.missing_sentinel];
          if (!numericFields.every(value => Number.isFinite(Number(value))) ||
              Number(metadata.grid.latitude_count) < 1 || Number(metadata.grid.longitude_count) < 1 ||
              Number(metadata.grid.latitude_step_degrees) <= 0 || Number(metadata.grid.longitude_step_degrees) <= 0 ||
              Number(metadata.chunk_degrees) <= 0 || Number(metadata.value_encoding.scale_c) <= 0 ||
              !metadata.available_months.length || !metadata.available_depths_m.length) {
            throw new Error('Temperature query metadata has invalid grid or value properties');
          }
          return metadata;
        }).catch(error => {
          metadataPromise = null;
          throw error;
        });
      }
      return metadataPromise;
    }

    async function loadChunk(metadata, descriptor, signal) {
      if (chunks.has(descriptor.key)) {
        const cached = chunks.get(descriptor.key);
        chunks.delete(descriptor.key);
        chunks.set(descriptor.key, cached);
        return cached;
      }
      if (inflightChunks.has(descriptor.key)) return inflightChunks.get(descriptor.key);
      const pending = (async () => {
      const response = await fetchImpl(`data/temperature/query/chunks/${descriptor.file}?v=${encodeURIComponent(metadata.generation_version)}`, { signal });
      if (!response.ok) throw new Error(`Temperature query chunk returned HTTP ${response.status}`);
      const compressed = await response.arrayBuffer();
      if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot decode compressed temperature query data');
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
      const bytes = await new Response(stream).arrayBuffer();
      const expectedValues = metadata.available_months.length * metadata.available_depths_m.length * descriptor.rows * descriptor.columns;
      if (bytes.byteLength !== expectedValues * 2) throw new Error('Temperature query chunk has an invalid length');
      const view = new DataView(bytes);
      const values = new Int16Array(expectedValues);
      for (let i = 0; i < expectedValues; i += 1) values[i] = view.getInt16(i * 2, true);
      const chunk = { values, descriptor };
      chunks.set(descriptor.key, chunk);
      while (chunks.size > Math.max(1, maxChunks)) chunks.delete(chunks.keys().next().value);
      return chunk;
      })();
      inflightChunks.set(descriptor.key, pending);
      try { return await pending; }
      finally { inflightChunks.delete(descriptor.key); }
    }

    function indexFor(value, first, step, count, wrap = false) {
      const index = Math.round((value - first) / step);
      return wrap ? ((index % count) + count) % count : index;
    }

    async function query(latlng, { month, depth, signal } = {}) {
      const metadata = await loadMetadata(signal);
      const grid = metadata.grid;
      const encoding = metadata.value_encoding;
      const resolution = Number(grid.latitude_step_degrees);
      const latStep = Number(grid.latitude_step_degrees);
      const lonStep = Number(grid.longitude_step_degrees);
      const lat = Number(latlng?.lat);
      const rawLng = Number(latlng?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(rawLng) || !Number.isFinite(resolution) || resolution <= 0) {
        throw new Error('Invalid temperature query location');
      }
      const longitude = grid.longitude_convention === '-180_to_180'
        ? ((rawLng + 180) % 360 + 360) % 360 - 180
        : ((rawLng % 360) + 360) % 360;
      const latitudeDirection = grid.latitude_order === 'south_to_north' ? 1 : -1;
      const latitudeIndex = indexFor(lat, Number(grid.latitude_first_center), latitudeDirection * latStep, grid.latitude_count);
      const longitudeIndex = indexFor(longitude, Number(grid.longitude_first_center), lonStep, grid.longitude_count, true);
      if (latitudeIndex < 0 || latitudeIndex >= grid.latitude_count) return { unavailable: true, metadata };

      const coreRows = Math.max(1, Math.round(Number(metadata.chunk_degrees) / latStep));
      const coreColumns = Math.max(1, Math.round(Number(metadata.chunk_degrees) / lonStep));
      const rowChunk = Math.floor(latitudeIndex / coreRows);
      const columnChunk = Math.floor(longitudeIndex / coreColumns);
      if (rowChunk < 0 || rowChunk >= metadata.chunk_grid.rows || columnChunk < 0 || columnChunk >= metadata.chunk_grid.columns) {
        return { unavailable: true, metadata };
      }
      const rowStart = rowChunk * coreRows;
      const columnStart = columnChunk * coreColumns;
      const dataRowStart = Math.max(0, rowStart - Number(metadata.chunk_halo_cells));
      const dataColumnStart = ((columnStart - Number(metadata.chunk_halo_cells)) % grid.longitude_count + grid.longitude_count) % grid.longitude_count;
      const rowEnd = Math.min(grid.latitude_count, rowStart + coreRows);
      const columnEnd = Math.min(grid.longitude_count, columnStart + coreColumns);
      const chunkHalo = Number(metadata.chunk_halo_cells);
      const descriptor = {
        key: `${rowChunk}:${columnChunk}`,
        file: `r${String(rowChunk).padStart(2, '0')}_c${String(columnChunk).padStart(2, '0')}.i16.gz`,
        data_row_start: dataRowStart,
        data_column_start: dataColumnStart,
        rows: Math.min(grid.latitude_count, rowEnd + Number(metadata.chunk_halo_cells)) - dataRowStart,
        columns: Math.min(grid.longitude_count, columnEnd - columnStart + chunkHalo * 2)
      };
      const { values, descriptor: chunk } = await loadChunk(metadata, descriptor, signal);

      const maxDistanceDegrees = 0.75 * Math.SQRT2 * Math.max(latStep, lonStep);
      let best = null;
      for (let dr = -1; dr <= 1; dr += 1) {
        const row = latitudeIndex + dr;
        if (row < 0 || row >= grid.latitude_count) continue;
        const localRow = row - chunk.data_row_start;
        if (localRow < 0 || localRow >= chunk.rows) continue;
          const candidateLat = Number(grid.latitude_first_center) + row * latitudeDirection * latStep;
        for (let dc = -1; dc <= 1; dc += 1) {
          const column = (longitudeIndex + dc + grid.longitude_count) % grid.longitude_count;
          const localColumn = (column - chunk.data_column_start + grid.longitude_count) % grid.longitude_count;
          if (localColumn < 0 || localColumn >= chunk.columns) continue;
          const dLat = lat - candidateLat;
          let dLon = longitude - (Number(grid.longitude_first_center) + column * lonStep);
          dLon = ((dLon + 540) % 360) - 180;
          const distance = Math.hypot(dLat, dLon * Math.cos(lat * Math.PI / 180));
          // Equal-distance ties retain the first scan candidate so a click on
          // a source-cell boundary remains deterministic across browsers.
          if (distance > maxDistanceDegrees || (best && distance >= best.distance)) continue;
          best = { distance, row, column, localRow, localColumn };
        }
      }
      if (!best) return { unavailable: true, metadata };

      const monthIndex = metadata.available_months.indexOf(Number(month));
      const depthIndex = metadata.available_depths_m.findIndex(value => Number(value) === Number(depth));
      const sentinel = Number(encoding.missing_sentinel);
      const scale = Number(encoding.scale_c);
      const read = (mIndex, dIndex) => {
        if (mIndex < 0 || dIndex < 0) return null;
        const offset = (((mIndex * metadata.available_depths_m.length + dIndex) * chunk.rows + best.localRow) * chunk.columns) + best.localColumn;
        const stored = values[offset];
        if (stored === sentinel) return null;
        const decoded = stored * scale;
        return Number.isFinite(decoded) ? decoded : null;
      };
      const current = read(monthIndex, depthIndex);
      if (current == null) return { unavailable: true, metadata };
      const profile = metadata.available_depths_m.map((depthM, index) => ({
        depth_m: Number(depthM), value_c: read(monthIndex, index)
      })).filter(point => point.value_c != null);
      const year = metadata.available_months.map((monthNumber, index) => ({
        month: Number(monthNumber), value_c: read(index, depthIndex)
      })).filter(point => point.value_c != null);
      return { value_c: current, month: Number(month), depth_m: Number(depth), profile, year, metadata };
    }

    return Object.freeze({ query, get cachedChunkCount() { return chunks.size; } });
  }

  return { createTemperatureQuery };
});
