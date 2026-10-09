let boundariesPromise;

async function loadBoundaryFile(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error(`Boundary request failed (${response.status}).`);
  if (typeof DecompressionStream !== 'function') throw new Error('Gzip decompression is unavailable.');
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
}

function ringContainsPoint(ring, longitude, latitude) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[previous];
    if ((y1 > latitude) !== (y2 > latitude) &&
        longitude < ((x2 - x1) * (latitude - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

function polygonContainsPoint(rings, longitude, latitude) {
  // Lakes still belong to their surrounding country, so polygon holes are intentionally ignored.
  return Boolean(rings?.[0] && ringContainsPoint(rings[0], longitude, latitude));
}

function geometryContainsPoint(geometry, longitude, latitude) {
  if (geometry?.type === 'Polygon') return polygonContainsPoint(geometry.coordinates, longitude, latitude);
  if (geometry?.type === 'MultiPolygon') {
    return geometry.coordinates.some(polygon => polygonContainsPoint(polygon, longitude, latitude));
  }
  return false;
}

function normalizedPoint(point) {
  if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return null;
  return { longitude:((point.lng + 180) % 360 + 360) % 360 - 180, latitude:point.lat };
}

export function findCountryAtLocation(point, featureCollection) {
  const normalized = normalizedPoint(point);
  if (!normalized) return null;
  return featureCollection?.features?.find(feature =>
    geometryContainsPoint(feature.geometry, normalized.longitude, normalized.latitude)
  )?.properties || null;
}

function findMaritimeZonesAtLocation(point, featureCollection) {
  const normalized = normalizedPoint(point);
  if (!normalized) return [];
  return (featureCollection?.features || []).filter(feature =>
    geometryContainsPoint(feature.geometry, normalized.longitude, normalized.latitude)
  );
}

function maritimeResult(zones, countries) {
  const contested = zones.filter(zone => zone.properties.kind === 'Overlapping claim');
  if (contested.length) {
    const names = [...new Set(contested.flatMap(zone => zone.properties.sovereignIsos || [])
      .map(iso => countries[iso]?.name || iso))];
    return { kind:'ambiguous', names, zones:contested };
  }
  const joint = zones.filter(zone => zone.properties.kind === 'Joint regime');
  if (joint.length) {
    const names = [...new Set(joint.flatMap(zone => zone.properties.sovereignIsos || [])
      .map(iso => countries[iso]?.name || iso))];
    return { kind:'joint', names, zones:joint };
  }
  const exclusive = zones.filter(zone => zone.properties.kind === '200NM');
  const sovereignIsos = [...new Set(exclusive.flatMap(zone => zone.properties.sovereignIsos || []))];
  if (sovereignIsos.length !== 1) return null;
  const country = countries[sovereignIsos[0]];
  if (!country) return null;
  const territory = [...new Set(exclusive.flatMap(zone => zone.properties.territories || []))]
    .find(name => name !== country.name);
  return { kind:'maritime', properties:country, territory };
}

export async function lookupCountryAtLocation(point) {
  boundariesPromise ||= Promise.all([
    loadBoundaryFile('../datasets/country-boundaries.geojson.gz'),
    loadBoundaryFile('../datasets/maritime-zones-v12.geojson.gz')
  ]).then(([countries, zones]) => ({ countries, zones })).catch(error => {
    boundariesPromise = null;
    throw error;
  });
  const { countries, zones } = await boundariesPromise;
  const land = findCountryAtLocation(point, countries);
  if (land) return { kind:'land', properties:land };
  return maritimeResult(findMaritimeZonesAtLocation(point, zones), zones.countries) || null;
}
