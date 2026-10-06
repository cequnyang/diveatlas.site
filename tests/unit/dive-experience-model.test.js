'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const model = require('../../js/dive-experience-model.js');
const prototypeBuilder = require('../../tools/build_dive_experience_outlook_prototype.js');

function support(overrides = {}) {
  return { mode:'test grid sample', status:'supported', sourceType:'test-only fixture', confidenceFactor:1,
    notes:'Synthetic unit-test support metadata.', ...overrides };
}

function completeCurrentInputs(overrides = {}) {
  return {
    waterClarity:{ rawValue:22, unit:'m', descriptiveCategory:'High', experienceScore:100, evidenceLevel:'high', provenance:'climatology_or_model', isAvailable:true, spatialSupport:support() },
    current:{ rawValue:0.35, unit:'m/s', descriptiveCategory:'Moderate', experienceScore:40, evidenceLevel:'high', provenance:'climatology_or_model', isAvailable:true, spatialSupport:support() },
    waveHeight:{ rawValue:0.7, unit:'m', descriptiveCategory:'Moderate wave height', experienceScore:40, evidenceLevel:'high', provenance:'climatology_or_model', isAvailable:true, spatialSupport:support() },
    waterTemperature:{ rawValue:28, unit:'°C', descriptiveCategory:'Warm', experienceScore:100, evidenceLevel:'high', provenance:'climatology_or_model', isAvailable:true, spatialSupport:support() },
    fishDensity:{ rawValue:null, unit:null, descriptiveCategory:'Higher', experienceScore:72, evidenceLevel:'moderate', provenance:'regional_estimate', isEstimated:true, isAvailable:true, spatialSupport:support({ mode:'observation-derived', nearestObservationDistanceKm:20, supportingSiteCount:4, effectiveSupport:3.4 }) },
    thermalStressHistory:{ rawValue:5, unit:'°C-weeks', descriptiveCategory:'Elevated annual heat stress', experienceScore:80, evidenceLevel:'high', provenance:'climatology_or_model', isEstimated:true, isAvailable:true, spatialSupport:support({ mode:'gridded history', sampleDistanceKm:2, nativeResolution:'0.05°' }) },
    ...overrides
  };
}

test('scoring dimensions total 100 points; support-only Coral Records remains outside scoring', () => {
  const config = model.configuration();
  assert.equal(config.scoringVersion, 'dive-experience-v5');
  assert.equal(config.totalListedWeight, 100);
  assert.equal(config.configuredScoreWeight, 100);
  assert.deepEqual(config.supportOnlyDimensions, ['coralRecords']);
  assert.equal(config.currentlyEnabledScoreWeight, 100);
  assert.deepEqual(config.groups.map(group => [group.id, group.weight, group.configuredDimensionWeight]), [
    ['physicalExperience', 65, 65], ['reefEcologicalExperience', 35, 35]
  ]);
  assert.deepEqual(config.groups.flatMap(group => group.dimensions.map(dimension => [dimension.id, dimension.weight])), [
    ['waterClarity', 20], ['current', 15], ['waveHeight', 15], ['waterTemperature', 15],
    ['reefHabitatCoralEvidence', 15], ['fishDensity', 10], ['thermalStressHistory', 10]
  ]);
  assert.deepEqual(model.DIMENSIONS.find(dimension => dimension.id === 'reefHabitatCoralEvidence').supportingEvidenceSources,
    [{ id:'reefExtent', role:'mapped_habitat_footprint' }, { id:'coralRecords', role:'relative_occurrence_evidence' }]);
});

test('top-level group influence is configuration-driven and cannot silently remove a block', () => {
  const configured = model.createDiveExperienceModel({ groupWeights:{ physicalExperience:65, reefEcologicalExperience:35 } });
  assert.deepEqual(configured.configuration().groups.map(group => group.weight), [65, 35]);
  assert.deepEqual(configured.configuration().groups.map(group => group.relativeInfluencePercentage), [65, 35]);
  assert.throws(() => model.createDiveExperienceModel({ groupWeights:{ physicalExperience:0 } }), /must be finite and positive/);
});

test('overall and physical labels use separate centrally configured thresholds', () => {
  const configured = model.createDiveExperienceModel({
    overallThresholds:{ excellent:88, good:72, fair:56 },
    physicalConditionThresholds:{ comfortable:90, favorable:74, mixed:58 }
  });
  assert.deepEqual(configured.configuration().overallThresholds, { excellent:88, good:72, fair:56 });
  assert.deepEqual(configured.configuration().physicalConditionThresholds, { comfortable:90, favorable:74, mixed:58 });
  assert.equal(configured.overallLabel(87), 'Good');
  assert.equal(configured.physicalConditionLabel(87), 'Favorable');
  assert.equal(model.overallLabel(84), 'Good');
  assert.equal(model.physicalConditionLabel(84), 'Favorable');
  assert.throws(() => model.createDiveExperienceModel({ overallThresholds:{ excellent:70, good:80, fair:55 } }), /must be ordered/);
  assert.throws(() => model.createDiveExperienceModel({ physicalConditionThresholds:{ comfortable:70, favorable:80, mixed:55 } }), /must be ordered/);
});

