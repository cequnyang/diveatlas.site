import { createHarmonicRecordPredictor } from './astronomy.js';
import { tideAssetUrl } from './asset-config.js';

const ROOT = 'eot20-v1/';
const cache = new Map();
const predictedLevelChunks = new Map();
const MAX_PREDICTED_LEVEL_CHUNKS = 64;
let manifestPromise;

async function gzipBytes(response) {
  const bytes = await response.arrayBuffer();
  if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot decode compressed Tide model data.');
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

async function getManifest() {
  manifestPromise ||= fetch(tideAssetUrl(`${ROOT}manifest.json`), { cache: 'force-cache' }).then(response => {
    if (!response.ok) throw new Error(`Tide manifest request failed (${response.status}).`);
    return response.json();
  });
  return manifestPromise;
}

function readChunk(buffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== 'EOT1' || view.getUint8(4) !== 1) throw new Error('Unsupported EOT20 chunk format.');
  const constituentCount = view.getUint8(5), rows = view.getUint16(6, true), columns = view.getUint16(8, true);
  const recordSize = view.getUint16(10, true), lat0 = view.getFloat64(12, true), lon0 = view.getFloat64(20, true);
  const data = new DataView(buffer, 28);
  if (recordSize !== 1 + constituentCount * 8 || data.byteLength !== rows * columns * recordSize) throw new Error('Corrupt EOT20 chunk.');
  return { rows, columns, lat0, lon0, constituentCount, recordSize, data };
}

function chunkKeyForLocation(lat, lon) {
  const ty = Math.min(35, Math.max(0, Math.floor((lat + 90) / 5)));
  const tx = Math.floor(((((lon + 180) % 360) + 360) % 360) / 5);
  return `${ty}_${tx}`;
}

