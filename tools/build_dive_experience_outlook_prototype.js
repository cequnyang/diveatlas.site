#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const gridBuilder = require('./build_dive_conditions_score_map.js');
const experienceModel = require('../js/dive-experience-model.js');
const conditionsModel = require('../js/dive-conditions-model.js');

const { ROOT, GRID, loadApis, parseOceanMask, collectOceanCells, parseGridFile } = gridBuilder;
const OUTPUT = path.join(ROOT, 'analysis', 'dive-experience-outlook-prototype');
const SCORE_MAP_OUTPUT = path.join(ROOT, 'analysis', 'dive-experience-scoring-map-v2');
const MAP_OUTPUT = path.join(SCORE_MAP_OUTPUT, 'generated', 'map');
const CELL_COUNT = GRID.width * GRID.height;
const FISH_GRID = path.join(ROOT, 'analysis', 'fish-abundance-outlook-prototype', 'fish_abundance_outlook_grid.csv.gz');
const REEF_TILE_DIRECTORY = path.join(ROOT, 'data', 'reef_tiles', '7');
const REEF_TILE_SIZE = 256;
const REEF_TILE_WORLD_PIXELS = REEF_TILE_SIZE * 2 ** 7;
// The 1 km rendered reef mask is sampled more finely than the existing 8x8 wet mask to reduce coastline aliasing; the coarser wet mask still limits precision, so resulting support stays Limited.
const REEF_FOOTPRINT_SUBSAMPLES_PER_AXIS = 4;
let reefExtentPercentByCellPromise = null;
let reefTileIndexPromise = null;
let thermalHistoryViewPromise = null;
let gridInputsPromise = null;
const LOCATIONS = Object.freeze([
  { id:'tropical-reef', label:'Tropical reef · Great Barrier Reef', lat:-18.2871, lng:147.6992 },
  { id:'temperate-coast', label:'Temperate coast · Monterey Bay', lat:36.6, lng:-122.0 },
  { id:'oceanic-island', label:'Oceanic island · Palau', lat:7.5, lng:134.5 }
]);

function parseCsvRow(line) {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      fields.push(value); value = '';
    } else value += character;
  }
  fields.push(value);
  return fields;
}

async function loadFishOutlook() {
  const csv = zlib.gunzipSync(await fs.readFile(FISH_GRID)).toString('utf8');
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('The fish outlook prototype table is empty.');
  const header = parseCsvRow(lines[0]);
  const column = Object.fromEntries(header.map((name, index) => [name, index]));
  for (const required of ['cell_index', 'tier', 'provenance', 'evidence_strength', 'outlook_score_internal_0_100', 'abundance_category',
    'supporting_sites', 'nearest_support_km', 'effective_support_n', 'environmental_support_distance',
    'environmental_support_threshold', 'ocean_sample_fraction', 'render_provenance']) {
    if (!(required in column)) throw new Error(`The fish outlook table is missing ${required}.`);
  }
  const rows = new Map();
  for (let index = 1; index < lines.length; index += 1) {
    const fields = parseCsvRow(lines[index]);
    const numeric = name => {
      const value = fields[column[name]]?.trim();
      return value ? Number(value) : null;
    };
    const tier = fields[column.tier];
    const scoreText = fields[column.outlook_score_internal_0_100]?.trim();
    const score = scoreText ? Number(scoreText) : null;
    const cellIndex = Number(fields[column.cell_index]);
    if (!Number.isInteger(cellIndex)) continue;
    rows.set(cellIndex, Object.freeze({
      tier,
      score:Number.isFinite(score) ? score : null,
      category:fields[column.abundance_category] || null,
      evidence:String(fields[column.evidence_strength] || 'none').toLowerCase(),
      sourceProvenance:fields[column.provenance] || 'unknown',
      lat:Number(fields[column.lat]),
      lng:Number(fields[column.lon]),
      supportingSiteCount:numeric('supporting_sites'),
      nearestObservationDistanceKm:numeric('nearest_support_km'),
      effectiveSupport:numeric('effective_support_n'),
      environmentalSupportDistance:numeric('environmental_support_distance'),
      environmentalSupportThreshold:numeric('environmental_support_threshold'),
      oceanSampleFraction:numeric('ocean_sample_fraction'),
      renderProvenance:fields[column.render_provenance] || null,
      unsupportedReason:fields[column.unsupported_reason] || null
    }));
  }
  return rows;
}

async function loadGridInputs() {
  if (gridInputsPromise) return gridInputsPromise;
  gridInputsPromise = (async () => {
  const maskPath = path.join(ROOT, 'data', 'dive_conditions_score', 'ocean-mask.bin.gz');
  const reefPath = path.join(ROOT, 'data', 'dive_conditions_score', 'reef-dimensions.bin.gz');
  const oceanMask = parseOceanMask(await fs.readFile(maskPath));
  const cells = collectOceanCells(oceanMask);
  const reefData = parseGridFile(await fs.readFile(reefPath), 'DARS', 0, CELL_COUNT * 3, 2);
  const reefExtentPercentByCell = await loadReefExtentPercentByCell(oceanMask, cells);
  const fishOutlook = await loadFishOutlook();
  return { oceanMask, cells, reefData, reefExtentPercentByCell, fishOutlook };
  })().catch(error => { gridInputsPromise = null; throw error; });
  return gridInputsPromise;
}

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance ? left
    : aboveDistance <= upperLeftDistance ? above : upperLeft;
}

async function readReefTileAlpha(tileX, tileY, cache, manifestTiles) {
  const key = `${tileX}/${tileY}`;
  if (cache.has(key)) return cache.get(key);
  const pending = (async () => {
    if (!manifestTiles.has(`7/${tileX}/${tileY}`)) return null;
    let bytes;
    try { bytes = await fs.readFile(path.join(REEF_TILE_DIRECTORY, String(tileX), `${tileY}.png`)); }
    catch (error) { if (error.code === 'ENOENT') throw new Error(`Reef extent manifest lists missing local tile ${key}.`); throw error; }
    if (bytes.toString('ascii', 1, 4) !== 'PNG' || bytes.readUInt8(24) !== 8 || bytes.readUInt8(25) !== 6 || bytes.readUInt8(28) !== 0) {
      throw new Error(`Unsupported Reef extent tile encoding at ${key}; expected non-interlaced 8-bit RGBA PNG.`);
    }
    const chunks = [];
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (type === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
      if (type === 'IEND') break;
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width !== REEF_TILE_SIZE || height !== REEF_TILE_SIZE) throw new Error(`Unexpected Reef extent tile dimensions at ${key}.`);
    const packed = zlib.inflateSync(Buffer.concat(chunks));
    const stride = width * 4;
    const rgba = Buffer.alloc(height * stride);
    for (let row = 0; row < height; row += 1) {
      const sourceOffset = row * (stride + 1);
      const filter = packed[sourceOffset];
      for (let column = 0; column < stride; column += 1) {
        const raw = packed[sourceOffset + 1 + column];
        const left = column >= 4 ? rgba[row * stride + column - 4] : 0;
        const above = row > 0 ? rgba[(row - 1) * stride + column] : 0;
        const upperLeft = row > 0 && column >= 4 ? rgba[(row - 1) * stride + column - 4] : 0;
        const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above
          : filter === 3 ? Math.floor((left + above) / 2) : filter === 4 ? paethPredictor(left, above, upperLeft) : null;
        if (predictor == null) throw new Error(`Unsupported PNG filter ${filter} in Reef extent tile ${key}.`);
        rgba[row * stride + column] = (raw + predictor) & 0xff;
      }
    }
    const alpha = new Uint8Array(width * height);
    for (let index = 0; index < alpha.length; index += 1) alpha[index] = rgba[index * 4 + 3];
    return alpha;
  })();
  cache.set(key, pending);
  return pending;
}

function reefTileSample(latitude, longitude) {
  const clippedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const x = ((longitude + 180) / 360) * REEF_TILE_WORLD_PIXELS;
  const y = (1 - Math.asinh(Math.tan(clippedLatitude * Math.PI / 180)) / Math.PI) / 2 * REEF_TILE_WORLD_PIXELS;
  const tileX = Math.max(0, Math.min(127, Math.floor(x / REEF_TILE_SIZE)));
  const tileY = Math.max(0, Math.min(127, Math.floor(y / REEF_TILE_SIZE)));
  const pixelX = Math.max(0, Math.min(255, Math.floor(x) - tileX * REEF_TILE_SIZE));
  const pixelY = Math.max(0, Math.min(255, Math.floor(y) - tileY * REEF_TILE_SIZE));
  return { tileX, tileY, pixelIndex:pixelY * REEF_TILE_SIZE + pixelX };
}

function sampleLocation(gridCell, subrow, subcolumn, offsetRow, offsetColumn) {
  const step = GRID.step / 8 / REEF_FOOTPRINT_SUBSAMPLES_PER_AXIS;
  return {
    lat:GRID.south + (gridCell.row + (subrow + (offsetRow + 0.5) / REEF_FOOTPRINT_SUBSAMPLES_PER_AXIS) / 8) * GRID.step,
    lng:GRID.west + (gridCell.column + (subcolumn + (offsetColumn + 0.5) / REEF_FOOTPRINT_SUBSAMPLES_PER_AXIS) / 8) * GRID.step
  };
}

function parseGridCell(index) {
  return { row:Math.floor(index / GRID.width), column:index % GRID.width };
}

