#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'datasets', 'country-boundaries.geojson.gz');
const OUTPUT = path.join(ROOT, 'datasets', 'dive-experience-land-mask-v1.bin.gz');
const GRID = Object.freeze({ west:-180, south:-85, step:0.5, width:720, height:340 });
const SAMPLES_PER_AXIS = 8;
const SUBCELL_STEP = GRID.step / SAMPLES_PER_AXIS;
const SUBROW_COUNT = GRID.height * SAMPLES_PER_AXIS;
const SUBCOLUMN_COUNT = GRID.width * SAMPLES_PER_AXIS;

function scanlineIntervals(ring, latitude) {
  const intersections = [];
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[previous];
    if ((y1 > latitude) !== (y2 > latitude)) {
      intersections.push(((x2 - x1) * (latitude - y1)) / (y2 - y1) + x1);
    }
  }
  intersections.sort((left, right) => left - right);
  const intervals = [];
  for (let index = 0; index + 1 < intersections.length; index += 2) {
    intervals.push([intersections[index], intersections[index + 1]]);
  }
  return intervals;
}

function intervalContains(intervals, longitude) {
  let low = 0;
  let high = intervals.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [left, right] = intervals[middle];
    if (longitude < left) high = middle - 1;
    else if (longitude >= right) low = middle + 1;
    else return true;
  }
  return false;
}

function geometryPolygons(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function buildLatitudeIndex(featureCollection) {
  const index = Array.from({ length:SUBROW_COUNT }, () => []);
  let polygonCount = 0;
  for (const feature of featureCollection.features) {
    for (const rings of geometryPolygons(feature.geometry)) {
      const outer = rings?.[0];
      if (!Array.isArray(outer) || outer.length < 4) continue;
      let south = Infinity;
      let north = -Infinity;
      for (const point of outer) {
        south = Math.min(south, Number(point[1]));
        north = Math.max(north, Number(point[1]));
      }
      const first = Math.max(0, Math.floor((south - GRID.south) / SUBCELL_STEP) - 1);
      const last = Math.min(SUBROW_COUNT - 1, Math.ceil((north - GRID.south) / SUBCELL_STEP) + 1);
      const polygon = { rings };
      for (let subrow = first; subrow <= last; subrow += 1) index[subrow].push(polygon);
      polygonCount += 1;
    }
  }
  if (!polygonCount) throw new TypeError('Natural Earth country-boundary data contains no polygon rings.');
  return { index, polygonCount };
}

function fillPolygonLand(rowLand, polygon, latitude) {
  const rings = polygon.rings;
  const outerIntervals = scanlineIntervals(rings[0], latitude);
  if (!outerIntervals.length) return;
  const holeIntervals = rings.slice(1).flatMap(ring => scanlineIntervals(ring, latitude))
    .sort((left, right) => left[0] - right[0]);
  for (const [left, right] of outerIntervals) {
    const first = Math.max(0, Math.floor((left - GRID.west) / SUBCELL_STEP) - 1);
    const last = Math.min(SUBCOLUMN_COUNT - 1, Math.ceil((right - GRID.west) / SUBCELL_STEP) + 1);
    for (let subcolumn = first; subcolumn <= last; subcolumn += 1) {
      const longitude = GRID.west + (subcolumn + 0.5) * SUBCELL_STEP;
      if (longitude < left || longitude >= right || intervalContains(holeIntervals, longitude)) continue;
      rowLand[subcolumn] = 1;
    }
  }
}

function createLandMask(featureCollection) {
  const { index, polygonCount } = buildLatitudeIndex(featureCollection);
  const cellCount = GRID.width * GRID.height;
  const mask = Buffer.alloc(cellCount * SAMPLES_PER_AXIS);
  const rowLand = new Uint8Array(SUBCOLUMN_COUNT);
  let landSubcellCount = 0;

  for (let scanline = 0; scanline < SUBROW_COUNT; scanline += 1) {
    rowLand.fill(0);
    const latitude = GRID.south + (scanline + 0.5) * SUBCELL_STEP;
    for (const polygon of index[scanline]) fillPolygonLand(rowLand, polygon, latitude);

    const gridRow = Math.floor(scanline / SAMPLES_PER_AXIS);
    const subrow = scanline % SAMPLES_PER_AXIS;
    for (let subcolumn = 0; subcolumn < SUBCOLUMN_COUNT; subcolumn += 1) {
      if (!rowLand[subcolumn]) continue;
      const gridColumn = Math.floor(subcolumn / SAMPLES_PER_AXIS);
      const localSubcolumn = subcolumn % SAMPLES_PER_AXIS;
      const offset = (gridRow * GRID.width + gridColumn) * SAMPLES_PER_AXIS + subrow;
      mask[offset] |= 1 << localSubcolumn;
      landSubcellCount += 1;
    }
    if ((scanline + 1) % 400 === 0) {
      console.log(`Land mask rasterized through latitude row ${scanline + 1}/${SUBROW_COUNT}.`);
    }
  }

  const bytes = Buffer.alloc(16 + mask.length);
  bytes.write('DALM', 0, 'ascii');
  bytes.writeUInt8(1, 4);
  bytes.writeUInt8(SAMPLES_PER_AXIS, 5);
  bytes.writeUInt16LE(GRID.width, 6);
  bytes.writeUInt16LE(GRID.height, 8);
  bytes.writeUInt16LE(Math.round(GRID.step * 100), 10);
  bytes.writeInt16LE(Math.round(GRID.west * 10), 12);
  bytes.writeInt16LE(Math.round(GRID.south * 10), 14);
  mask.copy(bytes, 16);
  return { packed:zlib.gzipSync(bytes, { level:9 }), landSubcellCount, polygonCount };
}

async function main() {
  const packedBoundaries = await fs.readFile(SOURCE);
  const featureCollection = JSON.parse(zlib.gunzipSync(packedBoundaries).toString('utf8'));
  if (featureCollection?.type !== 'FeatureCollection' || !Array.isArray(featureCollection.features)) {
    throw new TypeError('Natural Earth country-boundary source is not a GeoJSON FeatureCollection.');
  }

  const result = createLandMask(featureCollection);
  await fs.writeFile(OUTPUT, result.packed);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)}: ${result.landSubcellCount.toLocaleString()} land subcells across ${result.polygonCount.toLocaleString()} polygons (${result.packed.byteLength.toLocaleString()} compressed bytes).`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({ GRID, SAMPLES_PER_AXIS, scanlineIntervals, intervalContains, createLandMask });
