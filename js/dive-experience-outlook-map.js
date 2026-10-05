(function attachDiveExperienceOutlookMap(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasDiveExperienceMap = api;
})(typeof window === 'undefined' ? globalThis : window, function buildDiveExperienceOutlookMap(root) {
  const CELL_COUNT = 720 * 340;
  const MONTH_BYTES_PER_CELL = 10;
  const SUPPORT_BYTES_PER_CELL = 20;
  const MONTH_MAGIC = 'DAEO';
  const MASK_MAGIC = 'DAOM';
  const SUPPORT_MAGIC = 'DAES';
  const VIRIDIS = Object.freeze([
    Object.freeze({ at:0, rgb:Object.freeze([253,231,37]) }),
    Object.freeze({ at:0.25, rgb:Object.freeze([94,201,98]) }),
    Object.freeze({ at:0.5, rgb:Object.freeze([33,145,140]) }),
    Object.freeze({ at:0.75, rgb:Object.freeze([59,82,139]) }),
    Object.freeze({ at:1, rgb:Object.freeze([68,1,84]) })
  ]);
  const FISH_TIERS = Object.freeze({ 0:null, 1:'A', 2:'B', 3:'C' });
  const FISH_CATEGORIES = Object.freeze({ 0:null, 1:'Very low', 2:'Low', 3:'Lower typical', 4:'Typical', 5:'Upper typical', 6:'High', 7:'Very high' });
  const EVIDENCE_LEVELS = Object.freeze({ 0:'none', 1:'high', 2:'moderate', 3:'limited' });
  let renderedTileCount = 0;
  let renderedTileMsTotal = 0;
  let renderedTileMsMax = 0;
  // 64 RGBA tiles retain two typical 28-tile viewports (16 MiB at 256²×4)
  // without allowing visits across all months and zooms to grow memory unbounded.
  const TILE_RASTER_CACHE_LIMIT = 64;
  const tileRasterCache = new Map();
  let tileRasterCacheHits = 0;
  let tileRasterCacheMisses = 0;
  let tileRasterCacheEvictions = 0;

  function monotonicNow() {
    return typeof root.performance?.now === 'function' ? root.performance.now() : Date.now();
  }

  function dataView(buffer) {
    return new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, buffer.byteOffset || 0, buffer.byteLength);
  }

  function verifyHeader(buffer, { magic, version, grid, bytesPerCell }) {
    const view = dataView(buffer);
    const expectedLength = 16 + Number(grid.width) * Number(grid.height) * bytesPerCell;
    if (view.byteLength !== expectedLength) throw new TypeError(`${magic} grid asset does not match the versioned manifest.`);
    const actualMagic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (actualMagic !== magic ||
        view.getUint8(4) !== version || view.getUint16(6, true) !== Number(grid.width) ||
        view.getUint16(8, true) !== Number(grid.height) || view.getUint16(10, true) !== Math.round(Number(grid.step) * 100) ||
        view.getInt16(12, true) !== Math.round(Number(grid.west) * 10) ||
        view.getInt16(14, true) !== Math.round(Number(grid.south) * 10)) {
      throw new TypeError(`${magic} grid asset does not match the versioned manifest.`);
    }
    return view;
  }

  function validateManifest(manifest) {
    if (!manifest || manifest.format !== 'diveatlas-dive-experience-outlook' || manifest.schemaVersion !== 1 ||
        typeof manifest.scoringVersion !== 'string' || typeof manifest.thresholdVersion !== 'string' ||
        typeof manifest.dataVersion !== 'string' || !manifest.grid || manifest.grid.step !== 0.5 ||
        manifest.grid.width !== 720 || manifest.grid.height !== 340 || manifest.grid.west !== -180 || manifest.grid.south !== -85 ||
        manifest.oceanMask?.file !== 'ocean-mask.bin.gz' || manifest.oceanMask.samplesPerAxis !== 8 ||
        manifest.encoding?.month?.magic !== MONTH_MAGIC || manifest.encoding.month.version !== 3 ||
        manifest.encoding.month.bytesPerCell !== MONTH_BYTES_PER_CELL || manifest.encoding?.staticSupport?.magic !== SUPPORT_MAGIC ||
        manifest.encoding.staticSupport.version !== 1 || manifest.encoding.staticSupport.bytesPerCell !== SUPPORT_BYTES_PER_CELL ||
        manifest.months?.length !== 12 || manifest.months.some((entry, index) => entry.month !== index + 1 ||
          entry.asset !== `month-${String(index + 1).padStart(2, '0')}.bin.gz`)) {
      throw new TypeError('Dive Experience Outlook manifest has an unsupported format or incomplete month list.');
    }
    return manifest;
  }

  function decodeMonth(buffer, manifest, month) {
    const grid = manifest.grid;
    const view = verifyHeader(buffer, { magic:MONTH_MAGIC, version:3, grid, bytesPerCell:MONTH_BYTES_PER_CELL });
    if (view.getUint8(5) !== month) throw new TypeError(`Dive Experience grid month does not match ${month}.`);
    const count = grid.width * grid.height;
    return Object.freeze({
      month, buffer, view, count,
      scoreOffset:16,
      diveConditionsOffset:16 + count,
      overallConfidenceOffset:16 + count * 2,
      physicalConfidenceOffset:16 + count * 3,
      ecologicalConfidenceOffset:16 + count * 4,
      completenessOffset:16 + count * 5,
      physicalCompletenessOffset:16 + count * 6,
      ecologicalCompletenessOffset:16 + count * 7,
      dimensionMaskOffset:16 + count * 8
    });
  }

  function decodeStaticSupport(buffer, manifest) {
    const grid = manifest.grid;
    const view = verifyHeader(buffer, { magic:SUPPORT_MAGIC, version:1, grid, bytesPerCell:SUPPORT_BYTES_PER_CELL });
    return Object.freeze({ buffer, view, count:grid.width * grid.height, dataOffset:16 });
  }

  function decodeOceanMask(buffer, manifest) {
    const grid = manifest.grid;
    const samplesPerAxis = manifest.oceanMask.samplesPerAxis;
    const view = verifyHeader(buffer, { magic:MASK_MAGIC, version:1, grid, bytesPerCell:samplesPerAxis });
    if (view.getUint8(5) !== samplesPerAxis) throw new TypeError('Ocean mask subcell count does not match the manifest.');
    return new Uint8Array(view.buffer, view.byteOffset + 16, grid.width * grid.height * samplesPerAxis);
  }

  function interpolateViridis(score) {
    const value = Math.max(0, Math.min(1, Number(score) / 100));
    let rightIndex = VIRIDIS.findIndex(stop => stop.at >= value);
    if (rightIndex < 0) rightIndex = VIRIDIS.length - 1;
    const right = VIRIDIS[rightIndex];
    const left = VIRIDIS[Math.max(0, rightIndex - 1)];
    const position = right.at === left.at ? 0 : (value - left.at) / (right.at - left.at);
    return left.rgb.map((channel, index) => Math.round(channel + (right.rgb[index] - channel) * position));
  }

  function opacityFor(evidenceQuality, completeness) {
    const evidence = Math.max(0, Math.min(1, Number(evidenceQuality) || 0));
    const available = Math.max(0, Math.min(1, Number(completeness) || 0));
    return Math.max(0, Math.min(1, (0.62 + 0.38 * evidence) * (0.90 + 0.10 * available)));
  }

  // Tile cells store score, evidence, and completeness as bytes with fixed ranges.
  // Precomputing their final paint values avoids allocating an RGB array and
  // re-evaluating the same curves for every screen pixel while preserving the
  // existing interpolation and opacity equations exactly.
  const TILE_SCORE_RGB = new Uint8Array(101 * 3);
  for (let score = 0; score <= 100; score += 1) {
    const color = interpolateViridis(score);
    const offset = score * 3;
    TILE_SCORE_RGB[offset] = color[0];
    TILE_SCORE_RGB[offset + 1] = color[1];
    TILE_SCORE_RGB[offset + 2] = color[2];
  }
  const TILE_ALPHA = new Uint8Array(256 * 101);
  for (let evidence = 0; evidence <= 255; evidence += 1) {
    for (let completeness = 0; completeness <= 100; completeness += 1) {
      TILE_ALPHA[evidence * 101 + completeness] = Math.round(opacityFor(evidence / 255, completeness / 100) * 255);
    }
  }

  function cellIndexAt(latlng, grid) {
    if (!Number.isFinite(Number(latlng?.lat)) || !Number.isFinite(Number(latlng?.lng)) ||
        Number(latlng.lat) < grid.south || Number(latlng.lat) >= grid.south + grid.height * grid.step) return null;
    const longitude = ((Number(latlng.lng) - grid.west) % 360 + 360) % 360 + grid.west;
    const row = Math.floor((Number(latlng.lat) - grid.south) / grid.step);
    const column = Math.floor((longitude - grid.west) / grid.step);
    if (row < 0 || row >= grid.height || column < 0 || column >= grid.width) return null;
    return { row, column, index:row * grid.width + column,
      subrow:Math.min(7, Math.floor(((Number(latlng.lat) - grid.south) / grid.step - row) * 8)),
      subcolumn:Math.min(7, Math.floor(((longitude - grid.west) / grid.step - column) * 8)) };
  }

  function sampleAt(latlng, monthData, supportData, oceanMask, manifest) {
    const cell = cellIndexAt(latlng, manifest.grid);
    if (!cell) return null;
    const maskOffset = (cell.index * manifest.oceanMask.samplesPerAxis) + cell.subrow;
    if (!oceanMask || !(oceanMask[maskOffset] & (1 << cell.subcolumn))) return null;
    const i = cell.index;
    const score = monthData.view.getUint8(monthData.scoreOffset + i);
    const physicalScore = monthData.view.getUint8(monthData.diveConditionsOffset + i);
    const mask = monthData.view.getUint16(monthData.dimensionMaskOffset + i * 2, true);
    const confidenceValue = monthData.view.getUint8(monthData.overallConfidenceOffset + i) / 255;
    const completeness = monthData.view.getUint8(monthData.completenessOffset + i);
    const supportOffset = supportData.dataOffset + i * SUPPORT_BYTES_PER_CELL;
    const supportView = supportData.view;
    const fishScore = supportView.getUint8(supportOffset);
    const fishTier = supportView.getUint8(supportOffset + 1);
    const fishCategory = supportView.getUint8(supportOffset + 2);
    const fishEvidence = supportView.getUint8(supportOffset + 3);
    const fishSupportStatus = supportView.getUint8(supportOffset + 4);
    const nearestDistance = supportView.getUint16(supportOffset + 5, true);
    const siteCount = supportView.getUint16(supportOffset + 7, true);
    const effectiveSupport = supportView.getUint16(supportOffset + 9, true);
    const environmentalDistance = supportView.getUint16(supportOffset + 11, true);
    const thermalScore = supportView.getUint8(supportOffset + 14);
    const validYears = supportView.getUint8(supportOffset + 15);
    const annualDhw = supportView.getUint16(supportOffset + 16, true);
    const thermalSampleDistance = supportView.getUint16(supportOffset + 18, true);
    const dimensionCount = manifest.scoring.dimensions.filter(dimension => dimension.isScoreDimension).length;
    const dimensions = manifest.scoring.dimensions.filter(dimension => dimension.isScoreDimension);
    let activeDimensions = 0;
    const activeDimensionIds = [];
    for (let bit = 0; bit < dimensionCount; bit += 1) {
      if (mask & (1 << bit)) {
        activeDimensions += 1;
        activeDimensionIds.push(dimensions[bit].id);
      }
    }
    const ecologicalDimensionIds = dimensions.filter(dimension => dimension.groupId === 'reefEcologicalExperience').map(dimension => dimension.id);
    const activeEcologicalDimensionIds = activeDimensionIds.filter(id => ecologicalDimensionIds.includes(id));
    return Object.freeze({
      cellIndex:i,
      score:score <= 100 ? score : null,
      label:score <= 100 ? scoreLabel(score, manifest.scoring.overallThresholds) : null,
      diveConditionsScore:physicalScore <= 100 ? physicalScore : null,
      diveConditionsLabel:physicalScore <= 100 ? physicalLabel(physicalScore, manifest.scoring.physicalConditionThresholds) : null,
      confidenceValue:confidenceValue,
      confidence:confidenceLabel(confidenceValue, manifest.scoring.confidenceThresholds),
      completeness,
      physicalCompleteness:monthData.view.getUint8(monthData.physicalCompletenessOffset + i),
      ecologicalCompleteness:monthData.view.getUint8(monthData.ecologicalCompletenessOffset + i),
      activeDimensionMask:mask,
      activeDimensionCount:activeDimensions,
      activeDimensionIds:Object.freeze(activeDimensionIds),
      totalScoringDimensions:dimensionCount,
      reefExperience:{ status:activeEcologicalDimensionIds.length ? 'supported' : 'unavailable',
        activeDimensionCount:activeEcologicalDimensionIds.length, totalDimensionCount:ecologicalDimensionIds.length,
        activeDimensionIds:Object.freeze(activeEcologicalDimensionIds) },
      fish:{
        score:fishScore <= 100 ? fishScore : null,
        tier:FISH_TIERS[fishTier] || null,
        category:FISH_CATEGORIES[fishCategory] || null,
        evidenceLevel:EVIDENCE_LEVELS[fishEvidence] || 'none',
        spatialSupportStatus:fishSupportStatus === 1 ? 'supported' : fishSupportStatus === 2 ? 'limited' : 'unsupported',
        nearestObservationDistanceKm:nearestDistance === 65535 ? null : nearestDistance / 10,
        supportingSiteCount:siteCount === 65535 ? null : siteCount,
        effectiveSupport:effectiveSupport === 65535 ? null : effectiveSupport / 10,
        environmentalSupportDistance:environmentalDistance === 65535 ? null : environmentalDistance / 10
      },
      thermalStress:{ score:thermalScore <= 100 ? thermalScore : null,
        validYears, meanAnnualMaximumDhw:annualDhw === 65535 ? null : annualDhw / 100,
        sampleDistanceKm:thermalSampleDistance === 65535 ? null : thermalSampleDistance / 10,
        nativeResolution:manifest.sources.thermalNativeResolution || null,
        fallbackBehavior:manifest.sources.thermalFallbackBehavior || null }
    });
  }

  function scoreLabel(score, thresholds) {
    if (!Number.isFinite(Number(score))) return null;
    const value = Number(score);
    return value >= thresholds.excellent ? 'Excellent' : value >= thresholds.good ? 'Good' : value >= thresholds.fair ? 'Fair' : 'Challenging';
  }

  function physicalLabel(score, thresholds) {
    if (!Number.isFinite(Number(score))) return null;
    const value = Number(score);
    return value >= thresholds.comfortable ? 'Comfortable' : value >= thresholds.favorable ? 'Favorable' : value >= thresholds.mixed ? 'Mixed' : 'Demanding';
  }

  function confidenceLabel(value, thresholds) {
    return value >= thresholds.high ? 'High' : value >= thresholds.moderate ? 'Moderate' : value >= thresholds.limited ? 'Limited' : 'Low';
  }

  function decompress(buffer) {
    if (typeof root.DecompressionStream === 'function' && typeof Blob === 'function' && typeof Response === 'function') {
      return new Response(new Blob([buffer]).stream().pipeThrough(new root.DecompressionStream('gzip'))).arrayBuffer();
    }
    if (typeof module === 'object' && module.exports) {
      const bytes = require('node:zlib').gunzipSync(Buffer.from(buffer));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    throw new Error('This browser cannot decompress the Dive Experience map data.');
  }

  function createDataStore({ fetchImpl, baseUrl = 'data/dive-experience-outlook/v3/' } = {}) {
    const fetcher = fetchImpl || ((...args) => root.fetch(...args));
    let manifestPromise = null;
    let maskPromise = null;
    let supportPromise = null;
    const months = new Map();

    async function fetchPacked(file, signal) {
      const response = await fetcher(`${baseUrl}${file}`, { signal, cache:'force-cache' });
      if (!response?.ok) throw new Error(`Dive Experience asset ${file} returned HTTP ${response?.status ?? 'no response'}.`);
      return response.arrayBuffer();
    }
    function loadManifest() {
      if (!manifestPromise) {
        manifestPromise = fetcher(`${baseUrl}manifest.json`, { cache:'force-cache' })
          .then(response => { if (!response?.ok) throw new Error(`Dive Experience manifest returned HTTP ${response?.status ?? 'no response'}.`); return response.json(); })
          .then(validateManifest).catch(error => { manifestPromise = null; throw error; });
      }
      return manifestPromise;
    }
    async function loadMask() {
      if (!maskPromise) {
        maskPromise = (async () => {
          const manifest = await loadManifest();
          const packed = await fetchPacked(manifest.oceanMask.file);
          return decodeOceanMask(await decompress(packed), manifest);
        })().catch(error => { maskPromise = null; throw error; });
      }
      return maskPromise;
    }
    async function loadStaticSupport() {
      if (!supportPromise) {
        supportPromise = (async () => {
          const manifest = await loadManifest();
          const packed = await fetchPacked(manifest.encoding.staticSupport.file);
          return decodeStaticSupport(await decompress(packed), manifest);
        })().catch(error => { supportPromise = null; throw error; });
      }
      return supportPromise;
    }
    async function loadMonth(month, { signal } = {}) {
      if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError('Month must be 1 through 12.');
      if (months.has(month)) {
        const cached = months.get(month);
        months.delete(month);
        months.set(month, cached);
        return cached;
      }
      const manifest = await loadManifest();
      const entry = manifest.months[month - 1];
      const packed = await fetchPacked(entry.asset, signal);
      const data = decodeMonth(await decompress(packed), manifest, month);
      months.set(month, data);
      while (months.size > 2) months.delete(months.keys().next().value);
      return data;
    }
    return Object.freeze({ loadManifest, loadMask, loadStaticSupport, loadMonth,
      sample:async (latlng, month) => {
        const [manifest, mask, support, monthData] = await Promise.all([loadManifest(), loadMask(), loadStaticSupport(), loadMonth(month)]);
        return sampleAt(latlng, monthData, support, mask, manifest);
      },
      getCachedMonth:month => months.get(month) || null,
      cachedMonthCount:() => months.size });
  }

  function createGridLayer({ L, getManifest, getOceanMask, getMonthData }) {
    if (!L?.GridLayer?.extend) throw new TypeError('Leaflet GridLayer is required.');
    const tileQueue = [];
    let tileQueueHead = 0;
    let tileQueueScheduled = false;
    // Leave roughly 4 ms of a 60 Hz frame for input and compositing. Work is
    // yielded only between complete tiles so users never see partial pixels.
    const tileFrameBudgetMs = 12;

    function drainTileQueue() {
      tileQueueScheduled = false;
      const frameStartedAt = monotonicNow();
      let renderedInFrame = 0;
      while (tileQueueHead < tileQueue.length) {
        tileQueue[tileQueueHead++]();
        renderedInFrame += 1;
        if (renderedInFrame && monotonicNow() - frameStartedAt >= tileFrameBudgetMs) break;
      }
      if (tileQueueHead === tileQueue.length) {
        tileQueue.length = 0;
        tileQueueHead = 0;
      } else {
        scheduleTileQueue();
      }
    }

    function scheduleTileQueue() {
      if (tileQueueScheduled) return;
      tileQueueScheduled = true;
      if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(drainTileQueue);
      else root.setTimeout(drainTileQueue, 0);
    }

    const Layer = L.GridLayer.extend({
      createTile(coords, done) {
        const startedAt = monotonicNow();
        const canvas = root.document.createElement('canvas');
        const size = this.getTileSize();
        canvas.width = size.x;
        canvas.height = size.y;
        const complete = (startedAt, error = null) => {
          const elapsed = Math.max(0, monotonicNow() - startedAt);
          renderedTileCount += 1;
          renderedTileMsTotal += elapsed;
          renderedTileMsMax = Math.max(renderedTileMsMax, elapsed);
          Promise.resolve().then(() => done(error, canvas));
          return canvas;
        };
        const manifest = getManifest();
        const oceanMask = getOceanMask();
        const monthData = getMonthData();
        const context = canvas.getContext('2d');
        if (!context || !manifest || !oceanMask || !monthData) return complete(monotonicNow());

        const worldScale = 2 ** coords.z;
        const tileX = ((coords.x % worldScale) + worldScale) % worldScale;
        const cacheKey = `${monthData.month}/${coords.z}/${tileX}/${coords.y}`;
        const cachedImage = tileRasterCache.get(cacheKey);
        if (cachedImage) {
          tileRasterCache.delete(cacheKey);
          tileRasterCache.set(cacheKey, cachedImage);
          tileRasterCacheHits += 1;
          context.putImageData(cachedImage, 0, 0);
          return complete(startedAt);
        }
        tileRasterCacheMisses += 1;

        // Rendering at tile boundaries yields between small batches so a large
        // Leaflet redraw does not monopolize the main thread. Dropped/old tiles
        // still complete, but are not painted after their month or layer changes.
        tileQueue.push(() => {
          const startedAt = monotonicNow();
          if (!canvas.isConnected || getMonthData() !== monthData) return complete(startedAt);
          try {
            const image = context.createImageData(size.x, size.y);
            const worldPixels = size.x * worldScale;
            const startX = tileX * size.x;
            const startY = coords.y * size.y;
            const grid = manifest.grid;
            const samplesPerAxis = manifest.oceanMask.samplesPerAxis;
            for (let py = 0; py < size.y; py += 1) {
              const pixelY = startY + py + 0.5;
              if (pixelY < 0 || pixelY >= worldPixels) continue;
              const latitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * pixelY / worldPixels))) * 180 / Math.PI;
              const row = Math.floor((latitude - grid.south) / grid.step);
              if (row < 0 || row >= grid.height) continue;
              const subrow = Math.min(samplesPerAxis - 1, Math.floor(((latitude - grid.south) / grid.step - row) * samplesPerAxis));
              for (let px = 0; px < size.x; px += 1) {
                const longitude = (startX + px + 0.5) / worldPixels * 360 - 180;
                const column = Math.floor((longitude - grid.west) / grid.step);
                if (column < 0 || column >= grid.width) continue;
                const cell = row * grid.width + column;
                const subcolumn = Math.min(samplesPerAxis - 1, Math.floor(((longitude - grid.west) / grid.step - column) * samplesPerAxis));
                if (!(oceanMask[cell * samplesPerAxis + subrow] & (1 << subcolumn))) continue;
                const score = monthData.view.getUint8(monthData.scoreOffset + cell);
                if (score > 100) continue;
                const evidence = monthData.view.getUint8(monthData.overallConfidenceOffset + cell);
                const completeness = monthData.view.getUint8(monthData.completenessOffset + cell);
                const colorOffset = score * 3;
                const offset = (py * size.x + px) * 4;
                image.data[offset] = TILE_SCORE_RGB[colorOffset];
                image.data[offset + 1] = TILE_SCORE_RGB[colorOffset + 1];
                image.data[offset + 2] = TILE_SCORE_RGB[colorOffset + 2];
                image.data[offset + 3] = TILE_ALPHA[evidence * 101 + Math.min(100, completeness)];
              }
            }
            context.putImageData(image, 0, 0);
            tileRasterCache.set(cacheKey, image);
            if (tileRasterCache.size > TILE_RASTER_CACHE_LIMIT) {
              tileRasterCache.delete(tileRasterCache.keys().next().value);
              tileRasterCacheEvictions += 1;
            }
            complete(startedAt);
          } catch (error) {
            complete(startedAt, error);
          }
        });
        scheduleTileQueue();
        return canvas;
      }
    });
    // Keep confidence-driven cell alpha while using enough layer opacity for the score colors to read clearly.
    return new Layer({ pane:'diveExperienceScorePane', tileSize:256, opacity:0.82, updateWhenZooming:false,
      keepBuffer:1, className:'dive-experience-outlook-grid', interactive:false, crossOrigin:true });
  }

  return Object.freeze({ validateManifest, decodeMonth, decodeStaticSupport, decodeOceanMask, cellIndexAt,
    sampleAt, interpolateViridis, opacityFor, scoreLabel, physicalLabel, confidenceLabel,
    createDataStore, createGridLayer, getRenderDiagnostics:() => Object.freeze({ tileCount:renderedTileCount,
      totalTileRenderMs:Number(renderedTileMsTotal.toFixed(1)), maxTileRenderMs:Number(renderedTileMsMax.toFixed(1)),
      meanTileRenderMs:renderedTileCount ? Number((renderedTileMsTotal / renderedTileCount).toFixed(1)) : 0,
      rasterCache:{ hits:tileRasterCacheHits, misses:tileRasterCacheMisses, evictions:tileRasterCacheEvictions,
        entries:tileRasterCache.size, maxEntries:TILE_RASTER_CACHE_LIMIT,
        pixelBufferBytes:tileRasterCache.size * 256 * 256 * 4 } }), CELL_COUNT });
});
