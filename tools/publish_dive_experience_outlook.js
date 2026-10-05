#!/usr/bin/env node
'use strict';

// Publish the accepted analysis grids as a small, versioned runtime package.
// The large training table and the analysis report remain outside the site.
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const modelApi = require('../js/dive-experience-model.js');
const conditionsModel = require('../js/dive-conditions-model.js');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'analysis', 'dive-experience-scoring-map-v2', 'generated', 'map');
const DESTINATION = path.join(ROOT, 'data', 'dive-experience-outlook', 'v3');
const WIDTH = 720;
const HEIGHT = 340;
const CELL_COUNT = WIDTH * HEIGHT;
const MONTH_BYTES = 16 + CELL_COUNT * 10;
const SUPPORT_BYTES = 16 + CELL_COUNT * 20;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function validateGridHeader(bytes, magic, version, expectedLength) {
  if (bytes.length !== expectedLength || bytes.toString('ascii', 0, 4) !== magic || bytes.readUInt8(4) !== version ||
      bytes.readUInt16LE(6) !== WIDTH || bytes.readUInt16LE(8) !== HEIGHT || bytes.readUInt16LE(10) !== 50 ||
      bytes.readInt16LE(12) !== -1800 || bytes.readInt16LE(14) !== -850) {
    throw new Error(`${magic} grid asset has an invalid header or length.`);
  }
}

function monthCoverage(bytes) {
  validateGridHeader(bytes, 'DAEO', 3, MONTH_BYTES);
  const scores = bytes.subarray(16, 16 + CELL_COUNT);
  const physical = bytes.subarray(16 + CELL_COUNT, 16 + CELL_COUNT * 2);
  const completeness = bytes.subarray(16 + CELL_COUNT * 5, 16 + CELL_COUNT * 6);
  let scoredCells = 0;
  let physicalCells = 0;
  let physicalFallbackOnlyCells = 0;
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const hasScore = scores[index] <= 100;
    const hasPhysical = physical[index] <= 100;
    if (hasScore) scoredCells += 1;
    if (hasPhysical) physicalCells += 1;
    if (!hasScore && hasPhysical) physicalFallbackOnlyCells += 1;
  }
  return {
    scoredCells, physicalConditionCells:physicalCells, physicalFallbackOnlyCells,
    meanCompletenessPercentage:Number((completeness.reduce((sum, value, index) => sum +
      (scores[index] <= 100 ? value : 0), 0) / Math.max(1, scoredCells)).toFixed(1))
  };
}

