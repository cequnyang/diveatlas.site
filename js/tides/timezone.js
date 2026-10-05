import { tideAssetUrl } from './asset-config.js';

const BASE = 'timezones-2026d/';
let manifestPromise;
const cache = new Map();

function insideRing(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polygonContains(coordinates, lon, lat) {
  return insideRing(coordinates[0], lon, lat) && !coordinates.slice(1).some(ring => insideRing(ring, lon, lat));
}

function geometryContains(geometry, lon, lat) {
  if (geometry.type === 'Polygon') return polygonContains(geometry.coordinates, lon, lat);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(polygon => polygonContains(polygon, lon, lat));
  return false;
}

async function readGzip(response) {
  const bytes = await response.arrayBuffer();
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
}

export async function timezoneAt(lat, lon) {
  manifestPromise ||= fetch(tideAssetUrl(`${BASE}manifest.json`), { cache: 'force-cache' }).then(response => {
    if (!response.ok) throw new Error('Offline timezone manifest is unavailable.');
    return response.json();
  });
  const manifest = await manifestPromise;
  const ty = Math.min(17, Math.max(0, Math.floor((lat + 90) / 10)));
  const tx = Math.floor(((((lon + 180) % 360) + 360) % 360) / 10);
  const key = `${ty}_${tx}`;
  const path = manifest.chunkTemplate.replace('{ty}', String(ty)).replace('{tx}', String(tx));
  if (!cache.has(key)) {
    const pending = fetch(tideAssetUrl(`${BASE}${path}`), { cache: 'force-cache' }).then(response => {
      if (!response.ok) throw new Error(`Timezone boundary chunk request failed (${response.status}).`);
      return readGzip(response);
    });
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
  }
  const chunk = await cache.get(key);
  const normalizedLon = lon === 180 ? 180 : ((((lon + 180) % 360) + 360) % 360) - 180;
  for (const feature of chunk.features) {
    if (geometryContains(feature.geometry, normalizedLon, lat)) return feature.tzid;
  }
  return null;
}

export function timezoneCacheDiagnostics() { return [...cache.keys()]; }