async function loadReefExtentPercentByCell(oceanMask, cells) {
  if (reefExtentPercentByCellPromise) return reefExtentPercentByCellPromise;
  reefExtentPercentByCellPromise = (async () => {
    const output = new Uint8Array(CELL_COUNT).fill(255);
    const tileCache = new Map();
    if (!reefTileIndexPromise) reefTileIndexPromise = (async () => {
      const source = await fs.readFile(path.join(ROOT, 'datasets', 'reef_raster_manifest.js'), 'utf8');
      const match = source.match(/window\.DIVEATLAS_REEF_RASTER_MANIFEST\s*=\s*(\{.*\})\s*;/);
      if (!match) throw new Error('The Reef extent tile manifest is missing or invalid.');
      const manifest = JSON.parse(match[1]);
      if (manifest.v !== 1 || !Array.isArray(manifest.tiles)) throw new Error('Unsupported Reef extent tile manifest.');
      return new Set(manifest.tiles.map(([zoom, x, y]) => `${zoom}/${x}/${y}`));
    })();
    const manifestTiles = await reefTileIndexPromise;
    for (let cellPosition = 0; cellPosition < cells.length; cellPosition += 1) {
      const cell = cells[cellPosition];
      const gridCell = parseGridCell(cell.index);
      let wetSampleCount = 0;
      let mappedReefSampleCount = 0;
      const samplesByTile = new Map();
      const maskOffset = cell.index * 8;
      for (let subrow = 0; subrow < 8; subrow += 1) {
        const wetBits = oceanMask[maskOffset + subrow];
        for (let subcolumn = 0; subcolumn < 8; subcolumn += 1) {
          if ((wetBits & (1 << subcolumn)) === 0) continue;
          for (let offsetRow = 0; offsetRow < REEF_FOOTPRINT_SUBSAMPLES_PER_AXIS; offsetRow += 1) {
            for (let offsetColumn = 0; offsetColumn < REEF_FOOTPRINT_SUBSAMPLES_PER_AXIS; offsetColumn += 1) {
              const point = sampleLocation(gridCell, subrow, subcolumn, offsetRow, offsetColumn);
              const sample = reefTileSample(point.lat, point.lng);
              const key = `${sample.tileX}/${sample.tileY}`;
              const group = samplesByTile.get(key) || { tileX:sample.tileX, tileY:sample.tileY, pixels:[] };
              group.pixels.push(sample.pixelIndex);
              samplesByTile.set(key, group);
              wetSampleCount += 1;
            }
          }
        }
      }
      for (const group of samplesByTile.values()) {
        const alpha = await readReefTileAlpha(group.tileX, group.tileY, tileCache, manifestTiles);
        if (!alpha) continue;
        for (const pixelIndex of group.pixels) if (alpha[pixelIndex] > 0) mappedReefSampleCount += 1;
      }
      if (wetSampleCount) output[cell.index] = Math.round(mappedReefSampleCount / wetSampleCount * 100);
      if ((cellPosition + 1) % 10000 === 0) console.log(`Reef footprint share sampled for ${cellPosition + 1}/${cells.length} cells.`);
    }
    return output;
  })().catch(error => { reefExtentPercentByCellPromise = null; throw error; });
  return reefExtentPercentByCellPromise;
}

function fishDimension(row) {
  if (!row || !Number.isFinite(row.score) || !['A', 'B', 'C'].includes(row.tier)) return null;
  const provenance = row.tier === 'C' ? 'ecological_outlook' : 'regional_estimate';
  const evidenceLevel = row.tier === 'A' ? 'high' : row.tier === 'B' ? 'moderate' : 'limited';
  const tierLabel = row.tier === 'A' ? 'survey-supported map estimate' : row.tier === 'B'
    ? 'regional NRMN estimate' : 'environmentally screened ecological outlook';
  const nearest = row.nearestObservationDistanceKm;
  const maximumDistanceKm = row.tier === 'A' ? 2500 : row.tier === 'B' ? 5000 : null;
  const supportIsDefensible = Number.isFinite(nearest) && Number.isFinite(row.supportingSiteCount) && row.supportingSiteCount > 0 &&
    Number.isFinite(row.effectiveSupport) && row.effectiveSupport > 0 && (maximumDistanceKm == null || nearest <= maximumDistanceKm);
  const distanceKm = Number.isFinite(nearest) ? Math.max(0, nearest) : null;
  const confidenceFactor = distanceKm == null ? 0 : 1 / (1 + (distanceKm / 250) ** 3);
  return {
    rawValue:row.score,
    unit:'relative rank',
    descriptiveCategory:experienceModel.fishOutlookBand(row.score),
    experienceScore:experienceModel.fishOutlookScore(row.score),
    evidenceLevel,
    provenance,
    isEstimated:true,
    isAvailable:supportIsDefensible,
    notes:`${tierLabel}; relative abundance rank is mapped through seven consumer stages. Exact fish density is withheld because the source target is positive recorded survey units.`,
    source:`NRMN fish outlook tier ${row.tier}`,
    spatialSupport:{
      mode:'observation-derived spatial estimate',
      status:supportIsDefensible ? (distanceKm <= 250 ? 'supported' : 'limited') : 'unsupported',
      sourceType:row.tier === 'A' ? 'survey-supported existing map estimate' : row.tier === 'B' ? 'NRMN regional distance-weighted estimate' : 'ecological spline outlook',
      provenance:row.sourceProvenance,
      nearestObservationDistanceKm:distanceKm,
      supportingSiteCount:row.supportingSiteCount,
      effectiveSupport:row.effectiveSupport,
      analysisCellResolution:'0.5° output cell',
      maximumSupportDistanceKm:maximumDistanceKm,
      supportKernel:row.tier === 'B' ? '1 / (1 + (distance / 250 km)^3)' : row.tier === 'A' ? 'Existing survey-supported grid; distance kernel is recorded for confidence only.' : 'Spline environmental-support screen; nearest-observation distance retained for confidence.',
      fallbackBehavior:row.tier === 'B' ? 'Shrinks toward coarse geographic-basin median; basin identifier is not retained in the cell table.' : row.tier === 'C' ? 'Model estimates are withheld when environmental novelty screen fails.' : 'No score fallback is applied when survey support is unavailable.',
      geographicSupport:{ tier:row.tier, oceanSampleFraction:row.oceanSampleFraction, environmentalSupportDistance:row.environmentalSupportDistance,
        environmentalSupportThreshold:row.environmentalSupportThreshold, renderedSource:row.renderProvenance },
      connectivity:{ waterComponentId:null, method:'not retained by source table; the coarse 7 km connectivity diagnostic is not used to assert water connectivity.' },
      confidenceFactor,
      notes:'Distance changes support confidence only. It does not modify the fish experience score.'
    }
  };
}

function coralSupport(reefData, cellIndex) {
  const available = reefData[cellIndex] <= 100;
  return {
    rawValue:available ? reefData[cellIndex] : null,
    unit:'relative percentile rank',
    descriptiveCategory:available ? `Coral Records relative rank ${reefData[cellIndex]}/100` : null,
    evidenceLevel:available ? 'moderate' : 'none',
    provenance:available ? 'regional_estimate' : 'unknown',
    isEstimated:available,
    isAvailable:available,
    spatialSupport:{
      mode:'support-grid lookup', status:available ? 'supported' : 'unsupported', sourceType:'derived Coral Records support grid',
      provenance:'local precomputed grid', analysisCellResolution:'0.5° analysis cell',
      fallbackBehavior:'No nearby-record fallback is applied; missing grid value remains unavailable.',
      geographicSupport:{ analysisCellIndex:cellIndex }, confidenceFactor:available ? 0.75 : 0,
      notes:'This value is a relative rank from the Coral Records support grid, not a raw record count, local coral-colony count, or coral-cover measurement.'
    },
    notes:available
      ? 'A relative Coral Records rank exists for this cell; observation effort affects this evidence and it is not a local colony count.'
      : 'No Coral Records support estimate is available for this cell.'
  };
}

function reefHabitatCoralEvidenceDimension(reefExtentPercent, coralSupportDimension) {
  const measurement = experienceModel.reefHabitatCoralEvidenceScore({
    reefExtentPercentOfWetCell:reefExtentPercent,
    coralRecordPercentile:coralSupportDimension?.rawValue
  });
  const available = Boolean(measurement && coralSupportDimension?.isAvailable === true);
  return {
    rawValue:available ? measurement.score : null,
    unit:'evidence index',
    descriptiveCategory:available ? measurement.category : null,
    experienceScore:available ? measurement.score : null,
    evidenceLevel:available ? 'limited' : 'none',
    provenance:available ? 'regional_estimate' : 'unknown',
    isEstimated:available,
    isAvailable:available,
    source:available ? 'UNEP-WCMC mapped reef footprint + Coral Records relative-rank grid' : null,
    notes:available
      ? `Evidence index only; mapped reef footprint component ${measurement.reefFootprintScore}/100 (${measurement.reefFootprintCategory}), Coral Records rank component ${measurement.coralRecordRankScore}/100 (${measurement.coralRecordRankCategory}). Not live-coral cover or reef condition.`
      : 'Unavailable until both mapped reef-footprint share and Coral Records relative rank are available; missing inputs are not treated as zero.',
    spatialSupport:{
      mode:'composite gridded evidence index',
      status:available ? 'limited' : 'unsupported',
      sourceType:'UNEP-WCMC mapped reef extent raster + derived Coral Records support grid',
      provenance:'mapped habitat raster and precomputed relative record-rank grid',
      nativeResolution:'~1 km rendered reef-raster pixels; sampled within the 0.5° analysis cell',
      analysisCellResolution:'0.5° analysis cell',
      fallbackBehavior:'No spatial fallback or zero substitution; both component inputs are required.',
      geographicSupport:available ? { reefExtentPercentOfWetCell:Number(reefExtentPercent), coralRecordPercentile:Number(coralSupportDimension.rawValue),
        reefSampling:'4 × 4 samples within each wet subcell of the existing 8 × 8 ocean mask' } : null,
      confidenceFactor:available ? 0.55 : 0,
      notes:'Coral Records source distance/site count are not retained by the current grid, so support is limited. Distance affects confidence only, never this score.'
    }
  };
}

