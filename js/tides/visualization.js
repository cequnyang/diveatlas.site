import { createHarmonicPredictor, createHarmonicRecordPredictor } from './astronomy.js';
import { resolveTideLevel, resolveTideLevels } from './model-loader.js?v=3';
import { tideAssetUrl } from './asset-config.js';

const ROOT = 'eot20-viz-v1/';
const OVERVIEW_STEP = 1;
const CONSTITUENT_COUNT = 17;
const RECORD_SIZE = 1 + CONSTITUENT_COUNT * 8;
const HEADER_BYTES = 36;
const overviewCache = new Map();
let overviewManifestPromise;
const harmonicPredictorCache = new Map();
const MAX_HARMONIC_PREDICTORS = 8;

function harmonicPredictors(timestamp) {
  const key = Math.floor(timestamp / 60000) * 60000;
  if (harmonicPredictorCache.has(key)) {
    const cached = harmonicPredictorCache.get(key);
    harmonicPredictorCache.delete(key);
    harmonicPredictorCache.set(key, cached);
    return cached;
  }
  const result = {
    coefficients: createHarmonicPredictor(key),
    records: createHarmonicRecordPredictor(key)
  };
  harmonicPredictorCache.set(key, result);
  while (harmonicPredictorCache.size > MAX_HARMONIC_PREDICTORS) harmonicPredictorCache.delete(harmonicPredictorCache.keys().next().value);
  return result;
}

async function overviewManifest() {
  overviewManifestPromise ||= fetch(tideAssetUrl(`${ROOT}manifest.json`), { cache: 'force-cache' }).then(response => {
    if (!response.ok) throw new Error(`Tide overview manifest failed (${response.status}).`);
    return response.json();
  });
  return overviewManifestPromise;
}

async function overviewTile(ty, tx) {
  const key = `${ty}_${tx}`;
  if (overviewCache.has(key)) return overviewCache.get(key);
  const task = overviewManifest().then(async meta => {
    const record = meta.tiles?.[key];
    if (!record) return null;
    const response = await fetch(tideAssetUrl(`${ROOT}${record.path}`), { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Tide overview chunk failed (${response.status}).`);
    const compressed = await response.arrayBuffer();
    const buffer = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const view = new DataView(buffer);
    if (String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== 'TVZ1' || view.getUint8(4) !== 1) throw new Error('Unsupported Tide overview chunk.');
    const count = view.getUint8(5), rows = view.getUint16(6, true), columns = view.getUint16(8, true);
    const recordSize = view.getUint16(10, true), lat0 = view.getFloat64(12, true), lon0 = view.getFloat64(20, true), step = view.getFloat64(28, true);
    if (count !== CONSTITUENT_COUNT || recordSize !== RECORD_SIZE || step !== OVERVIEW_STEP || HEADER_BYTES + rows * columns * recordSize !== buffer.byteLength) throw new Error('Corrupt Tide overview chunk.');
    return { rows, columns, lat0, lon0, step, data: new DataView(buffer, HEADER_BYTES) };
  });
  overviewCache.set(key, task);
  try { return await task; } catch (error) { overviewCache.delete(key); throw error; }
}

function overviewKeyForLocation(lat, lon) {
  const wrappedLon = ((lon + 180) % 360 + 360) % 360 - 180;
  const ty = Math.min(5, Math.max(0, Math.floor((lat + 90) / 30)));
  const tx = Math.floor((wrappedLon + 180) / 30);
  return { key: `${ty}_${tx}`, wrappedLon };
}

function resolveOverviewCoefficientsFromTile(tile, lat, wrappedLon) {
  if (!tile) return null;
  const x = (wrappedLon - tile.lon0) / tile.step;
  const y = (lat - tile.lat0) / tile.step;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  if (x0 < 1 || y0 < 1 || x0 + 2 >= tile.columns || y0 + 2 >= tile.rows) return null;
  for (let row = y0 - 1; row <= y0 + 2; row += 1) for (let column = x0 - 1; column <= x0 + 2; column += 1) {
    if (tile.data.getUint8((row * tile.columns + column) * RECORD_SIZE) !== 1) return null;
  }
  const cells = [[y0, x0, (1 - fx) * (1 - fy)], [y0, x0 + 1, fx * (1 - fy)], [y0 + 1, x0, (1 - fx) * fy], [y0 + 1, x0 + 1, fx * fy]];
  const coefficients = Array.from({ length: CONSTITUENT_COUNT }, () => [0, 0]);
  for (const [row, column, weight] of cells) {
    const offset = (row * tile.columns + column) * RECORD_SIZE;
    for (let index = 0; index < CONSTITUENT_COUNT; index += 1) {
      coefficients[index][0] += tile.data.getFloat32(offset + 1 + index * 8, true) * weight;
      coefficients[index][1] += tile.data.getFloat32(offset + 5 + index * 8, true) * weight;
    }
  }
  return coefficients;
}

async function resolveOverviewCoefficients(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -85 || lat > 85) return null;
  const { key, wrappedLon } = overviewKeyForLocation(lat, lon);
  const [ty, tx] = key.split('_').map(Number);
  return resolveOverviewCoefficientsFromTile(await overviewTile(ty, tx), lat, wrappedLon);
}

export function createTideVisualizationSampler(timestamp, { overview = false } = {}) {
  // Tide harmonics change slowly; minute buckets let all tiles in one view share
  // both the astronomical terms and native-node predictions.
  const minuteTimestamp = Math.floor(timestamp / 60000) * 60000;
  const { coefficients: predict, records: predictRecord } = harmonicPredictors(minuteTimestamp);
  if (overview) {
    const sample = async (lat, lon) => {
      const coefficients = await resolveOverviewCoefficients(lat, lon);
      return coefficients ? predict(coefficients) : null;
    };
    sample.batch = async points => {
      const levels = new Array(points.length).fill(null);
      const groups = new Map();
      for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon) || point.lat < -85 || point.lat > 85) continue;
        const location = overviewKeyForLocation(point.lat, point.lon);
        if (!groups.has(location.key)) groups.set(location.key, []);
        groups.get(location.key).push({ index, point, wrappedLon: location.wrappedLon });
      }
      await Promise.all([...groups].map(async ([key, entries]) => {
        const [ty, tx] = key.split('_').map(Number);
        const tile = await overviewTile(ty, tx);
        if (!tile) return;
        for (const { index, point, wrappedLon } of entries) {
          const coefficients = resolveOverviewCoefficientsFromTile(tile, point.lat, wrappedLon);
          levels[index] = coefficients ? predict(coefficients) : null;
        }
      }));
      return levels;
    };
    return sample;
  }
  const sample = (lat, lon) => resolveTideLevel(lat, lon, minuteTimestamp, predictRecord);
  sample.batch = points => resolveTideLevels(points, minuteTimestamp, predictRecord);
  return sample;
}

export async function tideVisualizationLevel(lat, lon, timestamp) {
  const coefficients = await resolveOverviewCoefficients(lat, lon);
  return coefficients ? createHarmonicPredictor(timestamp)(coefficients) : null;
}
