(function attachTemperatureQuery(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasTemperatureQuery = api;
})(typeof window === 'undefined' ? globalThis : window, function buildTemperatureQueryApi() {
  function createTemperatureQuery({ metadataUrl = null, fetchImpl = fetch, maxChunks = 32, maxLegacyChunks = 4 } = {}) {
    let metadataPromise = null;
    const chunks = new Map();
    const inflightChunks = new Map();

    async function loadMetadata(signal) {
      if (!metadataPromise) {
        const fetchMetadata = async () => {
          if (metadataUrl) return fetchImpl(metadataUrl, { signal });
          const sliced = await fetchImpl('data/temperature/query/v2/metadata.json', { signal });
          if (sliced.status !== 404) return sliced;
          return fetchImpl('data/temperature/query/metadata.json', { signal });
        };
        metadataPromise = fetchMetadata().then(response => {
          if (!response.ok) throw new Error(`Temperature query metadata returned HTTP ${response.status}`);
          return response.json();
        }).then(metadata => {
          if (metadata?.format !== 'diveatlas-temperature-query' || ![1, 2].includes(metadata.format_version) ||
              !Array.isArray(metadata.available_months) || !Array.isArray(metadata.available_depths_m) ||
              !metadata.chunk_grid || !metadata.grid || !metadata.value_encoding) {
            throw new Error('Temperature query metadata is missing required fields');
          }
          if (metadata.format_version >= 2 && typeof metadata.chunk_file_template !== 'string') {
            throw new Error('Temperature query metadata is missing the sliced chunk template');
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

    async function loadChunk(metadata, descriptor, signal, month, depth) {
      const isSliced = metadata.format_version >= 2;
      const cacheKey = isSliced ? `${descriptor.key}:${month}:${depth}` : descriptor.key;
      if (chunks.has(cacheKey)) {
        const cached = chunks.get(cacheKey);
        chunks.delete(cacheKey);
        chunks.set(cacheKey, cached);
        return cached;
      }
      if (inflightChunks.has(cacheKey)) return inflightChunks.get(cacheKey);
      const pending = (async () => {
      const template = isSliced
        ? metadata.chunk_file_template
        : `chunks/${descriptor.file}`;
      const relativePath = template
        .replaceAll('{month}', String(month).padStart(2, '0'))
        .replaceAll('{depth}', String(Number(depth)).padStart(2, '0'))
        .replaceAll('{row}', String(descriptor.rowChunk).padStart(2, '0'))
        .replaceAll('{column}', String(descriptor.columnChunk).padStart(2, '0'));
      const queryRoot = isSliced ? 'data/temperature/query/v2/' : 'data/temperature/query/';
      const response = await fetchImpl(`${queryRoot}${relativePath}?v=${encodeURIComponent(metadata.generation_version)}`, { signal });
      if (!response.ok) throw new Error(`Temperature query chunk returned HTTP ${response.status}`);
      const compressed = await response.arrayBuffer();
      if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot decode compressed temperature query data');
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
      const bytes = await new Response(stream).arrayBuffer();
      const expectedValues = (isSliced ? 1 : metadata.available_months.length * metadata.available_depths_m.length) * descriptor.rows * descriptor.columns;
      if (bytes.byteLength !== expectedValues * 2) throw new Error('Temperature query chunk has an invalid length');
      const view = new DataView(bytes);
      const values = new Int16Array(expectedValues);
      for (let i = 0; i < expectedValues; i += 1) values[i] = view.getInt16(i * 2, true);
      const chunk = { values, descriptor, isSliced };
      chunks.set(cacheKey, chunk);
      // V1 spatial chunks contain the whole year and profile; retain their old
      // small bound while v2 can cheaply cache every opened month/depth slice.
      const cacheLimit = isSliced ? maxChunks : maxLegacyChunks;
      while (chunks.size > Math.max(1, cacheLimit)) chunks.delete(chunks.keys().next().value);
      return chunk;
      })();
      inflightChunks.set(cacheKey, pending);
      try { return await pending; }
      finally { inflightChunks.delete(cacheKey); }
    }

    function indexFor(value, first, step, count, wrap = false) {
      const index = Math.round((value - first) / step);
      return wrap ? ((index % count) + count) % count : index;
    }

    async function query(latlng, { month, depth, signal, maxDistanceKm = 25, includeProfile = true, includeYear = true } = {}) {
      const metadata = await loadMetadata(signal);
      const grid = metadata.grid;
      const encoding = metadata.value_encoding;
      const monthIndex = metadata.available_months.indexOf(Number(month));
      const depthIndex = metadata.available_depths_m.findIndex(value => Number(value) === Number(depth));
      if (monthIndex < 0 || depthIndex < 0) return { unavailable:true, metadata };
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
        rowChunk,
        columnChunk,
        file: `r${String(rowChunk).padStart(2, '0')}_c${String(columnChunk).padStart(2, '0')}.i16.gz`,
        data_row_start: dataRowStart,
        data_column_start: dataColumnStart,
        rows: Math.min(grid.latitude_count, rowEnd + Number(metadata.chunk_halo_cells)) - dataRowStart,
        columns: Math.min(grid.longitude_count, columnEnd - columnStart + chunkHalo * 2)
      };
      const { values, descriptor: chunk } = await loadChunk(metadata, descriptor, signal, month, depth);

      const sentinel = Number(encoding.missing_sentinel);
      const scale = Number(encoding.scale_c);
      const loadedChunkKey = (row, column, mIndex, dIndex) => metadata.format_version >= 2
        ? `${row}:${column}:${mIndex}:${dIndex}`
        : `${row}:${column}`;
      const loadedChunks = new Map([[loadedChunkKey(rowChunk, columnChunk, monthIndex, depthIndex),
        Promise.resolve({ values, descriptor, isSliced:metadata.format_version >= 2 })]]);
      async function readCandidate(row, column, mIndex, dIndex) {
        const rowChunk = Math.floor(row / coreRows);
        const columnChunk = Math.floor(column / coreColumns);
        const key = loadedChunkKey(rowChunk, columnChunk, mIndex, dIndex);
        if (!loadedChunks.has(key)) {
          const chunkRowStart = rowChunk * coreRows;
          const chunkColumnStart = columnChunk * coreColumns;
          const chunkRowEnd = Math.min(grid.latitude_count, chunkRowStart + coreRows);
          const chunkColumnEnd = Math.min(grid.longitude_count, chunkColumnStart + coreColumns);
          const chunkDataRowStart = Math.max(0, chunkRowStart - chunkHalo);
          const chunkDescriptor = {
            key, rowChunk, columnChunk,
            file:`r${String(rowChunk).padStart(2, '0')}_c${String(columnChunk).padStart(2, '0')}.i16.gz`,
            data_row_start:chunkDataRowStart,
            data_column_start:((chunkColumnStart - chunkHalo) % grid.longitude_count + grid.longitude_count) % grid.longitude_count,
            rows:Math.min(grid.latitude_count, chunkRowEnd + chunkHalo) - chunkDataRowStart,
            columns:Math.min(grid.longitude_count, chunkColumnEnd - chunkColumnStart + chunkHalo * 2)
          };
          loadedChunks.set(key, loadChunk(metadata, chunkDescriptor, signal,
            metadata.available_months[mIndex], metadata.available_depths_m[dIndex]));
        }
        const loaded = await loadedChunks.get(key);
        const localRow = row - loaded.descriptor.data_row_start;
        const localColumn = (column - loaded.descriptor.data_column_start + grid.longitude_count) % grid.longitude_count;
        if (localRow < 0 || localRow >= loaded.descriptor.rows || localColumn >= loaded.descriptor.columns) return null;
        const offset = loaded.isSliced
          ? localRow * loaded.descriptor.columns + localColumn
          : (((mIndex * metadata.available_depths_m.length + dIndex) * loaded.descriptor.rows + localRow) * loaded.descriptor.columns) + localColumn;
        const stored = loaded.values[offset];
        return stored === sentinel ? null : stored * scale;
      }
      async function findNearestValid(maxDistanceKm) {
        const rowRadius = Math.ceil(maxDistanceKm / (110.5 * latStep));
        const columnRadius = Math.ceil(maxDistanceKm / (111.32 * Math.max(0.05, Math.cos(lat * Math.PI / 180)) * lonStep));
        const candidates = [];
        for (let dr = -rowRadius; dr <= rowRadius; dr += 1) {
          const row = latitudeIndex + dr;
          if (row < 0 || row >= grid.latitude_count) continue;
          const candidateLat = Number(grid.latitude_first_center) + row * latitudeDirection * latStep;
          for (let dc = -columnRadius; dc <= columnRadius; dc += 1) {
            const column = (longitudeIndex + dc + grid.longitude_count) % grid.longitude_count;
            const candidateLongitude = Number(grid.longitude_first_center) + column * lonStep;
            const dLat = (candidateLat - lat) * Math.PI / 180;
            const dLon = ((candidateLongitude - longitude + 540) % 360 - 180) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * Math.PI / 180) *
              Math.cos(candidateLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
            const distance = 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            if (distance > maxDistanceKm) continue;
            candidates.push({ distance, row, column, latitude:candidateLat, longitude:candidateLongitude });
          }
        }
        candidates.sort((a, b) => a.distance - b.distance);
        for (const candidate of candidates) {
            const value = await readCandidate(candidate.row, candidate.column, monthIndex, depthIndex);
            if (value == null) continue;
            return { ...candidate, value_c:value };
        }
        return null;
      }
      if (monthIndex < 0 || depthIndex < 0) return { unavailable:true, metadata };
      const best = await findNearestValid(maxDistanceKm);
      if (!best) return { unavailable:true, metadata };
      const current = best.value_c;
      const detailValue = async (sampleMonth, sampleDepth) => {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const value = await readCandidate(best.row, best.column, sampleMonth, sampleDepth);
        return value == null ? null : value;
      };
      const [profile, year] = await Promise.all([
        includeProfile
          ? Promise.all(metadata.available_depths_m.map(async (depthM, index) => ({
              depth_m: Number(depthM), value_c: await detailValue(monthIndex, index)
            }))).then(points => points.filter(point => point.value_c != null))
          : Promise.resolve([]),
        includeYear
          ? Promise.all(metadata.available_months.map(async (monthNumber, index) => ({
              month: Number(monthNumber), value_c: await detailValue(index, depthIndex)
            }))).then(points => points.filter(point => point.value_c != null))
          : Promise.resolve([])
      ]);
      return { value_c: current, month: Number(month), depth_m: Number(depth), profile, year,
        profile_loaded: Boolean(includeProfile), year_loaded: Boolean(includeYear), metadata,
        source_latitude:best.latitude, source_longitude:best.longitude, sample_distance_km:best.distance,
        nearby_estimate:best.distance > 0 };
    }

    return Object.freeze({ query, get cachedChunkCount() { return chunks.size; } });
  }

  return { createTemperatureQuery };
});