test('available dimensions renormalize inside stable scoring groups and preserve the macro weights', () => {
  const result = model.calculate({ month:10, dimensions:completeCurrentInputs() });
  assert.equal(result.score, 74);
  assert.equal(result.label, 'Good');
  assert.equal(result.activeScoringDimensionCount, 6);
  assert.equal(result.inactiveScoringDimensionCount, 1);
  assert.equal(result.scoreCompletenessPercentage, 85);
  assert.equal(result.activeWeightPercentage, 85);
  assert.equal(result.missingWeightPercentage, 15);
  assert.equal(result.activeConfiguredWeightPercentage, 85);
  assert.equal(result.rawWeightedSum, 6220);
  assert.equal(result.legacyGlobalNormalizedScore, 73);
  assert.deepEqual(result.groups.map(group => [group.id, group.configuredWeight]), [
    ['physicalExperience', 65], ['reefEcologicalExperience', 35]
  ]);
  assert.equal(result.groups.find(group => group.id === 'reefEcologicalExperience').completenessPercentage, 57.1);
  assert.equal(result.dimensions.find(dimension => dimension.id === 'reefHabitatCoralEvidence').experienceScore, null);
  assert.equal(result.dimensions.find(dimension => dimension.id === 'reefHabitatCoralEvidence').isAvailable, false);
  assert.ok(result.keyReasons.includes('Fish abundance outlook above typical'));
  assert.equal(result.confidence, 'High');
  assert.deepEqual(result.activeDimensions, ['waterClarity','current','waveHeight','waterTemperature','fishDensity','thermalStressHistory']);
  assert.deepEqual(result.unavailableDimensions, ['reefHabitatCoralEvidence']);
  assert.ok(result.dimensions.every(dimension => dimension.spatialSupport && dimension.spatialSupport.contractVersion === 1));
});

test('Coral Records can be shown as context without affecting the score', () => {
  const withCoralSupport = completeCurrentInputs({ coralRecords:{ rawValue:12, unit:'records', descriptiveCategory:'Records nearby', evidenceLevel:'high', provenance:'observed', isAvailable:true, spatialSupport:support() } });
  const withoutCoralSupport = completeCurrentInputs();
  const first = model.calculate({ dimensions:withCoralSupport });
  const second = model.calculate({ dimensions:withoutCoralSupport });
  assert.equal(first.score, second.score);
  assert.equal(first.rawWeightedSum, second.rawWeightedSum);
  assert.equal(first.support.coralRecords.available, true);
  assert.equal(second.support.coralRecords.available, false);
});

test('unsupported dimensions are not converted to zero and low support suppresses the overall score', () => {
  const result = model.calculate({ dimensions:{
    waterClarity:{ rawValue:null, experienceScore:null, isAvailable:false, spatialSupport:support({ status:'unsupported' }) },
    current:{ rawValue:0.35, experienceScore:40, evidenceLevel:'high', provenance:'observed', isAvailable:true, spatialSupport:support() },
    waveHeight:{ rawValue:0.7, experienceScore:40, evidenceLevel:'high', provenance:'observed', isAvailable:true, spatialSupport:support() }
  } });
  assert.equal(result.score, null);
  assert.equal(result.label, null);
  assert.equal(result.scoreStatus, 'insufficient-support');
  assert.equal(result.activeWeightPercentage, 30);
  assert.equal(result.dimensions.find(dimension => dimension.id === 'waterClarity').experienceScore, null);
  assert.deepEqual(result.keyReasons, []);
});

