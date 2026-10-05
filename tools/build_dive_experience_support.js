#!/usr/bin/env node
'use strict';

// Package only the non-monthly evidence needed by the Outlook inspector. Raw
// abundance estimates stay in the analysis table and never enter this asset.
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { parseCsvRow, fishDimension } = require('./build_dive_experience_outlook_prototype.js');

const ROOT = path.resolve(__dirname, '..');
const GRID = Object.freeze({ west:-180, south:-85, step:0.5, width:720, height:340 });
const CELL_COUNT = GRID.width * GRID.height;
const MAP = path.join(ROOT, 'analysis', 'dive-experience-scoring-map-v2', 'generated', 'map');
const FISH = path.join(ROOT, 'analysis', 'fish-abundance-outlook-prototype', 'fish_abundance_outlook_grid.csv.gz');
const VERSIONED_FILE = path.join(MAP, 'static-support.bin.gz');
const FISH_DISTANCE_MISSING = 65535;
const FISH_SITE_COUNT_MISSING = 65535;
const FISH_EFFECTIVE_SUPPORT_MISSING = 65535;
const FISH_ENV_DISTANCE_MISSING = 65535;
const DHW_MISSING = 65535;
const THERMAL_DISTANCE_MISSING = 65535;
const EARTH_RADIUS_KM = 6371.0088;

function encodeHeader(bytes, magic, version) {
  bytes.write(magic, 0, 'ascii');
  bytes.writeUInt8(version, 4);
  bytes.writeUInt8(0, 5);
  bytes.writeUInt16LE(GRID.width, 6);
  bytes.writeUInt16LE(GRID.height, 8);
  bytes.writeUInt16LE(Math.round(GRID.step * 100), 10);
  bytes.writeInt16LE(Math.round(GRID.west * 10), 12);
  bytes.writeInt16LE(Math.round(GRID.south * 10), 14);
}

function boundedUInt16(value, scale = 1, missing = 65535) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return missing;
  return Math.min(65534, Math.round(number * scale));
}

function parseFishRows(packed) {
  const lines = zlib.gunzipSync(packed).toString('utf8').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('The fish outlook analysis table is empty.');
  const header = parseCsvRow(lines[0]);
  const columns = Object.fromEntries(header.map((name, index) => [name, index]));
  const required = ['cell_index','tier','abundance_category','outlook_score_internal_0_100','nearest_support_km',
    'supporting_sites','effective_support_n','environmental_support_distance','ocean_sample_fraction'];
  for (const field of required) if (!(field in columns)) throw new Error(`Fish outlook table is missing ${field}.`);
  const rows = new Map();
  for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
    const values = parseCsvRow(lines[rowIndex]);
    const get = name => values[columns[name]]?.trim() ?? '';
    const cell = Number(get('cell_index'));
    if (!Number.isInteger(cell) || cell < 0 || cell >= CELL_COUNT) continue;
    rows.set(cell, {
      tier:get('tier'), category:get('abundance_category'),
      score:get('outlook_score_internal_0_100') === '' ? null : Number(get('outlook_score_internal_0_100')),
      nearestObservationDistanceKm:get('nearest_support_km') === '' ? null : Number(get('nearest_support_km')),
      supportingSiteCount:get('supporting_sites') === '' ? null : Number(get('supporting_sites')),
      effectiveSupport:get('effective_support_n') === '' ? null : Number(get('effective_support_n')),
      environmentalSupportDistance:get('environmental_support_distance') === '' ? null : Number(get('environmental_support_distance')),
      oceanSampleFraction:get('ocean_sample_fraction') === '' ? null : Number(get('ocean_sample_fraction'))
    });
  }
  return rows;
}

function parseThermal(packed) {
  const bytes = zlib.gunzipSync(packed);
  if (bytes.length !== 16 + CELL_COUNT * 4 || bytes.toString('ascii', 0, 4) !== 'DAEH' || bytes.readUInt8(4) !== 1 ||
      bytes.readUInt16LE(6) !== GRID.width || bytes.readUInt16LE(8) !== GRID.height ||
      bytes.readUInt16LE(10) !== Math.round(GRID.step * 100) || bytes.readInt16LE(12) !== Math.round(GRID.west * 10) ||
      bytes.readInt16LE(14) !== Math.round(GRID.south * 10)) throw new Error('The thermal-history cache header is invalid.');
  const scores = bytes.subarray(16, 16 + CELL_COUNT);
  const validYears = bytes.subarray(16 + CELL_COUNT, 16 + CELL_COUNT * 2);
  const meansOffset = 16 + CELL_COUNT * 2;
  return { scores, validYears, meanAt:index => bytes.readUInt16LE(meansOffset + index * 2) };
}