async function loadTileByKey(manifest, key) {
  if (cache.has(key)) return cache.get(key);
  const [ty, tx] = key.split('_');
  const path = manifest.chunkTemplate.replace('{ty}', ty).replace('{tx}', tx);
  const task = fetch(tideAssetUrl(`${ROOT}${path}`), { cache: 'force-cache' }).then(async response => {
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Tide chunk request failed (${response.status}).`);
    const decoded = await gzipBytes(response);
    return { ...readChunk(decoded), metadata: { key } };
  });
  cache.set(key, task);
  try { return await task; } catch (error) { cache.delete(key); throw error; }
}

async function loadTile(manifest, lat, lon) {
  return loadTileByKey(manifest, chunkKeyForLocation(lat, lon));
}

export async function resolveCoefficients(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -85.05112878 || lat > 85.05112878) return null;
  const manifest = await getManifest();
  const tile = await loadTile(manifest, lat, lon);
  if (!tile) return null;
  const x = ((((lon + 180) % 360) + 360) % 360 - 180 - tile.lon0) / 0.125;
  const y = (lat - tile.lat0) / 0.125;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= tile.columns || y0 + 1 >= tile.rows) return null;
  const fx = x - x0, fy = y - y0;
  const cells = [[y0, x0, (1 - fx) * (1 - fy)], [y0, x0 + 1, fx * (1 - fy)], [y0 + 1, x0, (1 - fx) * fy], [y0 + 1, x0 + 1, fx * fy]];
  const nearestNodeDistanceKm = Math.min(...cells.map(([row, column]) => {
    const dLat = ((tile.lat0 + row * 0.125) - lat) * 111.2;
    const nodeLon = tile.lon0 + column * 0.125;
    const dLon = (((nodeLon - lon + 540) % 360) - 180) * 111.32 * Math.cos(lat * Math.PI / 180);
    return Math.hypot(dLat, dLon);
  }));
  if (nearestNodeDistanceKm > 15) return null;
  const result = Array.from({ length: tile.constituentCount }, () => [0, 0]);
  for (const [row, column, weight] of cells) {
    const record = (row * tile.columns + column) * tile.recordSize;
    if (tile.data.getUint8(record) !== 1) return null;
    for (let index = 0; index < tile.constituentCount; index += 1) {
      const offset = record + 1 + index * 8;
      result[index][0] += tile.data.getFloat32(offset, true) * weight;
      result[index][1] += tile.data.getFloat32(offset + 4, true) * weight;
    }
  }
  return { coefficients: result, confidence: nearestNodeDistanceKm > 7.5 ? 'Limited' : 'Moderate', nearestNodeDistanceKm, manifest, chunk: tile.metadata.key };
}

function predictedLevelsForChunk(tile, timestamp, predictRecord) {
  const key = `${tile.metadata.key}:${timestamp}`;
  if (predictedLevelChunks.has(key)) {
    const cached = predictedLevelChunks.get(key);
    predictedLevelChunks.delete(key);
    predictedLevelChunks.set(key, cached);
    return cached;
  }

  const count = tile.rows * tile.columns;
  const levels = new Float32Array(count);
  const valid = new Uint8Array(count);
  const predictNode = predictRecord || createHarmonicRecordPredictor(timestamp);
  for (let index = 0; index < count; index += 1) {
    const record = index * tile.recordSize;
    if (tile.data.getUint8(record) !== 1) continue;
    levels[index] = predictNode(tile.data, record + 1);
    valid[index] = 1;
  }
  const result = { levels, valid };
  predictedLevelChunks.set(key, result);
  while (predictedLevelChunks.size > MAX_PREDICTED_LEVEL_CHUNKS) {
    predictedLevelChunks.delete(predictedLevelChunks.keys().next().value);
  }
  return result;
}

function samplePredictedLevel(tile, grid, lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -85.05112878 || lat > 85.05112878) return null;
  const wrappedLon = ((((lon + 180) % 360) + 360) % 360) - 180;
  const x = (wrappedLon - tile.lon0) / 0.125;
  const y = (lat - tile.lat0) / 0.125;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= tile.columns || y0 + 1 >= tile.rows) return null;
  const fx = x - x0, fy = y - y0;
  const nodes = [[y0, x0, (1 - fx) * (1 - fy)], [y0, x0 + 1, fx * (1 - fy)], [y0 + 1, x0, (1 - fx) * fy], [y0 + 1, x0 + 1, fx * fy]];
  let nearestNodeDistanceKm = Infinity;
  for (const [row, column] of nodes) {
    const dLat = ((tile.lat0 + row * 0.125) - lat) * 111.2;
    const nodeLon = tile.lon0 + column * 0.125;
    const dLon = (((nodeLon - lon + 540) % 360) - 180) * 111.32 * Math.cos(lat * Math.PI / 180);
    nearestNodeDistanceKm = Math.min(nearestNodeDistanceKm, Math.hypot(dLat, dLon));
  }
  if (nearestNodeDistanceKm > 15) return null;
  let level = 0;
  for (const [row, column, weight] of nodes) {
    const index = row * tile.columns + column;
    if (grid.valid[index] !== 1) return null;
    level += grid.levels[index] * weight;
  }
  return level;
}

// Tide synthesis is linear in constituent coefficients. Predict each valid
// native node once per minute, then bilinearly sample those levels for map pixels.
export async function resolveTideLevel(lat, lon, timestamp, predictRecord) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -85.05112878 || lat > 85.05112878) return null;
  const manifest = await getManifest();
  const tile = await loadTile(manifest, lat, lon);
  if (!tile) return null;
  const grid = predictedLevelsForChunk(tile, timestamp, predictRecord);
  return samplePredictedLevel(tile, grid, lat, lon);
}

// Grouping map samples by source chunk avoids repeating manifest/chunk lookup
// and async resolver setup for every raster pixel. Each chunk's prediction grid
// is built once, then all of that tile's requested pixels read from it directly.
export async function resolveTideLevels(points, timestamp, predictRecord) {
  const levels = new Array(points.length).fill(null);
  const groups = new Map();
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon) || point.lat < -85.05112878 || point.lat > 85.05112878) continue;
    const key = chunkKeyForLocation(point.lat, point.lon);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  }
  if (!groups.size) return levels;

  const manifest = await getManifest();
  await Promise.all([...groups].map(async ([key, indices]) => {
    const tile = await loadTileByKey(manifest, key);
    if (!tile) return;
    const grid = predictedLevelsForChunk(tile, timestamp, predictRecord);
    for (const index of indices) {
      const point = points[index];
      levels[index] = samplePredictedLevel(tile, grid, point.lat, point.lon);
    }
  }));
  return levels;
}

export function getTideCacheDiagnostics() {
  return { chunks: cache.size, keys: [...cache.keys()] };
}