test('confidence follows evidence quality and not score, dimension coverage, or completeness', () => {
  const highConditions = completeCurrentInputs({
    current:{ rawValue:0.1, unit:'m/s', descriptiveCategory:'Light', experienceScore:100, evidenceLevel:'high', provenance:'observed', isAvailable:true, spatialSupport:support() },
    waveHeight:{ rawValue:0.1, unit:'m', descriptiveCategory:'Low wave height', experienceScore:100, evidenceLevel:'high', provenance:'observed', isAvailable:true, spatialSupport:support() }
  });
  const lowConditions = completeCurrentInputs({
    current:{ rawValue:1.5, unit:'m/s', descriptiveCategory:'Very strong', experienceScore:0, evidenceLevel:'high', provenance:'observed', isAvailable:true, spatialSupport:support() },
    waveHeight:{ rawValue:2, unit:'m', descriptiveCategory:'Higher wave height', experienceScore:0, evidenceLevel:'high', provenance:'observed', isAvailable:true, spatialSupport:support() }
  });
  const good = model.calculate({ dimensions:highConditions });
  const difficult = model.calculate({ dimensions:lowConditions });
  assert.notEqual(good.score, difficult.score);
  assert.equal(good.confidence, difficult.confidence);
  assert.equal(good.confidenceValue, difficult.confidenceValue);
  const sparseIds = ['current','waveHeight','fishDensity','thermalStressHistory'];
  const equalQualityInputs = completeCurrentInputs();
  for (const dimension of model.SCORE_DIMENSIONS) {
    if (equalQualityInputs[dimension.id]?.isAvailable) equalQualityInputs[dimension.id] = {
      ...equalQualityInputs[dimension.id], evidenceLevel:'high', provenance:'observed', spatialSupport:support()
    };
  }
  const fullEqualQuality = model.calculate({ dimensions:equalQualityInputs });
  const sparse = Object.fromEntries(model.SCORE_DIMENSIONS.map(dimension => [dimension.id,
    sparseIds.includes(dimension.id) ? equalQualityInputs[dimension.id] : { isAvailable:false, spatialSupport:support({ status:'not_assessed' }) }
  ]));
  const fewerDimensions = model.calculate({ dimensions:sparse });
  assert.equal(fullEqualQuality.confidenceValue, fewerDimensions.confidenceValue);
  assert.notEqual(fullEqualQuality.scoreCompletenessPercentage, fewerDimensions.scoreCompletenessPercentage);
});

test('map opacity encodes confidence independently of score color', () => {
  assert.ok(model.confidenceOpacity('High') > model.confidenceOpacity('Moderate'));
  assert.ok(model.confidenceOpacity('Moderate') > model.confidenceOpacity('Limited'));
  assert.equal(model.confidenceOpacity('Low'), 0.32);
});

test('thermal-history scoring follows the configured NOAA DHW bands without claiming observed bleaching', () => {
  assert.deepEqual(model.scoreThermalHistory(1.99), { score:100, category:'Very low annual heat stress' });
  assert.deepEqual(model.scoreThermalHistory(3.99), { score:90, category:'Low annual heat stress' });
  assert.deepEqual(model.scoreThermalHistory(4), { score:80, category:'Elevated annual heat stress' });
  assert.deepEqual(model.scoreThermalHistory(8), { score:60, category:'High annual heat stress' });
  assert.equal(model.scoreThermalHistory(null), null);
  const neutralOtherDimensions = completeCurrentInputs({
    waterClarity:{ rawValue:15, unit:'m', descriptiveCategory:'Typical', experienceScore:65, evidenceLevel:'high', provenance:'climatology_or_model', isAvailable:true, spatialSupport:support() },
    current:{ rawValue:0.5, unit:'m/s', descriptiveCategory:'Typical', experienceScore:65, evidenceLevel:'high', provenance:'climatology_or_model', isAvailable:true, spatialSupport:support() },
    waveHeight:{ rawValue:0.8, unit:'m', descriptiveCategory:'Typical', experienceScore:65, evidenceLevel:'high', provenance:'climatology_or_model', isAvailable:true, spatialSupport:support() },
    waterTemperature:{ rawValue:25, unit:'°C', descriptiveCategory:'Typical', experienceScore:65, evidenceLevel:'high', provenance:'climatology_or_model', isAvailable:true, spatialSupport:support() }
  });
  assert.ok(model.calculate({ dimensions:neutralOtherDimensions }).keyReasons.some(reason => reason.startsWith('Long-term thermal stress:')));
});

test('farther spatial support changes confidence but never the experience score', () => {
  const near = completeCurrentInputs({ fishDensity:{ ...completeCurrentInputs().fishDensity, spatialSupport:support({
    mode:'observation-derived', status:'limited', nearestObservationDistanceKm:10, supportingSiteCount:3, effectiveSupport:2.8,
    confidenceFactor:1 / (1 + (10 / 250) ** 3)
  }) } });
  const far = completeCurrentInputs({ fishDensity:{ ...completeCurrentInputs().fishDensity, spatialSupport:support({
    mode:'observation-derived', status:'limited', nearestObservationDistanceKm:1000, supportingSiteCount:3, effectiveSupport:2.8,
    confidenceFactor:1 / (1 + (1000 / 250) ** 3)
  }) } });
  const nearResult = model.calculate({ dimensions:near });
  const farResult = model.calculate({ dimensions:far });
  assert.equal(farResult.score, nearResult.score);
  assert.ok(farResult.confidenceValue < nearResult.confidenceValue);
});