function thermalSourceDistanceKm(index, grid) {
  const row = Math.floor(index / GRID.width);
  const column = index % GRID.width;
  const latitude = GRID.south + (row + 0.5) * GRID.step;
  const longitude = GRID.west + (column + 0.5) * GRID.step;
  const sourceColumn = Math.max(0, Math.min(grid.width - 1,
    Math.round((longitude - grid.longitude_min) / grid.longitude_step)));
  const sourceRow = Math.max(0, Math.min(grid.height - 1,
    Math.round((latitude - grid.latitude_min) / grid.latitude_step)));
  const sourceLatitude = grid.latitude_min + sourceRow * grid.latitude_step;
  const sourceLongitude = grid.longitude_min + sourceColumn * grid.longitude_step;
  const toRadians = value => value * Math.PI / 180;
  const dLat = toRadians(sourceLatitude - latitude);
  const dLng = toRadians(sourceLongitude - longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(latitude)) * Math.cos(toRadians(sourceLatitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
}

function createStaticSupportAsset(fishRows, thermal, monthManifest, thermalGrid) {
  if (!thermalGrid || !Number.isFinite(Number(thermalGrid.longitude_step)) || !Number.isFinite(Number(thermalGrid.latitude_step))) {
    throw new Error('The native NOAA thermal-history grid metadata is required for spatial-support encoding.');
  }
  const bytesPerCell = 20;
  const bytes = Buffer.alloc(16 + CELL_COUNT * bytesPerCell);
  encodeHeader(bytes, 'DAES', 1);
  const fishTierCodes = { A:1, B:2, C:3 };
  const fishCategoryCodes = { 'Very low':1, Low:2, 'Lower typical':3, Typical:4, 'Upper typical':5, High:6, 'Very high':7 };
  const fishEvidenceCodes = { A:1, B:2, C:3 };
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const offset = 16 + index * bytesPerCell;
    const row = fishRows.get(index);
    const dimension = fishDimension(row);
    const isAvailable = dimension?.isAvailable === true;
    const distance = row?.nearestObservationDistanceKm;
    const supportCode = !isAvailable ? 0 : Number.isFinite(distance) && distance <= 250 ? 1 : 2;
    bytes.writeUInt8(isAvailable ? Math.round(dimension.experienceScore) : 255, offset);
    bytes.writeUInt8(isAvailable ? fishTierCodes[row.tier] : 0, offset + 1);
    bytes.writeUInt8(isAvailable ? fishCategoryCodes[dimension.descriptiveCategory] || 0 : 0, offset + 2);
    bytes.writeUInt8(isAvailable ? fishEvidenceCodes[row.tier] || 0 : 0, offset + 3);
    bytes.writeUInt8(supportCode, offset + 4);
    bytes.writeUInt16LE(boundedUInt16(distance, 10, FISH_DISTANCE_MISSING), offset + 5);
    bytes.writeUInt16LE(boundedUInt16(row?.supportingSiteCount, 1, FISH_SITE_COUNT_MISSING), offset + 7);
    bytes.writeUInt16LE(boundedUInt16(row?.effectiveSupport, 10, FISH_EFFECTIVE_SUPPORT_MISSING), offset + 9);
    bytes.writeUInt16LE(boundedUInt16(row?.environmentalSupportDistance, 10, FISH_ENV_DISTANCE_MISSING), offset + 11);
    const fraction = Number(row?.oceanSampleFraction);
    bytes.writeUInt8(Number.isFinite(fraction) ? Math.max(0, Math.min(255, Math.round(fraction * 255))) : 0, offset + 13);

    const thermalScore = thermal.scores[index];
    bytes.writeUInt8(thermalScore <= 100 ? thermalScore : 255, offset + 14);
    bytes.writeUInt8(thermal.validYears[index], offset + 15);
    const meanDhw = thermal.meanAt(index);
    bytes.writeUInt16LE(meanDhw === 65535 ? DHW_MISSING : meanDhw, offset + 16);
    const thermalDistance = thermalScore <= 100 ? thermalSourceDistanceKm(index, thermalGrid) : null;
    bytes.writeUInt16LE(boundedUInt16(thermalDistance, 10, THERMAL_DISTANCE_MISSING), offset + 18);
  }
  const packed = zlib.gzipSync(bytes, { level:9 });
  const scoreCount = monthManifest.reduce((total, month) => total + Number(month.scoredCells || 0), 0);
  if (!scoreCount) throw new Error('The prototype monthly score grids do not contain scored cells.');
  return packed;
}

async function main() {
  const prototypeManifestPath = path.join(MAP, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(prototypeManifestPath, 'utf8'));
  if (manifest.format !== 'diveatlas-dive-experience-prototype-grid' || manifest.version !== 3 ||
      manifest.months?.length !== 12 || manifest.months.some(month => month.partial || month.processedOceanCells !== month.totalEligibleOceanCells)) {
    throw new Error('A complete accepted v3 Dive Experience prototype is required before packaging static support.');
  }
  const thermalName = manifest.thermalHistoryCache;
  if (!thermalName || path.basename(thermalName) !== thermalName) throw new Error('The prototype thermal-history cache is missing or invalid.');
  const thermalMetadataPath = path.join(ROOT, 'data', 'reef-condition', 'thermal-stress-history', 'metadata.json');
  const [fish, thermalPacked, thermalMetadata] = await Promise.all([
    fs.readFile(FISH),
    fs.readFile(path.join(MAP, thermalName)),
    fs.readFile(thermalMetadataPath, 'utf8').then(JSON.parse)
  ]);
  const asset = createStaticSupportAsset(parseFishRows(fish), parseThermal(thermalPacked), manifest.months, thermalMetadata.grid);
  await fs.writeFile(VERSIONED_FILE, asset);
  process.stdout.write(`Wrote ${path.relative(ROOT, VERSIONED_FILE)} (${asset.length.toLocaleString()} compressed bytes).\n`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = Object.freeze({ GRID, CELL_COUNT, parseFishRows, parseThermal, thermalSourceDistanceKm, createStaticSupportAsset });