function runtimeMetadata(prototype, entries, hashes) {
  const configuration = modelApi.createDiveExperienceModel().configuration();
  const scoringVersion = configuration.scoringVersion;
  const thresholdVersion = 'experience-labels-provisional-2026-10';
  const dataVersion = `sha256-${sha256(Buffer.from(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b))
    .map(([name, hash]) => `${name}:${hash}`).join('\n'))).slice(0, 20)}`;
  return {
    format:'diveatlas-dive-experience-outlook',
    schemaVersion:1,
    scoringVersion,
    thresholdVersion,
    dataVersion,
    generatedAt:new Date().toISOString(),
    grid:{ ...prototype.grid },
    oceanMask:{ file:'ocean-mask.bin.gz', samplesPerAxis:8, minimumOceanFraction:0.25,
      classification:'Scores are rendered only inside ocean subcells from the bathymetry-derived mask.' },
    scoring:{
      overallThresholds:configuration.overallThresholds,
      physicalConditionThresholds:configuration.physicalConditionThresholds,
      confidenceThresholds:configuration.confidenceThresholds,
      minimumRequirements:{ minimumActiveDimensions:configuration.minScoreDimensions,
        minimumCompletenessPercentage:configuration.minScoreWeightCoveragePct,
        physicalFallback:configuration.physicalFallback },
      groups:configuration.groups,
      dimensions:configuration.dimensions.map(({ id, displayName, weight, groupId, enabled, isMonthSensitive, isScoreDimension, unit, status }) =>
        ({ id, displayName, weight, groupId, enabled, isMonthSensitive, isScoreDimension, unit, status })),
      physicalDimensionScoreBands:conditionsModel.SCORE_BANDS,
      thermalHistoryExperienceHeuristic:configuration.thermalHistoryExperienceHeuristic,
      fishOutlookBands:configuration.fishOutlookBands,
      coralRecords:'No independent dimension weight; its relative rank is one equally weighted input to Reef habitat & coral evidence.'
    },
    encoding:{
      month:{ filePattern:'month-{month}.bin.gz', magic:'DAEO', version:3, headerBytes:16, bytesPerCell:10,
        fields:[
          { id:'overallExperienceScore', type:'uint8', missing:255 },
          { id:'diveConditionsScore', type:'uint8', missing:255 },
          { id:'overallConfidenceValue', type:'uint8', scale:'0-255 maps to 0-1 evidence quality' },
          { id:'physicalConfidenceValue', type:'uint8', scale:'0-255 maps to 0-1 evidence quality' },
          { id:'ecologicalConfidenceValue', type:'uint8', scale:'0-255 maps to 0-1 evidence quality' },
          { id:'scoreCompletenessPercentage', type:'uint8', range:[0,100] },
          { id:'physicalGroupCompletenessPercentage', type:'uint8', range:[0,100] },
          { id:'ecologicalGroupCompletenessPercentage', type:'uint8', range:[0,100] },
          { id:'activeDimensionMask', type:'uint16le', bitOrder:configuration.dimensions.filter(dimension => dimension.isScoreDimension).map(dimension => dimension.id) }
        ]
      },
      staticSupport:{ file:'static-support.bin.gz', magic:'DAES', version:1, headerBytes:16, bytesPerCell:20,
        fields:[
          { id:'fishExperienceScore', type:'uint8', missing:255 },
          { id:'fishTier', type:'uint8', codes:{ 0:'unavailable', 1:'A', 2:'B', 3:'C' } },
          { id:'fishCategory', type:'uint8', codes:{ 0:'unavailable', 1:'Very low', 2:'Low', 3:'Lower typical', 4:'Typical', 5:'Upper typical', 6:'High', 7:'Very high' } },
          { id:'fishEvidenceLevel', type:'uint8', codes:{ 0:'none', 1:'high', 2:'moderate', 3:'limited' } },
          { id:'fishSupportStatus', type:'uint8', codes:{ 0:'unsupported', 1:'supported', 2:'limited' } },
          { id:'fishNearestObservationDistance', type:'uint16le', scale:'0.1 km', missing:65535 },
          { id:'fishSupportingSiteCount', type:'uint16le', missing:65535 },
          { id:'fishEffectiveSupport', type:'uint16le', scale:'0.1 effective sites', missing:65535 },
          { id:'fishEnvironmentalSupportDistance', type:'uint16le', scale:'0.1 standardized distance', missing:65535 },
          { id:'fishOceanSampleFraction', type:'uint8', scale:'0-255 maps to 0-1 ocean fraction' },
          { id:'thermalStressScore', type:'uint8', missing:255 },
          { id:'thermalHistoryValidYears', type:'uint8' },
          { id:'meanAnnualMaximumDhw', type:'uint16le', scale:'0.01 °C-weeks', missing:65535 },
          { id:'thermalSampleDistance', type:'uint16le', scale:'0.1 km from output cell center to nearest source grid point', missing:65535 }
        ]
      },
      opacity:{ formula:'(0.62 + 0.38 * evidenceQuality) * (0.90 + 0.10 * completeness)',
        evidenceQuality:'overallConfidenceValue / 255', completeness:'scoreCompletenessPercentage / 100' },
      palette:'Reversed Viridis: low/less-favorable yellow #fde725 through teal to high/more-favorable dark purple #440154.',
      unknownCells:'Transparent. Land remains uncolored through the ocean-subcell mask.'
    },
    sources:{
      physical:'WOA23 water temperature, Copernicus Marine clarity/current/wave products; existing DiveAtlas samplers and monthly climatologies.',
      fish:'AODN/NRMN survey-derived Fish Abundance Outlook. The observation target contains positive recorded survey units; complete zero-count blocks were not recoverable. Public values are relative categories, not fish/100 m².',
      thermal:'NOAA Coral Reef Watch CoralTemp annual maximum DHW history. Thermal stress is not a claim of observed bleaching or mortality.',
      thermalNativeResolution:'0.05° source grid (about 5.6 km north-south); annual history is sampled at native-grid points and summarized to the 0.5° analysis grid.',
      thermalFallbackBehavior:'Nearest native grid point only. Missing source data or fewer than six valid annual values leaves the dimension unavailable.',
      fishTierProvenance:{ A:'Survey-supported existing map estimate', B:'Regional NRMN distance-weighted estimate', C:'Environmentally screened ecological outlook' },
      fishConnectivity:'Water-component identifiers are not retained by the source table; no ocean-connectivity claim is made.',
      coralRecords:'Relative-rank evidence contributes only through the Reef habitat & coral evidence dimension; there is no separate Coral Records score weight.',
      excludedDimensions:'Observed bleaching and macroalgae cover are not score dimensions; no synthetic values are emitted.'
    },
    oceanMissingDataEstimation:{
      guide:'docs/ocean-missing-data-estimation-guide.md',
      temperature:{
        productionFallback:'Nearest valid WOA23 cell for the selected month and 5 m depth within 25 km.',
        beyondNativeSupport:'Unavailable. The 100 km regional fallback remains analysis-only pending spatially blocked validation.',
        estimateBeforeScoring:true,
        estimatedValuesReduceConfidence:true,
        estimatedValuesReduceScore:false
      },
      monthlyMapEstimatedTemperatureCells:prototype.months.reduce((sum, month) => sum + Number(month.nearbyTemperatureEstimateCells || 0), 0)
    },
    spatialSupport:{
      physical:'The popup retains the existing Dive Conditions sampler provenance, temporal period, native resolution, selected-point sample distance, and any source fallback behavior.',
      fish:{ distanceReference:'0.5° output-cell center to nearest NRMN support observation', tierProvenance:{ A:'Survey-supported existing map estimate', B:'Regional NRMN distance-weighted estimate', C:'Environmentally screened ecological outlook' },
        distanceKernel:'1 / (1 + (distance / 250 km)^3) affects evidence confidence only; it does not reduce the fish score.',
        connectivity:'Water-component identifiers are not retained by the source table; no ocean-connectivity claim is made.' },
      thermal:{ nativeResolution:'0.05° source grid, about 5.6 km north-south', analysisResolution:'0.5° score grid',
        distanceReference:'0.5° output-cell center to nearest native NOAA source-grid point',
        fallbackBehavior:'Nearest native grid point only; missing source data or fewer than six valid annual values leaves the dimension unavailable.' }
    },
    months:entries,
    files:Object.fromEntries(Object.entries(hashes).map(([name, hash]) => [name, { sha256:hash }]))
  };
}

