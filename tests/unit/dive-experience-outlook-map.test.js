'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const outlook = require('../../js/dive-experience-outlook-map.js');

const grid = { west:-180, south:-85, step:0.5, width:720, height:340 };
const cellCount = grid.width * grid.height;

function header(bytes, magic, version, samples = 0) {
  bytes.write(magic, 0, 'ascii');
  bytes.writeUInt8(version, 4);
  bytes.writeUInt8(samples, 5);
  bytes.writeUInt16LE(grid.width, 6);
  bytes.writeUInt16LE(grid.height, 8);
  bytes.writeUInt16LE(50, 10);
  bytes.writeInt16LE(-1800, 12);
  bytes.writeInt16LE(-850, 14);
}

function makeManifest() {
  return {
    format:'diveatlas-dive-experience-outlook', schemaVersion:1, scoringVersion:'test', thresholdVersion:'test', dataVersion:'test',
    grid, oceanMask:{ file:'ocean-mask.bin.gz', samplesPerAxis:8 },
    scoring:{
      overallThresholds:{ excellent:85, good:70, fair:55 },
      physicalConditionThresholds:{ comfortable:85, favorable:70, mixed:55 },
      confidenceThresholds:{ high:0.75, moderate:0.4, limited:0.2 },
      dimensions:[
        { id:'waterClarity', weight:20, groupId:'physicalExperience', isScoreDimension:true },
        { id:'current', weight:15, groupId:'physicalExperience', isScoreDimension:true },
        { id:'waveHeight', weight:15, groupId:'physicalExperience', isScoreDimension:true },
        { id:'waterTemperature', weight:15, groupId:'physicalExperience', isScoreDimension:true },
        { id:'reefHabitatCoralEvidence', weight:15, groupId:'reefEcologicalExperience', isScoreDimension:true },
        { id:'fishDensity', weight:10, groupId:'reefEcologicalExperience', isScoreDimension:true },
        { id:'thermalStressHistory', weight:10, groupId:'reefEcologicalExperience', isScoreDimension:true },
        { id:'coralRecords', weight:0, groupId:null, isScoreDimension:false }
      ]
    },
    sources:{ thermalNativeResolution:'0.05°', thermalFallbackBehavior:'Nearest native grid point.' },
    encoding:{ month:{ magic:'DAEO', version:3, bytesPerCell:10 }, staticSupport:{ magic:'DAES', version:1, bytesPerCell:20 } },
    months:Array.from({ length:12 }, (_, index) => ({ month:index + 1, asset:`month-${String(index + 1).padStart(2, '0')}.bin.gz` }))
  };
}

function makeBuffers(score = 88) {
  const manifest = makeManifest();
  const index = 170 * grid.width + 360;
  const month = Buffer.alloc(16 + cellCount * 10);
  header(month, 'DAEO', 3);
  month.writeUInt8(10, 5);
  month.fill(255, 16, 16 + cellCount);
  month.fill(255, 16 + cellCount, 16 + cellCount * 2);
  month.writeUInt8(score, 16 + index);
  month.writeUInt8(76, 16 + cellCount + index);
  month.writeUInt8(153, 16 + cellCount * 2 + index);
  month.writeUInt8(200, 16 + cellCount * 3 + index);
  month.writeUInt8(190, 16 + cellCount * 4 + index);
  month.writeUInt8(72, 16 + cellCount * 5 + index);
  month.writeUInt8(100, 16 + cellCount * 6 + index);
  month.writeUInt8(33, 16 + cellCount * 7 + index);
  month.writeUInt16LE((1 << 5) | (1 << 6), 16 + cellCount * 8 + index * 2);
  const support = Buffer.alloc(16 + cellCount * 20);
  header(support, 'DAES', 1);
  const supportOffset = 16 + index * 20;
  support.writeUInt8(80, supportOffset);
  support.writeUInt8(2, supportOffset + 1);
  support.writeUInt8(5, supportOffset + 2);
  support.writeUInt8(2, supportOffset + 3);
  support.writeUInt8(2, supportOffset + 4);
  support.writeUInt16LE(1234, supportOffset + 5);
  support.writeUInt16LE(4, supportOffset + 7);
  support.writeUInt16LE(27, supportOffset + 9);
  support.writeUInt16LE(12, supportOffset + 11);
  support.writeUInt8(220, supportOffset + 13);
  support.writeUInt8(60, supportOffset + 14);
  support.writeUInt8(8, supportOffset + 15);
  support.writeUInt16LE(250, supportOffset + 16);
  support.writeUInt16LE(35, supportOffset + 18);
  const mask = Buffer.alloc(16 + cellCount * 8);
  header(mask, 'DAOM', 1, 8);
  // (0.25, 0.25) falls in subrow 4 and subcolumn 4 of this ocean cell.
  mask[16 + index * 8 + 4] = 1 << 4;
  return { manifest, index, month, support, mask };
}