test('indefensible spatial support makes that dimension unavailable rather than assigning a score', () => {
  const result = model.calculate({ dimensions:completeCurrentInputs({ fishDensity:{ ...completeCurrentInputs().fishDensity,
    spatialSupport:support({ status:'unsupported', confidenceFactor:0 }) } }) });
  assert.equal(result.dimensions.find(item => item.id === 'fishDensity').isAvailable, false);
  assert.ok(result.unavailableDimensions.includes('fishDensity'));
});

test('several identical scores keep confidence independent from completeness across evidence sets', () => {
  function sameScoreSet(ids, score) {
    return Object.fromEntries(model.SCORE_DIMENSIONS.map(dimension => [dimension.id, ids.includes(dimension.id)
      ? { experienceScore:score, evidenceLevel:'high', provenance:'climatology_or_model', isAvailable:true, spatialSupport:support() }
      : { isAvailable:false, spatialSupport:support({ status:'not_assessed' }) }
    ]));
  }
  const cases = [
    { score:55, fewer:['current','waveHeight','fishDensity','thermalStressHistory'] },
    { score:70, fewer:['current','waveHeight','fishDensity','thermalStressHistory'] },
    { score:85, fewer:['waterClarity','current','fishDensity','thermalStressHistory'] }
  ];
  for (const item of cases) {
    const broad = model.calculate({ dimensions:sameScoreSet(['waterClarity','current','waveHeight','waterTemperature','fishDensity','thermalStressHistory'], item.score) });
    const sparse = model.calculate({ dimensions:sameScoreSet(item.fewer, item.score) });
    assert.equal(broad.score, item.score);
    assert.equal(sparse.score, item.score);
    assert.notEqual(broad.scoreCompleteness, sparse.scoreCompleteness);
    assert.equal(broad.confidenceValue, sparse.confidenceValue);
  }
});

test('reef habitat and coral evidence dimension stays unavailable without both inputs', () => {
  const configured = model.createDiveExperienceModel({ dimensionOverrides:{
    reefHabitatCoralEvidence:{ enabled:true, status:'enabled_for_inputs' }
  } });
  const output = configured.calculate({ dimensions:completeCurrentInputs() });
  assert.deepEqual(configured.configuration().groups.map(group => group.weight), [65, 35]);
  const dimension = output.dimensions.find(item => item.id === 'reefHabitatCoralEvidence');
  assert.equal(dimension.isAvailable, false);
  assert.equal(dimension.experienceScore, null);
});

test('missing an entire scoring group keeps overall unavailable and exposes a separate physical fallback', () => {
  const physicalOnly = Object.fromEntries(model.DIMENSIONS.map(dimension => [dimension.id,
    dimension.groupId === 'physicalExperience'
      ? { experienceScore:80, evidenceLevel:'high', provenance:'climatology_or_model', isAvailable:true, spatialSupport:support() }
      : { isAvailable:false, spatialSupport:support({ status:'unsupported' }) }
  ]));
  const result = model.calculate({ dimensions:physicalOnly });
  assert.equal(result.score, null);
  assert.equal(result.overallOutlook.status, 'unavailable');
  assert.equal(result.diveConditionsScore, 80);
  assert.equal(result.diveConditionsLabel, 'Favorable');
  assert.equal(result.reefExperience.status, 'unavailable');
  assert.equal(result.completenessText, '4 of 7 scoring dimensions available');
});

test('version 3 prototype map cells encode both score types, confidence values, coverage, and active dimensions', () => {
  const count = 720 * 340;
  const packed = prototypeBuilder.createMapAsset(10,
    new Uint8Array(count).fill(72), new Uint8Array(count).fill(80),
    new Uint8Array(count).fill(128), new Uint8Array(count).fill(180), new Uint8Array(count).fill(90),
    new Uint8Array(count).fill(72), new Uint8Array(count).fill(100), new Uint8Array(count).fill(33), new Uint16Array(count).fill(0x25));
  const bytes = zlib.gunzipSync(packed);
  assert.equal(bytes.toString('ascii', 0, 4), 'DAEO');
  assert.equal(bytes.readUInt8(4), 3);
  assert.equal(bytes.length, 16 + count * 10);
  assert.equal(bytes.readUInt8(16), 72);
  assert.equal(bytes.readUInt8(16 + count), 80);
  assert.equal(bytes.readUInt8(16 + count * 2), 128);
  assert.equal(bytes.readUInt8(16 + count * 3), 180);
  assert.equal(bytes.readUInt8(16 + count * 4), 90);
  assert.equal(bytes.readUInt8(16 + count * 5), 72);
  assert.equal(bytes.readUInt8(16 + count * 6), 100);
  assert.equal(bytes.readUInt8(16 + count * 7), 33);
  assert.equal(bytes.readUInt16LE(16 + count * 8), 0x25);
});