async function main() {
  const prototype = JSON.parse(await fs.readFile(path.join(SOURCE, 'manifest.json'), 'utf8'));
  if (prototype.format !== 'diveatlas-dive-experience-prototype-grid' || prototype.version !== 3 ||
      prototype.months?.length !== 12 || prototype.months.some(month => month.partial || !month.asset)) {
    throw new Error('A complete accepted prototype manifest with all 12 months is required.');
  }
  const supportSource = path.join(SOURCE, 'static-support.bin.gz');
  const maskSource = path.join(SOURCE, 'ocean-mask.bin.gz');
  const [supportPacked, maskPacked] = await Promise.all([fs.readFile(supportSource), fs.readFile(maskSource)]);
  const supportBytes = zlib.gunzipSync(supportPacked);
  const maskBytes = zlib.gunzipSync(maskPacked);
  validateGridHeader(supportBytes, 'DAES', 1, SUPPORT_BYTES);
  validateGridHeader(maskBytes, 'DAOM', 1, 16 + CELL_COUNT * 8);
  if (maskBytes.readUInt8(5) !== 8) throw new Error('The ocean mask has an unsupported subcell layout.');

  await fs.mkdir(DESTINATION, { recursive:true });
  const hashes = {};
  const entries = [];
  const files = [
    { name:'static-support.bin.gz', bytes:supportPacked },
    { name:'ocean-mask.bin.gz', bytes:maskPacked }
  ];
  for (const prototypeMonth of prototype.months) {
    const month = Number(prototypeMonth.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('Prototype month numbers must be 1 through 12.');
    const name = `month-${String(month).padStart(2, '0')}.bin.gz`;
    const packed = await fs.readFile(path.join(SOURCE, name));
    const bytes = zlib.gunzipSync(packed);
    if (bytes.readUInt8(5) !== month) throw new Error(`${name} does not match its manifest month.`);
    const coverage = monthCoverage(bytes);
    const digest = sha256(packed);
    hashes[name] = digest;
    entries.push({ month, asset:name, compressedBytes:packed.length, sha256:digest, ...coverage,
      processedOceanCells:Number(prototypeMonth.processedOceanCells),
      meanPhysicalGroupCompletenessPercentage:Number(prototypeMonth.meanPhysicalGroupCompletenessPercentage),
      meanEcologicalGroupCompletenessPercentage:Number(prototypeMonth.meanEcologicalGroupCompletenessPercentage) });
    files.push({ name, bytes:packed });
  }
  hashes['static-support.bin.gz'] = sha256(supportPacked);
  hashes['ocean-mask.bin.gz'] = sha256(maskPacked);
  for (const file of files) await fs.writeFile(path.join(DESTINATION, file.name), file.bytes);
  const metadata = runtimeMetadata(prototype, entries, hashes);
  await fs.writeFile(path.join(DESTINATION, 'manifest.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  const totalBytes = files.reduce((sum, file) => sum + file.bytes.length, 0) + (await fs.stat(path.join(DESTINATION, 'manifest.json'))).size;
  process.stdout.write(`Published ${files.length} runtime assets (${totalBytes.toLocaleString()} bytes) to ${path.relative(ROOT, DESTINATION)} from ${path.relative(ROOT, SOURCE)}.\n`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = Object.freeze({ validateGridHeader, monthCoverage, runtimeMetadata });