test('versioned manifest rejects missing months and unexpected grids', () => {
  const manifest = makeManifest();
  assert.equal(outlook.validateManifest(manifest), manifest);
  assert.throws(() => outlook.validateManifest({ ...manifest, months:manifest.months.slice(1) }), /incomplete month list/);
  assert.throws(() => outlook.validateManifest({ ...manifest, grid:{ ...grid, step:1 } }), /incomplete month list/);
});

test('ocean-cell sampling returns block-preserving score, support, and categorical fish evidence', () => {
  const { manifest, month, support, mask } = makeBuffers();
  const monthData = outlook.decodeMonth(month, manifest, 10);
  const supportData = outlook.decodeStaticSupport(support, manifest);
  const oceanMask = outlook.decodeOceanMask(mask, manifest);
  const sample = outlook.sampleAt({ lat:0.25, lng:0.25 }, monthData, supportData, oceanMask, manifest);
  assert.equal(sample.score, 88);
  assert.equal(sample.label, 'Excellent');
  assert.equal(sample.diveConditionsScore, 76);
  assert.equal(sample.diveConditionsLabel, 'Favorable');
  assert.equal(sample.confidence, 'Moderate');
  assert.equal(sample.completeness, 72);
  assert.deepEqual(sample.activeDimensionIds, ['fishDensity', 'thermalStressHistory']);
  assert.deepEqual(sample.reefExperience, { status:'supported', activeDimensionCount:2,
    totalDimensionCount:3, activeDimensionIds:['fishDensity', 'thermalStressHistory'] });
  assert.deepEqual(sample.fish, {
    score:80, tier:'B', category:'High', evidenceLevel:'moderate', spatialSupportStatus:'limited',
    nearestObservationDistanceKm:123.4, supportingSiteCount:4, effectiveSupport:2.7, environmentalSupportDistance:1.2
  });
  assert.equal(sample.thermalStress.meanAnnualMaximumDhw, 2.5);
  assert.equal(sample.thermalStress.sampleDistanceKm, 3.5);
  assert.equal(sample.thermalStress.nativeResolution, '0.05°');
});

test('land subcells and unsupported score cells remain transparent', () => {
  const { manifest, month, support, mask } = makeBuffers(255);
  const monthData = outlook.decodeMonth(month, manifest, 10);
  const supportData = outlook.decodeStaticSupport(support, manifest);
  const oceanMask = outlook.decodeOceanMask(mask, manifest);
  assert.equal(outlook.sampleAt({ lat:0.1, lng:0.1 }, monthData, supportData, oceanMask, manifest), null);
  const sample = outlook.sampleAt({ lat:0.25, lng:0.25 }, monthData, supportData, oceanMask, manifest);
  assert.equal(sample.score, null);
  assert.equal(sample.label, null);
  assert.equal(sample.diveConditionsScore, 76);
});

test('Reversed Viridis hue and balanced opacity are independent dimensions', () => {
  assert.deepEqual(outlook.interpolateViridis(0), [253, 231, 37]);
  assert.deepEqual(outlook.interpolateViridis(100), [68, 1, 84]);
  assert.equal(outlook.opacityFor(0, 0), 0.558);
  assert.equal(outlook.opacityFor(1, 1), 1);
});