async function createThermalHistoryView() {
  if (thermalHistoryViewPromise) return thermalHistoryViewPromise;
  thermalHistoryViewPromise = (async () => {
  const api = require('../js/coral-heat-history-view.js');
  const fakeMap = { getZoom:() => 4, hasLayer:() => false, removeLayer() {}, on() {}, off() {} };
  const leaflet = { tileLayer:() => ({ options:{ opacity:0.78 }, on() { return this; }, addTo() { return this; }, setOpacity() {} }) };
  const view = api.createCoralHeatStressHistoryView({ L:leaflet, map:fakeMap, fetchImpl:gridBuilder.localFetch });
  await view.activate(2025);
  if (!view.mapMetadata?.years?.length) throw new Error('The local NOAA annual thermal-history product could not be loaded.');
  return view;
  })().catch(error => { thermalHistoryViewPromise = null; throw error; });
  return thermalHistoryViewPromise;
}

async function thermalHistoryAt(view, location, minimumValidYears = 6) {
  const latestYear = view.mapMetadata.years.at(-1);
  let history;
  try { history = await view.sampleGlobalHistory(latestYear, location.lat, location.lng); }
  catch { return null; }
  const values = (history?.values || []).map(Number).filter(value => Number.isFinite(value) && value >= 0);
  if (values.length < minimumValidYears) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const score = experienceModel.scoreThermalHistory(mean);
  if (!score) return null;
  const sourceLocation = { lat:history.source_latitude, lng:history.source_longitude };
  const sampleDistanceKm = Number.isFinite(Number(sourceLocation.lat)) && Number.isFinite(Number(sourceLocation.lng))
    ? gridBuilder.distanceKm(location.lat, location.lng, sourceLocation.lat, sourceLocation.lng) : null;
  return Object.freeze({ meanDhw:mean, validYears:values.length, score:score.score, category:score.category,
    source:`NOAA CoralTemp annual maximum DHW history (${history.years?.[0]}–${history.years?.at(-1)})`,
    sourceLocation, sampleDistanceKm });
}

function thermalHistoryDimension(history) {
  if (!history) return null;
  return {
    rawValue:Number(history.meanDhw.toFixed(2)),
    unit:'°C-weeks',
    descriptiveCategory:history.category,
    experienceScore:history.score,
    evidenceLevel:history.validYears >= 8 ? 'high' : 'moderate',
    provenance:'climatology_or_model',
    isEstimated:true,
    isAvailable:true,
    notes:`Mean annual-maximum DHW over ${history.validYears} available years in the latest decade. Heat-stress thresholds do not confirm bleaching or mortality.`,
    source:history.source,
    spatialSupport:{
      mode:'gridded annual-history sample', status:'supported', sourceType:'NOAA Coral Reef Watch CoralTemp global 5 km v3.1 history',
      provenance:history.source, sampleDistanceKm:history.sampleDistanceKm, nativeResolution:'0.05° (~5 km at equator)',
      maximumSupportDistanceKm:3.93, fallbackBehavior:'Nearest native grid cell only. Missing selected-year data or fewer than six valid annual values remains unavailable.',
      geographicSupport:{ sourceLocation:history.sourceLocation, validYears:history.validYears }, confidenceFactor:Number.isFinite(history.sampleDistanceKm)
        ? 1 / (1 + (history.sampleDistanceKm / 5.56) ** 2) : 0,
      notes:'Nearest-cell distance affects evidence confidence, not the thermal-stress score.'
    }
  };
}

function resolutionDistanceKm(resolution, latitude) {
  if (resolution == null) return null;
  const value = String(resolution).match(/[\d.]+/);
  if (!value) return null;
  const number = Number(value[0]);
  if (!Number.isFinite(number)) return null;
  if (/km/i.test(String(resolution))) return number;
  if (/°|degree/i.test(String(resolution))) {
    const longitudeScale = Math.cos(Number(latitude) * Math.PI / 180);
    return number * 111.2 * Math.sqrt((1 + longitudeScale * longitudeScale) / 2);
  }
  return null;
}

function griddedSpatialSupport(metric, metricId, cell) {
  const isAvailable = metric?.value != null && Number.isFinite(Number(metric.value));
  const isNearbyTemperatureEstimate = metricId === 'temperature' && metric?.estimated === true;
  const maxDistance = metricId === 'temperature' ? (isNearbyTemperatureEstimate ? 100 : 25)
    : metricId === 'clarity' ? 25 : null;
  const nativeResolution = metric?.resolution || null;
  const resolutionKm = resolutionDistanceKm(nativeResolution, cell.location.lat);
  const sampleDistanceKm = Number.isFinite(Number(metric?.sampleDistanceKm)) ? Number(metric.sampleDistanceKm) : null;
  const inRange = maxDistance == null || (sampleDistanceKm != null && sampleDistanceKm <= maxDistance);
  const supportStatus = isAvailable && inRange
    ? (isNearbyTemperatureEstimate || (resolutionKm != null && sampleDistanceKm != null && sampleDistanceKm > resolutionKm) ? 'limited' : 'supported')
    : 'unsupported';
  const sourceType = metric?.provenance || 'regional ocean climatology/model';
  const fallbacks = {
    temperature:isNearbyTemperatureEstimate
      ? 'Analysis-only provisional fallback: nearest valid WOA23 cell for the selected month and 5 m depth within 100 km; spatial validation is pending.'
      : 'Nearest valid WOA23 cell within 25 km; no valid cell in radius remains unavailable.',
    clarity:'Nearest valid ocean-colour cell within 25 km; no value in radius remains unavailable.',
    current:'Nearest rounded 0.333° static current tile cell at 10 m; masked/missing values remain unavailable.',
    waves:'Nearest rounded 0.2° monthly wave grid cell; missing source values remain unavailable.'
  };
  const sampleScaleKm = Math.max(1, resolutionKm || 25);
  const confidenceFactor = sampleDistanceKm == null ? (isAvailable ? 0.6 : 0) : 1 / (1 + (sampleDistanceKm / sampleScaleKm) ** 2);
  return {
    mode:'gridded/model sample', status:supportStatus, sourceType, provenance:metric?.provenance || null,
    sampleDistanceKm, nativeResolution, maximumSupportDistanceKm:maxDistance,
    fallbackBehavior:fallbacks[metricId], geographicSupport:{ sourceLatitude:metric?.sourceLatitude ?? null, sourceLongitude:metric?.sourceLongitude ?? null },
    confidenceFactor, notes:'Source distance affects evidence confidence only; it does not directly change the dimension score.'
  };
}

function dimensionsFor(result, cell, inputs, model) {
  const dimensions = {};
  const mappings = [
    ['temperature', 'waterTemperature'], ['clarity', 'waterClarity'],
    ['current', 'current'], ['waves', 'waveHeight']
  ];
  for (const [metricId, dimensionId] of mappings) {
    const metric = result.metrics?.[metricId];
    const value = metric?.value;
    const category = metric?.interpretation || null;
    const score = value == null || !category ? null : model.metricScore(metricId, value);
    dimensions[dimensionId] = {
      rawValue:value,
      unit:metric?.unit || (metricId === 'temperature' ? '°C' : metricId === 'clarity' ? 'm' : metricId === 'current' ? 'm/s' : 'm'),
      descriptiveCategory:category,
      experienceScore:score,
      evidenceLevel:value == null ? 'none' : metric?.estimated ? 'limited' : 'moderate',
      provenance:value == null ? 'unknown' : metric?.estimated ? 'regional_estimate' : 'climatology_or_model',
      isEstimated:value != null,
      isAvailable:value != null && Number.isFinite(Number(score)),
      notes:value == null ? 'No valid monthly sample at this location.' : metric?.estimated
        ? 'Provisional nearby WOA23 estimate; analysis-only pending spatial validation.'
        : 'Historical monthly climatology or ocean-model sample; not a live forecast.',
      source:metric?.provenance || null,
      sampleDistanceKm:metric?.sampleDistanceKm ?? null,
      spatialSupport:griddedSpatialSupport(metric, metricId, cell)
    };
  }
  dimensions.fishDensity = fishDimension(inputs.fishOutlook.get(cell.index));
  dimensions.thermalStressHistory = thermalHistoryDimension(inputs.thermalHistory);
  dimensions.coralRecords = coralSupport(inputs.reefData, cell.index);
  const reefExtentPercent = inputs.reefExtentPercentByCell?.[cell.index];
  dimensions.reefHabitatCoralEvidence = reefHabitatCoralEvidenceDimension(
    reefExtentPercent === 255 ? null : reefExtentPercent, dimensions.coralRecords
  );
  return dimensions;
}

function closestCell(cells, location) {
  let nearest = null;
  for (const cell of cells) {
    const distance = gridBuilder.distanceKm(location.lat, location.lng, cell.location.lat, cell.location.lng);
    if (!nearest || distance < nearest.distanceKm) nearest = { cell, distanceKm:distance };
  }
  return nearest;
}

