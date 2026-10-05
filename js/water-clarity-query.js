(function attachWaterClarityQuery(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasWaterClarityQuery = api;
})(typeof window === 'undefined' ? globalThis : window, function buildWaterClarityQueryApi() {
  const CLASSIFICATIONS = Object.freeze([
    { maximum: 5, label: 'Very low clarity' },
    { maximum: 10, label: 'Low clarity' },
    { maximum: 20, label: 'Moderate clarity' },
    { maximum: 30, label: 'High clarity' },
    { maximum: Infinity, label: 'Very high clarity' }
  ]);

  function classify(valueM) {
    if (!Number.isFinite(valueM) || valueM < 0) return null;
    return CLASSIFICATIONS.find(item => valueM < item.maximum)?.label || CLASSIFICATIONS.at(-1).label;
  }

  function createWaterClarityQuery({
    metadataUrl = 'data/water_clarity/metadata.json',
    fetchImpl = fetch,
    maxChunks = 4
  } = {}) {
    let metadataPromise = null;
    const chunks = new Map();
    const inflight = new Map();

    async function getMetadata() {
      if (!metadataPromise) {
        metadataPromise = fetchImpl(metadataUrl).then(response => {
          if (!response.ok) throw new Error(`Water Clarity metadata returned HTTP ${response.status}`);
          return response.json();
        }).then(metadata => {
          const grid = metadata?.grid;
          const encoding = metadata?.value_encoding;
          if (metadata?.format !== 'diveatlas-water-clarity' || metadata.format_version !== 1 ||
              !Array.isArray(metadata.available_months) || !Array.isArray(metadata.query?.chunks) ||
              !grid || !encoding || Number(encoding.missing_sentinel) !== 255 ||
              !Number.isFinite(Number(encoding.scale_m)) || Number(encoding.scale_m) <= 0 ||
              !Number.isFinite(Number(grid.latitude_count)) || !Number.isFinite(Number(grid.longitude_count)) ||
              !Number.isFinite(Number(grid.latitude_step_degrees)) || !Number.isFinite(Number(grid.longitude_step_degrees))) {
            throw new Error('Water Clarity metadata is missing required grid or encoding fields');
          }
          return metadata;
        }).catch(error => {
          metadataPromise = null;
          throw error;
        });
      }
      return metadataPromise;
    }

    async function loadChunk(metadata, descriptor) {
      const key = `${descriptor.row}:${descriptor.column}`;
      if (chunks.has(key)) {
        const value = chunks.get(key);
        chunks.delete(key);
        chunks.set(key, value);
        return value;
      }
      if (inflight.has(key)) return inflight.get(key);
      const pending = (async () => {
        const url = `data/water_clarity/query/chunks/${descriptor.file}?v=${encodeURIComponent(metadata.generated_at_utc || 'dataset')}`;
        const response = await fetchImpl(url);
        if (!response.ok) throw new Error(`Water Clarity chunk returned HTTP ${response.status}`);
        const compressed = await response.arrayBuffer();
        if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot decode compressed Water Clarity data');
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
        const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
        const expected = 12 * Number(descriptor.rows) * Number(descriptor.columns);
        if (bytes.byteLength !== expected) throw new Error('Water Clarity chunk has an invalid length');
        chunks.set(key, bytes);
        while (chunks.size > Math.max(1, maxChunks)) chunks.delete(chunks.keys().next().value);
        return bytes;
      })();
      inflight.set(key, pending);
      try { return await pending; }
      finally { inflight.delete(key); }
    }

    async function query(latlng, { month, maxDistanceKm = null } = {}) {
      const metadata = await getMetadata();
      const monthNumber = Number(month);
      if (!metadata.available_months.includes(monthNumber)) return { unavailable: true, metadata };
      const latitude = Number(latlng?.lat);
      const rawLongitude = Number(latlng?.lng);
      if (!Number.isFinite(latitude) || !Number.isFinite(rawLongitude)) throw new Error('Invalid Water Clarity location');
      const grid = metadata.grid;
      const longitude = ((rawLongitude + 180) % 360 + 360) % 360 - 180;
      const coreRows = Math.max(1, Math.round(Number(metadata.query.chunk_degrees) / Number(grid.latitude_step_degrees)));
      const coreColumns = Math.max(1, Math.round(Number(metadata.query.chunk_degrees) / Number(grid.longitude_step_degrees)));
      const monthIndex = monthNumber - 1;
      const latitudeStep = Number(grid.latitude_step_degrees);
      const longitudeStep = Number(grid.longitude_step_degrees);
      const latitudeIndex = Math.round((latitude - Number(grid.latitude_first_center)) / latitudeStep);
      const longitudeIndex = Math.round((longitude - Number(grid.longitude_first_center)) / longitudeStep);
      if (latitudeIndex < 0 || latitudeIndex >= Number(grid.latitude_count)) return { unavailable: true, metadata };

      const candidates = [];
      const rowRadius = maxDistanceKm == null ? 0 : Math.ceil(maxDistanceKm / (110.574 * latitudeStep));
      const longitudeKmPerDegree = Math.max(11.1, 111.32 * Math.cos(latitude * Math.PI / 180));
      const columnRadius = maxDistanceKm == null ? 0 : Math.ceil(maxDistanceKm / (longitudeKmPerDegree * longitudeStep));
      for (let rowOffset = -rowRadius; rowOffset <= rowRadius; rowOffset += 1) {
        const row = latitudeIndex + rowOffset;
        if (row < 0 || row >= Number(grid.latitude_count)) continue;
        const sourceLatitude = Number(grid.latitude_first_center) + row * latitudeStep;
        for (let columnOffset = -columnRadius; columnOffset <= columnRadius; columnOffset += 1) {
          const column = ((longitudeIndex + columnOffset) % Number(grid.longitude_count) + Number(grid.longitude_count)) % Number(grid.longitude_count);
          const sourceLongitude = Number(grid.longitude_first_center) + column * longitudeStep;
          const dLat = (sourceLatitude - latitude) * Math.PI / 180;
          const dLon = ((sourceLongitude - longitude + 540) % 360 - 180) * Math.PI / 180;
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(latitude * Math.PI / 180) * Math.cos(sourceLatitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
          const distanceKm = 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          if (maxDistanceKm == null || distanceKm <= maxDistanceKm) {
            candidates.push({ row, column, sourceLatitude, sourceLongitude, distanceKm });
          }
        }
      }
      candidates.sort((a, b) => a.distanceKm - b.distanceKm);

      for (const candidate of candidates) {
        const rowChunk = Math.floor(candidate.row / coreRows);
        const columnChunk = Math.floor(candidate.column / coreColumns);
        const descriptor = metadata.query.chunks.find(chunk => Number(chunk.row) === rowChunk && Number(chunk.column) === columnChunk);
        if (!descriptor) continue;
        const values = await loadChunk(metadata, descriptor);
        const localRow = candidate.row - Number(descriptor.row_start);
        const localColumn = candidate.column - Number(descriptor.column_start);
        const offset = (monthIndex * Number(descriptor.rows) + localRow) * Number(descriptor.columns) + localColumn;
        const stored = values[offset];
        if (stored === Number(metadata.value_encoding.missing_sentinel)) continue;
        const valueM = stored * Number(metadata.value_encoding.scale_m);
        return { value_m: valueM, classification: classify(valueM), month: monthNumber, metadata,
          source_latitude: candidate.sourceLatitude, source_longitude: candidate.sourceLongitude, sample_distance_km: candidate.distanceKm };
      }
      return { unavailable: true, metadata };
    }

    return Object.freeze({ query, get cachedChunkCount() { return chunks.size; } });
  }

  return { CLASSIFICATIONS, classify, createWaterClarityQuery };
});