function confidenceCode(label) {
  return ({ Low:1, Limited:2, Moderate:3, High:4 })[label] ?? 0;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvTable(headers, rows) {
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n') + '\n';
}

function syntheticSupportDimension(config, score) {
  return {
    rawValue:null, unit:config.unit, descriptiveCategory:'Synthetic sensitivity value', experienceScore:score,
    evidenceLevel:'limited', provenance:'unknown', isEstimated:true, isAvailable:true,
    source:'Controlled synthetic availability test only',
    notes:'Synthetic sensitivity input, not a production or observed value.',
    spatialSupport:{ mode:'controlled synthetic test', status:'limited', sourceType:'synthetic sensitivity only',
      provenance:'scenario input', confidenceFactor:1, notes:'Used only to quantify the influence of future-dimension availability.' }
  };
}

function buildSensitivityArtifacts(samples) {
  const comparisonRows = [];
  const sensitivityRows = [];
  const syntheticModel = experienceModel.createDiveExperienceModel({ dimensionOverrides:{
    reefHabitatCoralEvidence:{ enabled:true, status:'sensitivity_test_enabled' }
  } });
  const reefEvidenceIds = ['reefHabitatCoralEvidence'];
  const scenarioScores = [0, 50, 100];
  for (const site of samples) {
    for (const result of site.monthly) {
      const group = id => result.groups.find(item => item.id === id);
      comparisonRows.push([
        site.id, result.month, result.score, result.legacyGlobalNormalizedScore,
        result.score == null || result.legacyGlobalNormalizedScore == null ? null : result.score - result.legacyGlobalNormalizedScore,
        result.confidence, result.confidenceValue, result.scoreCompletenessPercentage,
        group('physicalExperience')?.score, group('physicalExperience')?.completenessPercentage,
        group('reefEcologicalExperience')?.score, group('reefEcologicalExperience')?.completenessPercentage,
        result.activeDimensions.join('|'), result.unavailableDimensions.join('|')
      ]);
      const baseDimensions = Object.fromEntries(result.dimensions.map(dimension => [dimension.id, dimension]));
      for (const syntheticValue of scenarioScores) {
        const futureDimensions = { ...baseDimensions };
        for (const id of reefEvidenceIds) futureDimensions[id] = syntheticSupportDimension(syntheticModel.DIMENSIONS.find(item => item.id === id), syntheticValue);
        const syntheticResult = syntheticModel.calculate({ location:site.sampledLocation, month:result.month, dimensions:futureDimensions });
        const syntheticEco = syntheticResult.groups.find(item => item.id === 'reefEcologicalExperience');
        sensitivityRows.push([
          site.id, result.month, syntheticValue, result.score, syntheticResult.score,
          result.score == null || syntheticResult.score == null ? null : syntheticResult.score - result.score,
          result.scoreCompletenessPercentage, syntheticResult.scoreCompletenessPercentage,
          group('reefEcologicalExperience')?.score, syntheticEco.score, 'synthetic-only; no production observations supplied'
        ]);
      }
    }
  }
  const hasNumericValue = value => value != null && value !== '' && Number.isFinite(Number(value));
  const scoreDeltas = comparisonRows.map(row => row[4]).filter(hasNumericValue).map(Number);
  const scenarios = scenarioScores.map(score => {
    const rows = sensitivityRows.filter(row => Number(row[2]) === score);
    const pairedDeltas = rows.map(row => row[5]).filter(hasNumericValue).map(Number);
    const newlyScored = rows.filter(row => row[3] == null && row[4] != null).length;
    return {
      syntheticScore:score,
      pairedSitesMonths:pairedDeltas.length,
      meanScoreDelta:pairedDeltas.length ? Number((pairedDeltas.reduce((sum, value) => sum + value, 0) / pairedDeltas.length).toFixed(2)) : null,
      minimumScoreDelta:pairedDeltas.length ? Math.min(...pairedDeltas) : null,
      maximumScoreDelta:pairedDeltas.length ? Math.max(...pairedDeltas) : null,
      newlyScoredSitesMonths:newlyScored
    };
  });
  return {
    comparisonRows, sensitivityRows,
    normalizationSummary:{ pairedSitesMonths:scoreDeltas.length,
      meanScoreDelta:scoreDeltas.length ? Number((scoreDeltas.reduce((sum, value) => sum + value, 0) / scoreDeltas.length).toFixed(2)) : null,
      minimumScoreDelta:scoreDeltas.length ? Math.min(...scoreDeltas) : null,
      maximumScoreDelta:scoreDeltas.length ? Math.max(...scoreDeltas) : null,
      unscoredSitesMonths:comparisonRows.filter(row => row[2] == null).length },
    syntheticSummary:scenarios
  };
}

const REEF_HABITAT_EVIDENCE_SCENARIOS = Object.freeze([
  Object.freeze({ id:'high_documented_reef_evidence', label:'Synthetic high evidence-index value',
    dimensions:{ reefHabitatCoralEvidence:85 }, available:['reefHabitatCoralEvidence'], provenance:'regional_estimate', evidenceLevel:'limited', confidenceFactor:0.55 }),
  Object.freeze({ id:'moderate_documented_reef_evidence', label:'Synthetic moderate evidence-index value',
    dimensions:{ reefHabitatCoralEvidence:55 }, available:['reefHabitatCoralEvidence'], provenance:'regional_estimate', evidenceLevel:'limited', confidenceFactor:0.55 }),
  Object.freeze({ id:'low_documented_reef_evidence', label:'Synthetic low evidence-index value',
    dimensions:{ reefHabitatCoralEvidence:20 }, available:['reefHabitatCoralEvidence'], provenance:'regional_estimate', evidenceLevel:'limited', confidenceFactor:0.55 }),
  Object.freeze({ id:'partial_documented_reef_evidence', label:'Synthetic partial evidence-index value',
    dimensions:{ reefHabitatCoralEvidence:60 }, available:['reefHabitatCoralEvidence'], provenance:'regional_estimate', evidenceLevel:'limited', confidenceFactor:0.55 })
]);

function buildReefHabitatEvidenceSensitivity(samples) {
  const syntheticModel = experienceModel.createDiveExperienceModel({ dimensionOverrides:Object.fromEntries(
    ['reefHabitatCoralEvidence'].map(id => [id, { enabled:true, status:'sensitivity_test_enabled' }])) });
  const rows = [];
  for (const site of samples) for (const current of site.monthly) {
    const baseDimensions = Object.fromEntries(current.dimensions.map(dimension => [dimension.id, dimension]));
    for (const scenario of REEF_HABITAT_EVIDENCE_SCENARIOS) {
      const scenarioDimensions = { ...baseDimensions };
      for (const id of ['reefHabitatCoralEvidence']) {
        scenarioDimensions[id] = scenario.available.includes(id)
          ? {
              ...syntheticSupportDimension(syntheticModel.DIMENSIONS.find(item => item.id === id), scenario.dimensions[id]),
              descriptiveCategory:'Synthetic score-sensitivity input',
              provenance:scenario.provenance,
              evidenceLevel:scenario.evidenceLevel,
              spatialSupport:{ mode:'controlled future-dimension sensitivity', status:'supported',
                sourceType:`synthetic ${scenario.provenance} scenario`, provenance:'scenario-only', confidenceFactor:scenario.confidenceFactor,
                notes:'Not an observation or production value.' }
            }
          : { isAvailable:false, experienceScore:null, spatialSupport:{ mode:'scenario input omitted', status:'not_assessed', confidenceFactor:0 } };
      }
      const future = syntheticModel.calculate({ location:site.sampledLocation, month:current.month, dimensions:scenarioDimensions });
      rows.push({
        location_id:site.id, location_label:site.label, month:current.month, scenario_id:scenario.id, scenario_label:scenario.label,
        synthetic_dimension_scores:JSON.stringify(scenario.dimensions), synthetic_dimensions_available:scenario.available.join('|'),
        synthetic_provenance_assumption:scenario.provenance, synthetic_evidence_assumption:scenario.evidenceLevel,
        current_score:current.score, future_score:future.score,
        score_delta:current.score == null || future.score == null ? null : future.score - current.score,
        current_label:current.label, future_label:future.label, label_changed:current.label !== future.label,
        current_confidence:current.confidence, future_confidence:future.confidence,
        current_confidence_value:current.confidenceValue, future_confidence_value:future.confidenceValue,
        current_completeness_pct:current.scoreCompletenessPercentage, future_completeness_pct:future.scoreCompletenessPercentage,
        current_dimensions_available:current.activeDimensions.length, future_dimensions_available:future.activeDimensions.length,
        newly_scored:current.score == null && future.score != null,
        note:'Synthetic score dimensions only; no reef observations supplied.'
      });
    }
  }
  return { rows, scenarios:REEF_HABITAT_EVIDENCE_SCENARIOS };
}

function equalScoreSupportDemonstration() {
  const activeIds = experienceModel.configuration().currentEnabledDimensions;
  const scenarios = [
    { score:55, sparseIds:['current','waveHeight','fishDensity','thermalStressHistory'] },
    { score:70, sparseIds:['current','waveHeight','fishDensity','thermalStressHistory'] },
    { score:85, sparseIds:['waterClarity','current','fishDensity','thermalStressHistory'] }
  ];
  const dimensionsForIds = (ids, score, evidenceProfile) => Object.fromEntries(experienceModel.DIMENSIONS.map(dimension => [dimension.id,
    dimension.isScoreDimension && ids.has(dimension.id) ? {
      ...syntheticSupportDimension(dimension, score),
      evidenceLevel:evidenceProfile.evidenceLevel,
      provenance:evidenceProfile.provenance,
      spatialSupport:{ ...syntheticSupportDimension(dimension, score).spatialSupport, confidenceFactor:evidenceProfile.supportFactor }
    } : { isAvailable:false, spatialSupport:{ status:'not_assessed' } }
  ]));
  const cases = scenarios.map(scenario => {
    const broad = experienceModel.calculate({ month:10, dimensions:dimensionsForIds(new Set(activeIds), scenario.score,
      { evidenceLevel:'high', provenance:'observed', supportFactor:0.95 }) });
    const sparse = experienceModel.calculate({ month:10, dimensions:dimensionsForIds(new Set(scenario.sparseIds), scenario.score,
      { evidenceLevel:'limited', provenance:'regional_estimate', supportFactor:0.65 }) });
    return {
      expectedScore:scenario.score,
      broaderEvidence:{ activeDimensions:broad.activeDimensions, score:broad.score, confidence:broad.confidence,
        confidenceValue:broad.confidenceValue, completenessPercentage:broad.scoreCompletenessPercentage },
      fewerDimensions:{ activeDimensions:sparse.activeDimensions, score:sparse.score, confidence:sparse.confidence,
        confidenceValue:sparse.confidenceValue, completenessPercentage:sparse.scoreCompletenessPercentage }
    };
  });
  return {
    label:'Synthetic same-score comparisons; none are location estimates.',
    cases,
    validation:{ allScoresMatch:cases.every(item => item.broaderEvidence.score === item.expectedScore && item.fewerDimensions.score === item.expectedScore),
      completenessDiffers:cases.every(item => item.broaderEvidence.completenessPercentage !== item.fewerDimensions.completenessPercentage),
      confidenceDiffers:cases.every(item => item.broaderEvidence.confidenceValue !== item.fewerDimensions.confidenceValue) }
  };
}

async function buildValidationSamples() {
  const { cells, reefData, reefExtentPercentByCell, fishOutlook } = await loadGridInputs();
  const { service, model } = loadApis();
  const thermalHistoryView = await createThermalHistoryView();
  const samples = [];
  const unsupportedFishCell = [...fishOutlook.entries()].find(([, row]) => row.tier === 'unknown' &&
    Number.isFinite(row.lat) && Number.isFinite(row.lng));
  const sites = [...LOCATIONS];
  if (unsupportedFishCell) {
    const [cellIndex, row] = unsupportedFishCell;
    sites.push({ id:'poor-data-ocean', label:'Poor-data check · NRMN-unsupported Arctic cell', lat:row.lat, lng:row.lng,
      expectedFishCellIndex:cellIndex, unsupportedReason:row.unsupportedReason });
  }
  for (const site of sites) {
    const nearest = closestCell(cells, site);
    const location = nearest.cell.location;
    const thermalHistory = await thermalHistoryAt(thermalHistoryView, location);
    const monthly = [];
    for (let month = 1; month <= 12; month += 1) {
      const conditions = await service.query(location, month);
      const dimensions = dimensionsFor(conditions, nearest.cell, { reefData, reefExtentPercentByCell, fishOutlook, thermalHistory }, model);
      monthly.push(experienceModel.calculate({ location, month, dimensions }));
    }
    const staticDimensions = experienceModel.SCORE_DIMENSIONS.filter(dimension => !dimension.isMonthSensitive).map(dimension => dimension.id);
    const staticSignatures = monthly.map(result => staticDimensions.map(id => {
      const row = result.dimensions.find(dimension => dimension.id === id);
      return [row?.rawValue, row?.descriptiveCategory, row?.experienceScore, row?.provenance, row?.isAvailable, row?.spatialSupport];
    }));
    const staticStable = staticSignatures.every(signature => JSON.stringify(signature) === JSON.stringify(staticSignatures[0]));
    const seasonalSignatures = monthly.map(result => result.dimensions
      .filter(row => row.isMonthSensitive)
      .map(row => [row.id, row.rawValue, row.experienceScore]));
    const seasonalValuesVary = seasonalSignatures.some(signature => JSON.stringify(signature) !== JSON.stringify(seasonalSignatures[0]));
    const monthOnlyChangesSeasonalDimensions = monthly.every(result => result.dimensions
      .filter(row => !row.isMonthSensitive).every(row => {
        const baseline = monthly[0].dimensions.find(item => item.id === row.id);
        return JSON.stringify([row.rawValue, row.experienceScore, row.isAvailable, row.spatialSupport]) ===
          JSON.stringify([baseline.rawValue, baseline.experienceScore, baseline.isAvailable, baseline.spatialSupport]);
      }));
    samples.push({
      id:site.id,
      label:site.label,
      requestedLocation:{ lat:site.lat, lng:site.lng },
      sampledLocation:{ lat:location.lat, lng:location.lng },
      gridSnapDistanceKm:Number(nearest.distanceKm.toFixed(1)),
      monthly,
      validation:{ staticEcologyUnchangedAcrossMonths:staticStable, monthOnlyChangesSeasonalDimensions,
        fishAndThermalUnchangedAcrossMonths:staticStable,
        fishOutlookUnsupportedAtSample:site.expectedFishCellIndex === nearest.cell.index,
        monthSensitiveValuesVaryAcrossSampledMonths:seasonalValuesVary,
        fishUnsupportedReason:site.unsupportedReason || null,
        thermalHistoryPresent:monthly.every(result => result.dimensions.find(item => item.id === 'thermalStressHistory')?.isAvailable === Boolean(thermalHistory)),
        reefHabitatEvidenceAvailableWithBothInputs:monthly.every(result => {
          const dimension = result.dimensions.find(item => item.id === 'reefHabitatCoralEvidence');
          return dimension?.isAvailable === true && dimension?.experienceScore != null;
        }) }
    });
  }
  const samplePath = path.join(OUTPUT, 'validation_samples.json');
  await fs.mkdir(OUTPUT, { recursive:true });
  const { comparisonRows, sensitivityRows, normalizationSummary, syntheticSummary } = buildSensitivityArtifacts(samples);
  const futureSensitivity = buildReefHabitatEvidenceSensitivity(samples);
  const comparisonCsv = csvTable([
    'location_id','month','block_preserving_score','legacy_global_normalized_score','score_delta_block_minus_legacy',
    'confidence','confidence_value','score_completeness_pct','physical_group_score','physical_group_completeness_pct',
    'ecological_group_score','ecological_group_completeness_pct','active_dimensions','unavailable_dimensions'
  ], comparisonRows);
  const sensitivityCsv = csvTable([
    'location_id','month','synthetic_reef_evidence_index','current_block_score','scenario_block_score','score_delta',
    'current_completeness_pct','scenario_completeness_pct','current_ecological_group_score','scenario_ecological_group_score','scenario_note'
  ], sensitivityRows);
  await fs.writeFile(path.join(OUTPUT, 'normalization_comparison.csv'), comparisonCsv);
  await fs.writeFile(path.join(OUTPUT, 'synthetic_reef_habitat_evidence_sensitivity.csv'), sensitivityCsv);
  const futureSensitivityCsv = csvTable(Object.keys(futureSensitivity.rows[0] || {}), futureSensitivity.rows.map(row => Object.values(row)));
  await fs.writeFile(path.join(OUTPUT, 'synthetic_reef_habitat_evidence_scenarios.csv'), futureSensitivityCsv);
  await fs.writeFile(path.join(OUTPUT, 'reef_habitat_evidence_scenarios.json'), `${JSON.stringify({
    caveat:'Scenario inputs are synthetic dimension score values (not reef measurements) used only for sensitivity analysis.',
    interpretation:'Higher scores mean a more favorable contribution for the named dimension; pending score-to-observation mappings remain undefined.',
    scenarios:futureSensitivity.scenarios
  }, null, 2)}\n`);
  const demonstration = equalScoreSupportDemonstration();
  await fs.writeFile(samplePath, `${JSON.stringify({
    prototype:'Dive Experience Outlook',
    generatedAt:new Date().toISOString(),
    source:'Local DiveAtlas environmental datasets and the separate NRMN fish-outlook experiment.',
    caveat:'Review prototype only. Scores are consumer guidance, not a safety or reef-health rating.',
    configuration:experienceModel.configuration(),
    equalScoreEvidenceDemonstration:demonstration,
    normalizationSummary,
    syntheticFutureDimensionSummary:syntheticSummary,
    syntheticRealisticReefEvidenceScenarios:futureSensitivity.scenarios.map(scenario => ({
      id:scenario.id, label:scenario.label, scores:scenario.dimensions, available:scenario.available,
      provenanceAssumption:scenario.provenance, evidenceAssumption:scenario.evidenceLevel,
      confidenceFactorAssumption:scenario.confidenceFactor
    })),
    locations:samples
  }, null, 2)}\n`);
  const mapManifestPath = path.join(MAP_OUTPUT, 'manifest.json');
  let mapManifest = null;
  try { mapManifest = JSON.parse(await fs.readFile(mapManifestPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const sampleMonth = 10;
  const mapTableLines = mapManifest?.months?.length
    ? [
        '| Month | Scored cells | Eligible ocean cells | Coverage | Mean completeness | Confidence tiers |',
      '|---|---:|---:|---:|---:|---|',
      ...mapManifest.months.map(entry => {
        const monthName = new Intl.DateTimeFormat('en', { month:'long', timeZone:'UTC' })
          .format(new Date(Date.UTC(2020, entry.month - 1, 1)));
        return `| ${monthName} | ${entry.scoredCells.toLocaleString()} | ${entry.totalEligibleOceanCells.toLocaleString()} | ${(entry.scoredCells / entry.totalEligibleOceanCells * 100).toFixed(1)}% | ${entry.meanScoreCompletenessPercentage ?? '—'}% | ${Object.entries(entry.confidenceCounts).map(([label, count]) => `${label}: ${count.toLocaleString()}`).join(', ')} |`;
      })
    ]
    : ['No global prototype map has been generated yet.'];
  const markdown = [
    '# Dive Experience Outlook validation results',
    '',
    `Generated ${new Date().toISOString()}. Sample scores use the existing monthly samplers, fish outlook table, and 0.5° water mask. These are prototype outputs, not deployed production scores.`,
    '',
    '| Case | Sampled coordinates | October score | Confidence | Completeness | Physical group | Ecological group | Validation |',
    '|---|---:|---|---|---:|---:|---:|---|',
    ...samples.map(site => {
      const result = site.monthly.find(item => item.month === sampleMonth);
      const score = result.score == null ? 'No reliable score' : `${result.score} / ${result.label}`;
      const checks = [site.validation.staticEcologyUnchangedAcrossMonths ? 'static ecology stable' : 'static ecology changed',
        site.validation.monthOnlyChangesSeasonalDimensions ? 'only month-sensitive dimensions vary' : 'non-seasonal dimension changed',
        site.validation.monthSensitiveValuesVaryAcrossSampledMonths ? 'monthly values vary' : 'no monthly variation in these sources',
        site.validation.fishOutlookUnsupportedAtSample ? 'fish unsupported' : 'fish outlook available',
        site.validation.reefHabitatEvidenceAvailableWithBothInputs ? 'reef evidence index available' : 'reef evidence index unavailable'].join('; ');
      const physical = result.groups.find(group => group.id === 'physicalExperience');
      const ecological = result.groups.find(group => group.id === 'reefEcologicalExperience');
      return `| ${site.label} | ${site.sampledLocation.lat.toFixed(3)}, ${site.sampledLocation.lng.toFixed(3)} | ${score} | ${result.confidence} (${result.confidenceValue}) | ${result.scoreCompletenessPercentage}% | ${physical.completenessPercentage}% | ${ecological.completenessPercentage}% | ${checks} |`;
    }),
    '',
    '## Global map prototype',
    '',
    ...mapTableLines,
    '',
    '## Interpretation',
    '',
    '- Legacy comparison uses the prior global normalization across whatever score dimensions were available. The current model source uses physical 65 and ecological 35 macro-weight units (65% / 35%), with normalization confined to each group.',
    '- Physical weights are clarity 20, current 15, waves 15, and temperature 15 (65 total). Ecological weights are Reef habitat & coral evidence 15, fish abundance 10, and thermal stress history 10 (35 total). The evidence dimension combines wet-cell mapped reef-footprint share and the Coral Records relative rank; it is not a cover or condition measurement. The 0.5° prototype grid does not yet supply the reef-footprint share, so the dimension remains unavailable until that real input is connected.',
    '- Overall completeness is the macro-weighted fraction of available internal group weight. Confidence separately combines evidence, provenance, and spatial-support factors; it is an evidence tier/value, not a calibrated probability.',
    '- A score is shown only when both groups have evidence, at least three score dimensions are active, and total completeness reaches 40%.',
    '- The poor-data case is an Arctic cell where the NRMN fish outlook is explicitly unsupported. The ecology group has no supported dimension there, so the overall score is suppressed instead of letting physical conditions stand in for it.',
    '- NOAA annual-maximum DHW history is included when at least six years are available. Its score bands are a product heuristic about accumulated heat-stress history, not evidence that bleaching or mortality occurred.',
    '- Coral Records remains visible as support metadata. The Reef habitat & coral evidence index stays unavailable without both real components; observed bleaching and macroalgae are not scoring dimensions.',
    '- Fish output is a relative outlook rank from a positive-record target, not an unconditional density prediction. Tier B is kept at Moderate evidence.',
    '- Each dimension carries a versioned spatial-support record. Distance changes confidence only. Tier B basin shrinkage is identified, but its basin ID and water-connectivity component are absent from the source table; the coarse 7 km connectivity diagnostic is not used.',
    '- `normalization_comparison.csv` contains every representative location × 12 months. `synthetic_reef_habitat_evidence_sensitivity.csv` varies the index at fixed artificial scores of 0, 50, and 100 only; these values are never treated as observations.',
    `- Three same-score evidence checks: scores match ${demonstration.validation.allScoresMatch ? 'in all cases' : 'failed'}; completeness differs ${demonstration.validation.completenessDiffers ? 'in all cases' : 'no'}, confidence value differs ${demonstration.validation.confidenceDiffers ? 'in all cases' : 'no'}.`,
    `- Paired old/new normalization comparisons: ${normalizationSummary.pairedSitesMonths} location-months; block-preserving minus legacy score mean ${normalizationSummary.meanScoreDelta}, range ${normalizationSummary.minimumScoreDelta} to ${normalizationSummary.maximumScoreDelta}; ${normalizationSummary.unscoredSitesMonths} location-months have no block-preserving overall score.`,
    '',
    '| Synthetic evidence-index score | Paired location-months | Mean score change | Range | Newly scored where current is unavailable |',
    '|---:|---:|---:|---:|---:|',
    ...syntheticSummary.map(summary => `| ${summary.syntheticScore} | ${summary.pairedSitesMonths} | ${summary.meanScoreDelta ?? '—'} | ${summary.minimumScoreDelta ?? '—'} to ${summary.maximumScoreDelta ?? '—'} | ${summary.newlyScoredSitesMonths} |`),
    '- Land is excluded by the copied bathymetry-derived subcell mask; map payloads store score, confidence, total and group completeness, and an active-dimension bit mask.'
  ].join('\n');
  await fs.writeFile(path.join(OUTPUT, 'validation_results.md'), `${markdown}\n`);
  console.log(`Wrote ${samples.length} real-data location samples across 12 months to ${path.relative(ROOT, samplePath)}.`);
  for (const site of samples) {
    const october = site.monthly[9];
    console.log(`${site.label}: ${october.score == null ? 'No reliable overall score' : `${october.score} / ${october.label}`} · ${october.confidence} confidence · ${october.scoreCompletenessPercentage}% complete · ${october.activeScoringDimensionCount}/9 score dimensions`);
  }
}

function createMapAsset(month, scores, physicalScores, overallConfidence, physicalConfidence, ecologicalConfidence,
  completeness, physicalCompleteness, ecologicalCompleteness, activeMasks) {
  const count = scores.length;
  if (count !== CELL_COUNT) throw new Error(`Dive Experience map grid must contain exactly ${CELL_COUNT} cells.`);
  for (const field of [physicalScores, overallConfidence, physicalConfidence, ecologicalConfidence,
    completeness, physicalCompleteness, ecologicalCompleteness, activeMasks]) {
    if (!field || field.length !== count) throw new Error('Dive Experience map arrays must share one cell count.');
  }
  const bytes = Buffer.alloc(16 + count * 10);
  bytes.write('DAEO', 0, 'ascii');
  bytes.writeUInt8(3, 4);
  bytes.writeUInt8(month, 5);
  bytes.writeUInt16LE(GRID.width, 6);
  bytes.writeUInt16LE(GRID.height, 8);
  bytes.writeUInt16LE(Math.round(GRID.step * 100), 10);
  bytes.writeInt16LE(Math.round(GRID.west * 10), 12);
  bytes.writeInt16LE(Math.round(GRID.south * 10), 14);
  Buffer.from(scores).copy(bytes, 16);
  Buffer.from(physicalScores).copy(bytes, 16 + count);
  Buffer.from(overallConfidence).copy(bytes, 16 + count * 2);
  Buffer.from(physicalConfidence).copy(bytes, 16 + count * 3);
  Buffer.from(ecologicalConfidence).copy(bytes, 16 + count * 4);
  Buffer.from(completeness).copy(bytes, 16 + count * 5);
  Buffer.from(physicalCompleteness).copy(bytes, 16 + count * 6);
  Buffer.from(ecologicalCompleteness).copy(bytes, 16 + count * 7);
  for (let index = 0; index < count; index += 1) bytes.writeUInt16LE(activeMasks[index], 16 + count * 8 + index * 2);
  return zlib.gzipSync(bytes, { level:9 });
}

function createThermalGridAsset(scores, validYears, means) {
  const bytes = Buffer.alloc(16 + CELL_COUNT * 4);
  bytes.write('DAEH', 0, 'ascii');
  bytes.writeUInt8(1, 4);
  bytes.writeUInt8(0, 5);
  bytes.writeUInt16LE(GRID.width, 6);
  bytes.writeUInt16LE(GRID.height, 8);
  bytes.writeUInt16LE(Math.round(GRID.step * 100), 10);
  bytes.writeInt16LE(Math.round(GRID.west * 10), 12);
  bytes.writeInt16LE(Math.round(GRID.south * 10), 14);
  Buffer.from(scores).copy(bytes, 16);
  Buffer.from(validYears).copy(bytes, 16 + CELL_COUNT);
  const meanOffset = 16 + CELL_COUNT * 2;
  for (let index = 0; index < CELL_COUNT; index += 1) bytes.writeUInt16LE(means[index], meanOffset + index * 2);
  return zlib.gzipSync(bytes, { level:9 });
}

function parseThermalGridAsset(packed) {
  const bytes = zlib.gunzipSync(packed);
  if (bytes.length !== 16 + CELL_COUNT * 4 || bytes.toString('ascii', 0, 4) !== 'DAEH' || bytes.readUInt8(4) !== 1 ||
      bytes.readUInt16LE(6) !== GRID.width || bytes.readUInt16LE(8) !== GRID.height ||
      bytes.readUInt16LE(10) !== Math.round(GRID.step * 100) || bytes.readInt16LE(12) !== Math.round(GRID.west * 10) ||
      bytes.readInt16LE(14) !== Math.round(GRID.south * 10)) throw new Error('Invalid NOAA thermal-history grid cache.');
  const meanOffset = 16 + CELL_COUNT * 2;
  const means = new Uint16Array(CELL_COUNT);
  for (let index = 0; index < CELL_COUNT; index += 1) means[index] = bytes.readUInt16LE(meanOffset + index * 2);
  return Object.freeze({
    scores:new Uint8Array(bytes.buffer, bytes.byteOffset + 16, CELL_COUNT),
    validYears:new Uint8Array(bytes.buffer, bytes.byteOffset + 16 + CELL_COUNT, CELL_COUNT),
    means
  });
}

function thermalHistoryRecord(grid, cellIndex, source, location, sourceGrid) {
  const score = grid.scores[cellIndex];
  const meanCode = grid.means[cellIndex];
  if (score > 100 || meanCode === 65535 || grid.validYears[cellIndex] < 6) return null;
  const meanDhw = meanCode / 100;
  const classification = experienceModel.scoreThermalHistory(meanDhw);
  if (!classification) return null;
  const normalizeLongitude = value => ((Number(value) + 180) % 360 + 360) % 360 - 180;
  const sourceLatitude = sourceGrid.latitude_min + Math.round((location.lat - sourceGrid.latitude_min) / sourceGrid.latitude_step) * sourceGrid.latitude_step;
  const sourceLongitude = normalizeLongitude(sourceGrid.longitude_min + Math.round((normalizeLongitude(location.lng) - sourceGrid.longitude_min) / sourceGrid.longitude_step) * sourceGrid.longitude_step);
  return { meanDhw, validYears:grid.validYears[cellIndex], score, category:classification.category, source,
    sourceLocation:{ lat:sourceLatitude, lng:sourceLongitude },
    sampleDistanceKm:gridBuilder.distanceKm(location.lat, location.lng, sourceLatitude, sourceLongitude) };
}

async function createThermalHistoryGrid(cells, view, destination) {
  const scores = new Uint8Array(CELL_COUNT).fill(255);
  const validYears = new Uint8Array(CELL_COUNT);
  const means = new Uint16Array(CELL_COUNT).fill(65535);
  const latestYear = view.mapMetadata.years.at(-1);
  const source = `NOAA CoralTemp annual maximum DHW history (${view.mapMetadata.years[0]}–${latestYear})`;
  for (let position = 0; position < cells.length; position += 1) {
    const cell = cells[position];
    const history = await thermalHistoryAt(view, cell.location);
    if (history) {
      scores[cell.index] = history.score;
      validYears[cell.index] = history.validYears;
      means[cell.index] = Math.min(65534, Math.round(history.meanDhw * 100));
    }
    if ((position + 1) % 5000 === 0) console.log(`Thermal history: ${position + 1}/${cells.length} cells sampled.`);
  }
  await fs.writeFile(destination, createThermalGridAsset(scores, validYears, means));
  return { grid:{ scores, validYears, means }, source };
}

async function buildMap(month, limitCells = 0) {
  const { oceanMask, cells, reefData, reefExtentPercentByCell, fishOutlook } = await loadGridInputs();
  const { service, model } = loadApis();
  const thermalHistoryView = await createThermalHistoryView();
  await fs.mkdir(MAP_OUTPUT, { recursive:true });
  await fs.copyFile(path.join(ROOT, 'data', 'dive_conditions_score', 'ocean-mask.bin.gz'), path.join(MAP_OUTPUT, 'ocean-mask.bin.gz'));
  const scores = new Uint8Array(CELL_COUNT).fill(255);
  const physicalScores = new Uint8Array(CELL_COUNT).fill(255);
  const overallConfidence = new Uint8Array(CELL_COUNT);
  const physicalConfidence = new Uint8Array(CELL_COUNT);
  const ecologicalConfidence = new Uint8Array(CELL_COUNT);
  const completeness = new Uint8Array(CELL_COUNT);
  const physicalCompleteness = new Uint8Array(CELL_COUNT);
  const ecologicalCompleteness = new Uint8Array(CELL_COUNT);
  const activeMasks = new Uint16Array(CELL_COUNT);
  const dimensionBit = Object.fromEntries(experienceModel.SCORE_DIMENSIONS.map((dimension, index) => [dimension.id, 1 << index]));
  const selectedCells = limitCells > 0 && limitCells < cells.length
    ? Array.from({ length:limitCells }, (_, index) => cells[Math.floor(index * cells.length / limitCells)]) : cells;
  const sourceVersion = String(thermalHistoryView.mapMetadata.release || thermalHistoryView.mapMetadata.version || 'noaa-crw');
  const thermalScoringKey = crypto.createHash('sha256').update(JSON.stringify({
    sourceVersion,
    years:thermalHistoryView.mapMetadata.years,
    grid:GRID,
    minimumValidYears:6,
    bands:experienceModel.configuration().thermalHistoryExperienceHeuristic
  })).digest('hex').slice(0, 12);
  const thermalCacheName = `thermal-history-${sourceVersion.replace(/[^a-z0-9._-]/gi, '_')}-${thermalScoringKey}.bin.gz`;
  const thermalCachePath = path.join(MAP_OUTPUT, thermalCacheName);
  let thermalGrid = null;
  let thermalSource = `NOAA CoralTemp annual maximum DHW history (${thermalHistoryView.mapMetadata.years[0]}–${thermalHistoryView.mapMetadata.years.at(-1)})`;
  if (limitCells > 0 && limitCells < cells.length) {
    thermalGrid = { sparse:new Map() };
    for (const cell of selectedCells) thermalGrid.sparse.set(cell.index, await thermalHistoryAt(thermalHistoryView, cell.location));
  } else {
    try { thermalGrid = { dense:parseThermalGridAsset(await fs.readFile(thermalCachePath)) }; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const built = await createThermalHistoryGrid(cells, thermalHistoryView, thermalCachePath);
      thermalGrid = { dense:built.grid };
      thermalSource = built.source;
    }
  }
  const confidenceCounts = { High:0, Moderate:0, Limited:0, Low:0 };
  const completenessSums = { overall:0, physical:0, ecological:0 };
  let scored = 0;
  let physicalScored = 0;
  let nearbyTemperatureEstimateCells = 0;
  for (let start = 0; start < selectedCells.length; start += 1) {
    const cell = selectedCells[start];
    const conditions = await service.query(cell.location, month);
    const history = thermalGrid.sparse ? thermalGrid.sparse.get(cell.index)
      : thermalHistoryRecord(thermalGrid.dense, cell.index, thermalSource, cell.location, thermalHistoryView.mapMetadata.grid);
    const dimensions = dimensionsFor(conditions, cell, { reefData, reefExtentPercentByCell, fishOutlook, thermalHistory:history }, model);
    if (dimensions.waterTemperature?.provenance === 'regional_estimate' && dimensions.waterTemperature.isAvailable) {
      nearbyTemperatureEstimateCells += 1;
    }
    const result = experienceModel.calculate({ location:cell.location, month, dimensions });
    const physical = result.groups.find(group => group.id === 'physicalExperience');
    const ecological = result.groups.find(group => group.id === 'reefEcologicalExperience');
    overallConfidence[cell.index] = Math.round(result.confidenceValue * 255);
    physicalConfidence[cell.index] = Math.round(physical.confidenceValue * 255);
    ecologicalConfidence[cell.index] = Math.round(ecological.confidenceValue * 255);
    completeness[cell.index] = Math.round(result.scoreCompletenessPercentage);
    physicalCompleteness[cell.index] = Math.round(physical.completenessPercentage);
    ecologicalCompleteness[cell.index] = Math.round(ecological.completenessPercentage);
    activeMasks[cell.index] = result.activeDimensions.reduce((mask, id) => mask | dimensionBit[id], 0);
    completenessSums.overall += result.scoreCompletenessPercentage;
    completenessSums.physical += physical.completenessPercentage;
    completenessSums.ecological += ecological.completenessPercentage;
    if (result.score != null) {
      scores[cell.index] = result.score;
      confidenceCounts[result.confidence] += 1;
      scored += 1;
    }
    if (result.diveConditionsScore != null) {
      physicalScores[cell.index] = result.diveConditionsScore;
      physicalScored += 1;
    }
    if ((start + 1) % 2500 === 0) console.log(`Month ${month}: ${start + 1}/${selectedCells.length} ocean cells sampled; ${scored} scored.`);
  }
  const assetName = `month-${String(month).padStart(2, '0')}.bin.gz`;
  await fs.writeFile(path.join(MAP_OUTPUT, assetName), createMapAsset(month, scores, physicalScores, overallConfidence,
    physicalConfidence, ecologicalConfidence, completeness, physicalCompleteness, ecologicalCompleteness, activeMasks));
  const manifestPath = path.join(MAP_OUTPUT, 'manifest.json');
  let manifest = { format:'diveatlas-dive-experience-prototype-grid', version:3,
    grid:{ ...GRID, cellCenterOffset:GRID.step / 2, missingValue:255 },
    oceanMask:{ file:'ocean-mask.bin.gz', samplesPerAxis:8, minimumOceanFraction:0.25,
      source:'Existing bathymetry-derived ocean mask; water subcells only are painted.' },
    scoring:{ ...experienceModel.configuration(), physicalDimensionScoreBands:conditionsModel.SCORE_BANDS }, sources:[
      'Local Dive Conditions monthly climatologies and ocean-model samples',
      'NRMN Fish Abundance Outlook analysis table; Tier A/B only',
    'UNEP-WCMC mapped reef extent and Coral Records relative-rank grid; combined as Reef habitat & coral evidence index, not live-coral cover',
      `NOAA CoralTemp annual-maximum DHW history, averaged across available years from ${thermalHistoryView.mapMetadata.years[0]}–${thermalHistoryView.mapMetadata.years.at(-1)}`
    ], months:[] };
  try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  manifest.scoring = { ...experienceModel.configuration(), physicalDimensionScoreBands:conditionsModel.SCORE_BANDS };
  manifest.format = 'diveatlas-dive-experience-prototype-grid';
  manifest.version = 3;
  manifest.encoding = {
    version:3, headerBytes:16,
    fields:[
      { id:'overallExperienceScore', type:'uint8', missing:255 },
      { id:'diveConditionsScore', type:'uint8', missing:255, fallbackThresholds:experienceModel.configuration().physicalFallback },
      { id:'overallConfidenceValue', type:'uint8', scale:'0-255 maps to 0-1 evidence quality' },
      { id:'physicalConfidenceValue', type:'uint8', scale:'0-255 maps to 0-1 evidence quality' },
      { id:'ecologicalConfidenceValue', type:'uint8', scale:'0-255 maps to 0-1 evidence quality' },
      { id:'scoreCompletenessPercentage', type:'uint8', range:[0,100] },
      { id:'physicalGroupCompletenessPercentage', type:'uint8', range:[0,100] },
      { id:'ecologicalGroupCompletenessPercentage', type:'uint8', range:[0,100] },
      { id:'activeDimensionMask', type:'uint16le', bitOrder:experienceModel.SCORE_DIMENSIONS.map(dimension => dimension.id) }
    ],
    opacity:'Render experiment only. Score remains the color hue; the current default candidate is alpha=(0.62+0.38*evidenceQuality)*(0.90+0.10*scoreCompleteness).'
  };
  manifest.sources = [
    'Local Dive Conditions monthly climatologies and ocean-model samples',
    'NRMN Fish Abundance Outlook analysis table; Tier A/B only',
    'UNEP-WCMC mapped reef extent and Coral Records relative-rank grid; combined as Reef habitat & coral evidence index, not live-coral cover',
    thermalSource
  ];
  manifest.oceanMissingDataEstimation = {
    status:'analysis_only_unvalidated',
    dimension:'waterTemperature',
    directRule:'Nearest valid WOA23 same-month 5 m source cell within 25 km.',
    fallbackRule:'If direct sampling is unavailable, use the nearest valid WOA23 same-month 5 m source cell within 100 km.',
    fallbackProvenance:'regional_estimate',
    fallbackEvidenceLevel:'limited',
    scoreRule:'Apply the existing temperature raw-value score bands; do not apply confidence as a score penalty.',
    confidenceRule:'Use limited evidence, regional_estimate provenance strength, and the existing distance-based spatial-support confidence factor.',
    validation:'The 100 km fallback has not passed spatially blocked holdout validation and is excluded from production publication.'
  };
  manifest.generatedAt = new Date().toISOString();
  manifest.months = manifest.months.filter(entry => entry.month !== month);
  manifest.months.push({ month, scoredCells:scored, physicalOnlyCells:physicalScored,
    physicalFallbackOnlyCells:physicalScored - scored, nearbyTemperatureEstimateCells,
    processedOceanCells:selectedCells.length, totalEligibleOceanCells:cells.length,
    meanScoreCompletenessPercentage:Number((completenessSums.overall / Math.max(1, selectedCells.length)).toFixed(1)),
    meanPhysicalGroupCompletenessPercentage:Number((completenessSums.physical / Math.max(1, selectedCells.length)).toFixed(1)),
    meanEcologicalGroupCompletenessPercentage:Number((completenessSums.ecological / Math.max(1, selectedCells.length)).toFixed(1)),
    confidenceCounts, asset:assetName, partial:limitCells > 0 && limitCells < cells.length });
  manifest.thermalHistoryCache = limitCells > 0 && limitCells < cells.length ? null : thermalCacheName;
  manifest.months.sort((a, b) => a.month - b.month);
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, path.join(MAP_OUTPUT, assetName))}; ${scored}/${selectedCells.length} sampled cells scored. ${oceanMask.length.toLocaleString()} ocean-mask subcell bytes retained.`);
}

function parseArgs(argv) {
  const option = name => argv.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
  return { map:argv.includes('--map'), allMonths:argv.includes('--all-months'), viewerOnly:argv.includes('--viewer-only'), month:Number(option('--month') || 10), limitCells:Number(option('--limit-cells') || 0) };
}

async function writeScoringMapViewer() {
  await fs.mkdir(SCORE_MAP_OUTPUT, { recursive:true });
  let html = await fs.readFile(path.join(OUTPUT, 'prototype-map.html'), 'utf8');
  html = html
    .replace('<title>Dive Experience Outlook map · Prototype</title>', '<title>Dive Experience Scoring Map · Analysis</title>')
    .replace('<h1>Dive Experience Outlook</h1>', '<h1>Dive Experience Scoring Map · v5 analysis</h1>')
    .replace('Color communicates experience score. Compare evidence fading and score completeness separately; ecological gaps do not turn the Dive Conditions Score into an overall outlook.', 'Analysis-only map using seven weighted dimensions and the current Dive Experience score/confidence guides. Evidence quality and completeness remain separate from the experience score.')
    .replace('<label>Palette<select id="palette"><option value="viridis">Viridis · recommended</option><option value="soft">Soft clay · amber · green</option></select></label>', '<label>Palette<select id="palette"><option value="viridis-reversed">Viridis reversed · yellow poor → purple good</option><option value="red-blue">Red → blue · poor → good</option><option value="viridis">Viridis</option><option value="soft">Soft clay · amber · green</option></select></label>')
    .replace('><a href="./prototype-inspector.html">Open location inspector</a>', '>')
    .replace('<span>Challenging · 0</span><span>Excellent · 100</span>', '<span>Challenging · 0 · less favorable</span><span>Excellent · 100 · more favorable</span>')
    .replace('aria-label="Prototype world score map"', 'aria-label="Analysis-only world score map; lower scores are less favorable and higher scores are more favorable"')
    .replace('Analysis-only 0.5° prototype. The water mask comes from the existing bathymetry-derived 8×8 cell samples. Do not use as a safety or reef-health rating.', 'Analysis-only 0.5° scoring map. The default reversed Viridis palette maps lemon yellow to less favorable scores and dark purple-blue to more favorable scores. Palette color does not indicate safety. Reef habitat & coral evidence combines mapped reef footprint and Coral Records relative rank; it is not live-coral cover or reef health.')
    .replace('    const palettes={\n      viridis:', '    const palettes={\n      \'viridis-reversed\':[[0,[253,231,37]],[50,[33,145,140]],[100,[68,1,84]]],\n      \'red-blue\':[[0,[178,24,43]],[50,[247,247,247]],[100,[33,102,172]]],\n      viridis:');
  await fs.writeFile(path.join(SCORE_MAP_OUTPUT, 'prototype-map.html'), html);
  const readme = `# Dive Experience Scoring Map v2\n\nThis reproducible, analysis-only map applies the score and confidence guides to the seven-dimension Dive Experience model. It remains separate from production assets.\n\n## Open the map\n\nServe the project root with a local static server and open \`/analysis/dive-experience-scoring-map-v2/prototype-map.html\`. Choose a month and map mode in the viewer.\n\n## Rebuild\n\nFrom the project root, run:\n\n\`\`\`powershell\nnode tools/build_dive_experience_outlook_prototype.js --map --all-months\n\`\`\`\n\nThe command writes monthly grids to \`generated/map/\` and refreshes this viewer. It does not write to \`_site/\` or production data.\n\n## Missing temperature data\n\nDirect valid WOA23 monthly 5 m cells are used within 25 km. Where none is found, an analysis-only sensitivity fallback uses the nearest valid same-month, 5 m WOA23 cell within 100 km. That fallback is marked \`regional_estimate\`, limited evidence, and limited spatial support; confidence is reduced through the configured support factor, while the score is determined only by the sampled temperature and the temperature rubric. The 100 km limit has not been validated with spatial holdouts and must not be published as production behavior until it passes that validation. If no valid cell is found within 100 km, temperature remains unavailable.\n\n## Fixed score model\n\n| Dimension | Weight | Stages |\n|---|---:|---:|\n| Water clarity | 20 | 7 |\n| Current | 15 | 7 |\n| Wave height | 15 | 7 |\n| Water temperature | 15 | 7 |\n| Reef habitat & coral evidence | 15 | 7 |\n| Fish abundance outlook | 10 | 7 |\n| Thermal stress history | 10 | 7 |\n| **Total** | **100** | |\n\nThe physical and ecological score groups retain their configured 65:35 influence. Missing dimensions remain unavailable within their own group. Confidence describes evidence quality; completeness describes available score weight. Neither is folded into the score.\n\n## Interpretation limits\n\nThe seven bands are documented experience heuristics, not empirically calibrated diver-satisfaction probabilities. Reef habitat & coral evidence is a proxy built from mapped reef footprint and an effort-sensitive Coral Records relative rank; it is not a measurement of live coral cover, reef health, or local coral abundance. NRMN fish outlook is conditional on recorded survey units, and thermal stress is historical context. The score does not assess dive safety or current conditions.\n`;
  await fs.writeFile(path.join(SCORE_MAP_OUTPUT, 'README.md'), readme);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.viewerOnly) return writeScoringMapViewer();
  if (!Number.isInteger(options.month) || options.month < 1 || options.month > 12) throw new RangeError('--month must be 1..12.');
  if (options.map) {
    await writeScoringMapViewer();
    if (options.allMonths) {
      for (let month = 1; month <= 12; month += 1) await buildMap(month, options.limitCells);
      return;
    }
    return buildMap(options.month, options.limitCells);
  }
  return buildValidationSamples();
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = Object.freeze({ parseCsvRow, fishDimension, confidenceCode, createMapAsset, dimensionsFor });
