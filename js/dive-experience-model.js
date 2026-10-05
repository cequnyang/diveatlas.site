(function attachDiveExperienceModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasDiveExperienceModel = api;
})(typeof window === 'undefined' ? globalThis : window, function buildDiveExperienceModel() {
  const SCORING_VERSION = 'dive-experience-v5';
  const PROVENANCE = Object.freeze(['observed', 'climatology_or_model', 'regional_estimate', 'ecological_outlook', 'unknown']);
  const EVIDENCE_LEVELS = Object.freeze(['high', 'moderate', 'limited', 'none']);
  const SPATIAL_SUPPORT_STATUSES = Object.freeze(['supported', 'limited', 'unsupported', 'not_assessed', 'not_applicable']);
  const DEFAULT_GROUPS = Object.freeze([
    Object.freeze({ id:'physicalExperience', label:'Dive conditions / physical experience', weight:65 }),
    Object.freeze({ id:'reefEcologicalExperience', label:'Reef / ecological experience', weight:35 })
  ]);
  const DIMENSIONS = Object.freeze([
    { id:'waterClarity', displayName:'Water clarity', weight:20, groupId:'physicalExperience', enabled:true, isScoreDimension:true, isMonthSensitive:true, unit:'m', status:'active' },
    { id:'current', displayName:'Current', weight:15, groupId:'physicalExperience', enabled:true, isScoreDimension:true, isMonthSensitive:true, unit:'m/s', status:'active' },
    { id:'waveHeight', displayName:'Wave height', weight:15, groupId:'physicalExperience', enabled:true, isScoreDimension:true, isMonthSensitive:true, unit:'m', status:'active' },
    { id:'waterTemperature', displayName:'Water temperature', weight:15, groupId:'physicalExperience', enabled:true, isScoreDimension:true, isMonthSensitive:true, unit:'°C', status:'active' },
    { id:'reefHabitatCoralEvidence', displayName:'Reef habitat & coral evidence', weight:15, groupId:'reefEcologicalExperience', enabled:true, isScoreDimension:true, isMonthSensitive:false, unit:'evidence index', status:'active', availabilityReason:'The score requires both reef-footprint share and Coral Records relative rank; missing inputs remain unavailable.', supportingEvidenceSources:Object.freeze([
      Object.freeze({ id:'reefExtent', role:'mapped_habitat_footprint' }),
      Object.freeze({ id:'coralRecords', role:'relative_occurrence_evidence' })
    ]), supportSemantics:'A descriptive evidence index, not live-coral percentage, reef condition, coral abundance, or dive safety. Reef footprint and occurrence records measure different evidence properties.' },
    { id:'fishDensity', displayName:'Fish abundance outlook', weight:10, groupId:'reefEcologicalExperience', enabled:true, isScoreDimension:true, isMonthSensitive:false, unit:null, status:'active' },
    { id:'thermalStressHistory', displayName:'Thermal stress history', weight:10, groupId:'reefEcologicalExperience', enabled:true, isScoreDimension:true, isMonthSensitive:false, unit:'°C-weeks', status:'active' },
    { id:'coralRecords', displayName:'Coral records', weight:0, groupId:null, enabled:true, isScoreDimension:false, isMonthSensitive:false, unit:'records', status:'support_only' }
  ].map(dimension => Object.freeze(dimension)));
  const MIN_SCORE_WEIGHT_COVERAGE_PCT = 40;
  const MIN_SCORE_DIMENSIONS = 3;
  const MIN_PHYSICAL_GROUP_COMPLETENESS = 40 / 65;
  const MIN_PHYSICAL_GROUP_DIMENSIONS = 3;
  const DEFAULT_CONFIDENCE_THRESHOLDS = Object.freeze({ high:0.75, moderate:0.4, limited:0.2 });
  const DEFAULT_OVERALL_THRESHOLDS = Object.freeze({ excellent:85, good:70, fair:55 });
  const DEFAULT_PHYSICAL_CONDITION_THRESHOLDS = Object.freeze({ comfortable:85, favorable:70, mixed:55 });
  const PROVENANCE_STRENGTH = Object.freeze({ observed:0.95, climatology_or_model:0.82, regional_estimate:0.60, ecological_outlook:0.42, unknown:0 });
  const EVIDENCE_STRENGTH = Object.freeze({ high:1, moderate:0.8, limited:0.55, none:0 });
  const THERMAL_HISTORY_THRESHOLDS = Object.freeze([
    Object.freeze({ maximumExclusive:2, score:100, category:'Very low annual heat stress' }),
    Object.freeze({ maximumExclusive:4, score:90, category:'Low annual heat stress' }),
    Object.freeze({ maximumExclusive:8, score:80, category:'Elevated annual heat stress' }),
    Object.freeze({ maximumExclusive:12, score:60, category:'High annual heat stress' }),
    Object.freeze({ maximumExclusive:16, score:40, category:'Very high annual heat stress' }),
    Object.freeze({ maximumExclusive:20, score:20, category:'Extreme annual heat stress' }),
    Object.freeze({ maximumExclusive:Infinity, score:0, category:'Exceptional annual heat stress' })
  ]);
  const FISH_OUTLOOK_BANDS = Object.freeze([
    Object.freeze({ maximumInclusive:14, score:0, category:'Very low' }),
    Object.freeze({ maximumInclusive:28, score:17, category:'Low' }),
    Object.freeze({ maximumInclusive:42, score:33, category:'Lower typical' }),
    Object.freeze({ maximumInclusive:57, score:50, category:'Typical' }),
    Object.freeze({ maximumInclusive:71, score:67, category:'Upper typical' }),
    Object.freeze({ maximumInclusive:85, score:83, category:'High' }),
    Object.freeze({ maximumInclusive:100, score:100, category:'Very high' })
  ]);
  const REEF_HABITAT_EVIDENCE = Object.freeze({
    componentWeights:Object.freeze({ reefFootprint:50, coralRecordRank:50 }),
    reefFootprintBands:Object.freeze([
      Object.freeze({ maximumInclusive:0, score:0, category:'No mapped reef footprint' }),
      Object.freeze({ maximumInclusive:1, score:15, category:'Trace mapped reef footprint' }),
      Object.freeze({ maximumInclusive:3, score:30, category:'Very small mapped reef footprint' }),
      Object.freeze({ maximumInclusive:8, score:45, category:'Small mapped reef footprint' }),
      Object.freeze({ maximumInclusive:15, score:60, category:'Moderate mapped reef footprint' }),
      Object.freeze({ maximumInclusive:35, score:80, category:'Broad mapped reef footprint' }),
      Object.freeze({ maximumInclusive:100, score:100, category:'Extensive mapped reef footprint' })
    ]),
    coralRecordRankBands:Object.freeze([
      Object.freeze({ maximumInclusive:5, score:0, category:'Very low relative coral-record rank' }),
      Object.freeze({ maximumInclusive:15, score:15, category:'Low relative coral-record rank' }),
      Object.freeze({ maximumInclusive:30, score:30, category:'Lower relative coral-record rank' }),
      Object.freeze({ maximumInclusive:50, score:45, category:'Below-mid relative coral-record rank' }),
      Object.freeze({ maximumInclusive:70, score:60, category:'Above-mid relative coral-record rank' }),
      Object.freeze({ maximumInclusive:90, score:80, category:'High relative coral-record rank' }),
      Object.freeze({ maximumInclusive:100, score:100, category:'Very high relative coral-record rank' })
    ]),
    compositeBands:Object.freeze([
      Object.freeze({ maximumInclusive:14, category:'Very limited mapped reef and coral-record evidence' }),
      Object.freeze({ maximumInclusive:29, category:'Limited mapped reef and coral-record evidence' }),
      Object.freeze({ maximumInclusive:44, category:'Some mapped reef and coral-record evidence' }),
      Object.freeze({ maximumInclusive:59, category:'Moderate mapped reef and coral-record evidence' }),
      Object.freeze({ maximumInclusive:74, category:'Strong mapped reef and coral-record evidence' }),
      Object.freeze({ maximumInclusive:89, category:'Very strong mapped reef and coral-record evidence' }),
      Object.freeze({ maximumInclusive:100, category:'Extensive mapped reef and coral-record evidence' })
    ])
  });

  function finiteScore(value) {
    return value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100;
  }

  function overallLabel(score, thresholds = DEFAULT_OVERALL_THRESHOLDS) {
    if (!finiteScore(score)) return null;
    const value = Number(score);
    return value >= thresholds.excellent ? 'Excellent' : value >= thresholds.good ? 'Good' : value >= thresholds.fair ? 'Fair' : 'Challenging';
  }

  function physicalConditionLabel(score, thresholds = DEFAULT_PHYSICAL_CONDITION_THRESHOLDS) {
    if (!finiteScore(score)) return null;
    const value = Number(score);
    return value >= thresholds.comfortable ? 'Comfortable' : value >= thresholds.favorable ? 'Favorable' : value >= thresholds.mixed ? 'Mixed' : 'Demanding';
  }

  function confidenceLabel(score, thresholds = DEFAULT_CONFIDENCE_THRESHOLDS) {
    if (!Number.isFinite(score)) return 'Low';
    return score >= thresholds.high ? 'High' : score >= thresholds.moderate ? 'Moderate' : score >= thresholds.limited ? 'Limited' : 'Low';
  }

  function scoreThermalHistory(meanAnnualMaximumDhw) {
    const value = Number(meanAnnualMaximumDhw);
    if (meanAnnualMaximumDhw == null || !Number.isFinite(value) || value < 0) return null;
    const threshold = THERMAL_HISTORY_THRESHOLDS.find(item => value < item.maximumExclusive);
    return Object.freeze({ score:threshold.score, category:threshold.category });
  }

  function fishOutlookBand(score) {
    const value = Number(score);
    if (score == null || !Number.isFinite(value) || value < 0 || value > 100) return null;
    return FISH_OUTLOOK_BANDS.find(band => value <= band.maximumInclusive)?.category ?? null;
  }

  function fishOutlookScore(score) {
    const value = Number(score);
    if (score == null || !Number.isFinite(value) || value < 0 || value > 100) return null;
    return FISH_OUTLOOK_BANDS.find(band => value <= band.maximumInclusive)?.score ?? null;
  }

  function reefHabitatCoralEvidenceScore({ reefExtentPercentOfWetCell, coralRecordPercentile } = {}) {
    const validPercent = value => value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100;
    if (!validPercent(reefExtentPercentOfWetCell) || !validPercent(coralRecordPercentile)) return null;
    const reefBand = REEF_HABITAT_EVIDENCE.reefFootprintBands.find(band => Number(reefExtentPercentOfWetCell) <= band.maximumInclusive);
    const coralBand = REEF_HABITAT_EVIDENCE.coralRecordRankBands.find(band => Number(coralRecordPercentile) <= band.maximumInclusive);
    if (!reefBand || !coralBand) return null;
    const { reefFootprint, coralRecordRank } = REEF_HABITAT_EVIDENCE.componentWeights;
    const score = Math.round((reefBand.score * reefFootprint + coralBand.score * coralRecordRank) / (reefFootprint + coralRecordRank));
    const category = REEF_HABITAT_EVIDENCE.compositeBands.find(band => score <= band.maximumInclusive)?.category ?? null;
    return Object.freeze({ score, category, reefFootprintScore:reefBand.score, reefFootprintCategory:reefBand.category,
      coralRecordRankScore:coralBand.score, coralRecordRankCategory:coralBand.category });
  }

  function reasonText(dimension) {
    if (typeof dimension.keyReason === 'string' && dimension.keyReason.trim()) return dimension.keyReason.trim();
    const category = String(dimension.descriptiveCategory || '').trim();
    if (!category) return null;
    const lower = category.toLowerCase();
    if (dimension.id === 'waterTemperature') return `${category} water`;
    if (dimension.id === 'waterClarity') return `${category} clarity`;
    if (dimension.id === 'current') return `${category} current`;
    if (dimension.id === 'waveHeight') return category.replace(/\s*wave height/i, ' waves');
    if (dimension.id === 'fishDensity') {
      if (lower === 'higher') return 'Fish abundance outlook above typical';
      if (lower === 'lower') return 'Fish abundance outlook below typical';
      if (lower === 'typical') return 'Typical fish abundance outlook';
      if (['very low', 'low'].includes(lower)) return 'Fish abundance outlook below typical';
      if (lower === 'lower typical') return 'Fish abundance outlook slightly below typical';
      if (lower === 'upper typical') return 'Fish abundance outlook slightly above typical';
      if (lower === 'high') return 'Fish abundance outlook above typical';
      if (lower === 'very high') return 'Fish abundance outlook well above typical';
      return 'Fish abundance outlook is unavailable';
    }
    if (dimension.id === 'thermalStressHistory') return `Long-term thermal stress: ${category.toLowerCase()}`;
    return `${dimension.displayName}: ${category}`;
  }

  function clampUnit(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
  }

  function spatialSupportContract(input, fallbackStatus = 'not_assessed') {
    const source = input && typeof input === 'object' ? input : {};
    const status = SPATIAL_SUPPORT_STATUSES.includes(source.status) ? source.status : fallbackStatus;
    const finiteOrNull = value => value != null && Number.isFinite(Number(value)) ? Number(value) : null;
    const countOrNull = value => value != null && value !== '' && Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
    return Object.freeze({
      contractVersion:1,
      mode:source.mode || 'unknown',
      status,
      sourceType:source.sourceType || 'unknown',
      provenance:source.provenance || null,
      nearestObservationDistanceKm:finiteOrNull(source.nearestObservationDistanceKm),
      supportingSiteCount:countOrNull(source.supportingSiteCount),
      effectiveSupport:finiteOrNull(source.effectiveSupport),
      sampleDistanceKm:finiteOrNull(source.sampleDistanceKm),
      nativeResolution:source.nativeResolution ?? null,
      analysisCellResolution:source.analysisCellResolution ?? null,
      maximumSupportDistanceKm:finiteOrNull(source.maximumSupportDistanceKm),
      supportKernel:source.supportKernel ?? null,
      fallbackBehavior:source.fallbackBehavior ?? null,
      geographicSupport:source.geographicSupport && typeof source.geographicSupport === 'object'
        ? Object.freeze({ ...source.geographicSupport }) : null,
      connectivity:source.connectivity && typeof source.connectivity === 'object'
        ? Object.freeze({ ...source.connectivity }) : null,
      confidenceFactor:clampUnit(source.confidenceFactor, status === 'supported' ? 1 : status === 'limited' ? 0.55 : 0),
      notes:source.notes == null ? null : String(source.notes),
      distanceChangesExperienceScore:false
    });
  }

  function createDiveExperienceModel(options = {}) {
    const confidenceThresholds = Object.freeze({ ...DEFAULT_CONFIDENCE_THRESHOLDS, ...(options.confidenceThresholds || {}) });
    if (!(confidenceThresholds.high > confidenceThresholds.moderate && confidenceThresholds.moderate > confidenceThresholds.limited &&
        confidenceThresholds.limited >= 0 && confidenceThresholds.high <= 1)) {
      throw new TypeError('Confidence thresholds must be ordered between 0 and 1.');
    }
    const overallThresholds = Object.freeze({ ...DEFAULT_OVERALL_THRESHOLDS, ...(options.overallThresholds || {}) });
    if (!(overallThresholds.excellent > overallThresholds.good && overallThresholds.good > overallThresholds.fair &&
        overallThresholds.fair >= 0 && overallThresholds.excellent <= 100)) {
      throw new TypeError('Overall score thresholds must be ordered from Excellent to Challenging within 0 to 100.');
    }
    const physicalConditionThresholds = Object.freeze({ ...DEFAULT_PHYSICAL_CONDITION_THRESHOLDS, ...(options.physicalConditionThresholds || {}) });
    if (!(physicalConditionThresholds.comfortable > physicalConditionThresholds.favorable &&
        physicalConditionThresholds.favorable > physicalConditionThresholds.mixed &&
        physicalConditionThresholds.mixed >= 0 && physicalConditionThresholds.comfortable <= 100)) {
      throw new TypeError('Physical-condition thresholds must be ordered from Comfortable to Demanding within 0 to 100.');
    }
    const labelOverall = score => overallLabel(score, overallThresholds);
    const labelPhysical = score => physicalConditionLabel(score, physicalConditionThresholds);
    const groups = DEFAULT_GROUPS.map(group => Object.freeze({
      ...group,
      weight:Number(options.groupWeights?.[group.id] ?? group.weight)
    }));
    if (groups.some(group => !Number.isFinite(group.weight) || group.weight <= 0)) {
      throw new TypeError('Each Dive Experience group weight must be finite and positive so neither group loses its configured influence.');
    }
    const dimensions = DIMENSIONS.map(base => {
      const override = options.dimensionOverrides?.[base.id] || {};
      const updated = { ...base, ...override, id:base.id };
      if (!Number.isFinite(Number(updated.weight)) || Number(updated.weight) < 0 ||
          (updated.isScoreDimension && !groups.some(group => group.id === updated.groupId))) {
        throw new TypeError(`Dimension ${base.id} must have a nonnegative finite weight and score dimensions must have a known scoring group.`);
      }
      return Object.freeze(updated);
    });
    const dimensionConfig = Object.freeze(Object.fromEntries(dimensions.map(dimension => [dimension.id, dimension])));
    const scoreDimensions = Object.freeze(dimensions.filter(dimension => dimension.isScoreDimension));
    const configuredGroupWeight = new Map(groups.map(group => [group.id,
      scoreDimensions.filter(dimension => dimension.groupId === group.id).reduce((sum, dimension) => sum + Number(dimension.weight), 0)]));
    for (const group of groups) {
      if (!(configuredGroupWeight.get(group.id) > 0)) throw new TypeError(`Scoring group ${group.id} must retain a positive configured dimension weight.`);
    }
    const configuredScoreWeight = scoreDimensions.reduce((sum, dimension) => sum + Number(dimension.weight), 0);
    const enabledScoreWeight = scoreDimensions.filter(dimension => dimension.enabled).reduce((sum, dimension) => sum + Number(dimension.weight), 0);

    function normalizeDimension(config, candidate) {
      const spatialSupport = spatialSupportContract(candidate?.spatialSupport);
      const supportIsDefensible = spatialSupport.status === 'supported' || spatialSupport.status === 'limited';
      const isAvailable = Boolean(config.enabled && candidate?.isAvailable === true && supportIsDefensible && finiteScore(candidate?.experienceScore));
      const provenance = PROVENANCE.includes(candidate?.provenance) ? candidate.provenance : 'unknown';
      const evidenceLevel = EVIDENCE_LEVELS.includes(candidate?.evidenceLevel) ? candidate.evidenceLevel : 'none';
      const rawValue = candidate?.rawValue == null || !Number.isFinite(Number(candidate.rawValue)) ? null : Number(candidate.rawValue);
      return Object.freeze({
        ...config,
        rawValue:isAvailable ? rawValue : null,
        unit:candidate?.unit ?? config.unit ?? null,
        descriptiveCategory:isAvailable && candidate?.descriptiveCategory != null ? String(candidate.descriptiveCategory) : null,
        experienceScore:isAvailable ? Number(candidate.experienceScore) : null,
        evidenceLevel:isAvailable ? evidenceLevel : 'none',
        provenance:isAvailable ? provenance : 'unknown',
        isEstimated:isAvailable && candidate?.isEstimated === true,
        isAvailable,
        notes:candidate?.notes ? String(candidate.notes) : (config.status === 'pending'
          ? (config.availabilityReason || 'Configured for a future data integration; no score is supplied.') : null),
        source:isAvailable && candidate?.source ? String(candidate.source) : null,
        sampleDistanceKm:spatialSupport.sampleDistanceKm,
        spatialSupport,
        normalizedWeight:null,
        normalizedOverallWeight:null
      });
    }

    function normalizeSupportOnly(config, candidate) {
      const spatialSupport = spatialSupportContract(candidate?.spatialSupport);
      const supportIsDefensible = spatialSupport.status === 'supported' || spatialSupport.status === 'limited';
      const isAvailable = Boolean(config.enabled && candidate?.isAvailable === true && supportIsDefensible);
      return Object.freeze({
        ...config,
        rawValue:isAvailable && Number.isFinite(Number(candidate?.rawValue)) ? Number(candidate.rawValue) : null,
        unit:candidate?.unit ?? config.unit ?? null,
        descriptiveCategory:isAvailable && candidate?.descriptiveCategory != null ? String(candidate.descriptiveCategory) : null,
        experienceScore:null,
        evidenceLevel:isAvailable && EVIDENCE_LEVELS.includes(candidate?.evidenceLevel) ? candidate.evidenceLevel : 'none',
        provenance:isAvailable && PROVENANCE.includes(candidate?.provenance) ? candidate.provenance : 'unknown',
        isEstimated:isAvailable && candidate?.isEstimated === true,
        isAvailable,
        notes:candidate?.notes ? String(candidate.notes) : null,
        source:isAvailable && candidate?.source ? String(candidate.source) : null,
        sampleDistanceKm:spatialSupport.sampleDistanceKm,
        spatialSupport,
        normalizedWeight:null,
        normalizedOverallWeight:null
      });
    }

    function calculate({ location = null, month = null, dimensions:inputs = {} } = {}) {
      const detailRows = dimensions.map(config => {
        const candidate = inputs instanceof Map ? inputs.get(config.id) : inputs?.[config.id];
        return config.isScoreDimension ? normalizeDimension(config, candidate) : normalizeSupportOnly(config, candidate);
      });
      const resultById = new Map(detailRows.map(row => [row.id, row]));
      const groupResults = groups.map(group => {
        const configuredRows = scoreDimensions.filter(dimension => dimension.groupId === group.id);
        const available = configuredRows.map(dimension => resultById.get(dimension.id)).filter(dimension => dimension.isAvailable);
        const fullWeight = configuredGroupWeight.get(group.id);
        const availableWeight = available.reduce((sum, dimension) => sum + Number(dimension.weight), 0);
        const completeness = availableWeight / fullWeight;
        const score = availableWeight > 0
          ? available.reduce((sum, dimension) => sum + dimension.experienceScore * dimension.weight, 0) / availableWeight
          : null;
        const evidenceQuality = availableWeight > 0 ? available.reduce((sum, dimension) => {
          const sourceStrength = PROVENANCE_STRENGTH[dimension.provenance] ?? 0;
          const declaredStrength = EVIDENCE_STRENGTH[dimension.evidenceLevel] ?? 0;
          return sum + dimension.weight * sourceStrength * declaredStrength * dimension.spatialSupport.confidenceFactor;
        }, 0) / availableWeight : 0;
        return Object.freeze({
          id:group.id, label:group.label, configuredWeight:group.weight,
          configuredDimensionWeight:fullWeight, availableDimensionWeight:availableWeight,
          score:score == null ? null : Number(score.toFixed(3)),
          scoreLabel:score == null ? null : group.id === 'physicalExperience' ? labelPhysical(score) : labelOverall(score),
          completeness:Number(completeness.toFixed(4)), completenessPercentage:Number((completeness * 100).toFixed(1)),
          confidenceValue:Number(evidenceQuality.toFixed(4)),
          activeDimensions:Object.freeze(available.map(dimension => dimension.id)),
          unavailableDimensions:Object.freeze(configuredRows.filter(dimension => !resultById.get(dimension.id).isAvailable).map(dimension => dimension.id))
        });
      });
      const totalBlockWeight = groups.reduce((sum, group) => sum + group.weight, 0);
      const groupById = new Map(groupResults.map(group => [group.id, group]));
      const scoreCompleteness = groupResults.reduce((sum, group) => sum + group.configuredWeight / totalBlockWeight * group.completeness, 0);
      const allGroupsAvailable = groupResults.every(group => group.score != null);
      const active = detailRows.filter(dimension => dimension.isScoreDimension && dimension.isAvailable);
      const activeDimensionCount = active.length;
      const canScore = allGroupsAvailable && activeDimensionCount >= MIN_SCORE_DIMENSIONS && scoreCompleteness * 100 >= MIN_SCORE_WEIGHT_COVERAGE_PCT;
      const score = canScore
        ? Math.round(groupResults.reduce((sum, group) => sum + (group.score * group.configuredWeight), 0) / totalBlockWeight)
        : null;
      const evidenceBearingGroups = groupResults.filter(group => group.score != null);
      const evidenceWeight = evidenceBearingGroups.reduce((sum, group) => sum + group.configuredWeight, 0);
      const confidenceValue = evidenceWeight > 0
        ? evidenceBearingGroups.reduce((sum, group) => sum + group.confidenceValue * group.configuredWeight, 0) / evidenceWeight
        : 0;
      const confidence = confidenceLabel(confidenceValue, confidenceThresholds);
      const normalizedDetails = Object.freeze(detailRows.map(dimension => {
        if (!dimension.isAvailable || !dimension.isScoreDimension) return dimension;
        const group = groupById.get(dimension.groupId);
        const groupAvailableWeight = group.availableDimensionWeight;
        return Object.freeze({
          ...dimension,
          normalizedWeight:groupAvailableWeight ? Number((dimension.weight / groupAvailableWeight * 100).toFixed(2)) : null,
          normalizedOverallWeight:Number((dimension.weight / groupAvailableWeight * group.configuredWeight / totalBlockWeight * 100).toFixed(2))
        });
      }));
      const physical = groupById.get('physicalExperience');
      const ecological = groupById.get('reefEcologicalExperience');
      const canScorePhysicalOnly = physical.score != null && physical.completeness >= MIN_PHYSICAL_GROUP_COMPLETENESS &&
        physical.activeDimensions.length >= MIN_PHYSICAL_GROUP_DIMENSIONS;
      const keyReasons = (canScore || canScorePhysicalOnly) ? active
        .filter(dimension => canScore || dimension.groupId === 'physicalExperience').map(dimension => ({
        text:reasonText(dimension), id:dimension.id,
        impact:Math.abs(dimension.experienceScore - 65) * dimension.weight *
          (PROVENANCE_STRENGTH[dimension.provenance] ?? 0) *
          (EVIDENCE_STRENGTH[dimension.evidenceLevel] ?? 0) * dimension.spatialSupport.confidenceFactor +
          (dimension.id === 'fishDensity' && !['lower typical', 'upper typical'].includes(String(dimension.descriptiveCategory).toLowerCase()) ? 500 : 0)
      })).filter(reason => reason.text)
        .sort((a, b) => b.impact - a.impact || a.id.localeCompare(b.id)).slice(0, 4).map(({ text }) => text) : [];
      const supportDimension = normalizedDetails.find(dimension => dimension.id === 'coralRecords');
      const activeDimensions = Object.freeze(active.map(dimension => dimension.id));
      const unavailableDimensions = Object.freeze(scoreDimensions.filter(dimension => !resultById.get(dimension.id).isAvailable).map(dimension => dimension.id));
      const legacyAvailableWeight = active.reduce((sum, dimension) => sum + dimension.weight, 0);
      const legacyWeightedSum = active.reduce((sum, dimension) => sum + dimension.experienceScore * dimension.weight, 0);
      return Object.freeze({
        location:location && Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng ?? location.lon))
          ? Object.freeze({ lat:Number(location.lat), lng:Number(location.lng ?? location.lon) }) : null,
        month:Number.isInteger(Number(month)) && Number(month) >= 1 && Number(month) <= 12 ? Number(month) : null,
        score,
        label:labelOverall(score),
        overallOutlook:Object.freeze({ status:canScore ? 'scored' : 'unavailable', score, label:labelOverall(score) }),
        diveConditionsScore:canScorePhysicalOnly ? Math.round(physical.score) : null,
        diveConditionsLabel:canScorePhysicalOnly ? labelPhysical(physical.score) : null,
        diveConditionsStatus:canScorePhysicalOnly ? 'scored' : 'insufficient-physical-support',
        reefExperience:Object.freeze({ status:ecological.score == null ? 'unavailable' : 'scored', score:ecological.score,
          label:ecological.score == null ? null : labelOverall(ecological.score) }),
        confidence,
        confidenceValue:Number(confidenceValue.toFixed(4)),
        confidenceBasisGroups:Object.freeze(evidenceBearingGroups.map(group => group.id)),
        scoreCompleteness:Number(scoreCompleteness.toFixed(4)),
        scoreCompletenessPercentage:Number((scoreCompleteness * 100).toFixed(1)),
        activeDimensions,
        unavailableDimensions,
        groups:Object.freeze(groupResults),
        scoreStatus:canScore ? 'scored' : 'insufficient-support',
        rawWeightedSum:Number(active.reduce((sum, dimension) => sum + dimension.experienceScore * dimension.weight, 0).toFixed(2)),
        rawWeightedScore:Number((active.reduce((sum, dimension) => sum + dimension.experienceScore * dimension.weight, 0) / configuredScoreWeight).toFixed(2)),
        legacyGlobalNormalizedScore:legacyAvailableWeight ? Math.round(legacyWeightedSum / legacyAvailableWeight) : null,
        activeWeightPercentage:Number((scoreCompleteness * 100).toFixed(1)),
        missingWeightPercentage:Number((100 - scoreCompleteness * 100).toFixed(1)),
        activeConfiguredWeightPercentage:enabledScoreWeight ? Number((active.reduce((sum, dimension) => sum + dimension.weight, 0) / enabledScoreWeight * 100).toFixed(1)) : 0,
        activeScoringDimensionCount:activeDimensionCount,
        inactiveScoringDimensionCount:scoreDimensions.length - activeDimensionCount,
        completenessText:`${activeDimensionCount} of ${scoreDimensions.length} scoring dimensions available`,
        configuredActiveScoringDimensionCount:scoreDimensions.filter(dimension => dimension.enabled).length,
        configuredScoringDimensionCount:scoreDimensions.length,
        keyReasons:Object.freeze(keyReasons),
        dimensions:normalizedDetails,
        support:{ coralRecords:supportDimension?.isAvailable === true ? Object.freeze({
          available:true, rawValue:supportDimension.rawValue, unit:supportDimension.unit,
          descriptiveCategory:supportDimension.descriptiveCategory, provenance:supportDimension.provenance,
          evidenceLevel:supportDimension.evidenceLevel, isEstimated:supportDimension.isEstimated,
          notes:supportDimension.notes, spatialSupport:supportDimension.spatialSupport
        }) : Object.freeze({ available:false, notes:'Coral records are supporting context only and do not add to the experience score.' }) }
      });
    }

    function configuration() {
      return Object.freeze({
        scoringVersion:SCORING_VERSION,
        dimensions:Object.freeze(dimensions),
        groups:Object.freeze(groups.map(group => Object.freeze({
          ...group,
          configuredDimensionWeight:configuredGroupWeight.get(group.id),
          relativeInfluencePercentage:Number((group.weight / groups.reduce((sum, item) => sum + item.weight, 0) * 100).toFixed(2)),
          dimensions:Object.freeze(scoreDimensions.filter(dimension => dimension.groupId === group.id).map(dimension => Object.freeze({
            id:dimension.id, weight:dimension.weight, enabled:dimension.enabled, status:dimension.status,
            ...(dimension.availabilityReason ? { availabilityReason:dimension.availabilityReason } : {}),
            ...(dimension.supportingEvidenceSources ? { supportingEvidenceSources:dimension.supportingEvidenceSources,
              supportSemantics:dimension.supportSemantics } : {})
          })))
        }))),
        totalListedWeight:dimensions.reduce((sum, dimension) => sum + Number(dimension.weight), 0),
        configuredScoreWeight:configuredScoreWeight,
        currentlyEnabledScoreWeight:enabledScoreWeight,
        currentEnabledDimensions:Object.freeze(scoreDimensions.filter(dimension => dimension.enabled).map(dimension => dimension.id)),
        pendingDimensions:Object.freeze(dimensions.filter(dimension => dimension.status === 'pending').map(dimension => dimension.id)),
        supportOnlyDimensions:Object.freeze(dimensions.filter(dimension => !dimension.isScoreDimension).map(dimension => dimension.id)),
        minScoreWeightCoveragePct:MIN_SCORE_WEIGHT_COVERAGE_PCT,
        minScoreDimensions:MIN_SCORE_DIMENSIONS,
        overallThresholds,
        physicalConditionThresholds,
        confidenceThresholds,
        physicalFallback:Object.freeze({ minimumGroupCompleteness:MIN_PHYSICAL_GROUP_COMPLETENESS,
          minimumAvailableDimensions:MIN_PHYSICAL_GROUP_DIMENSIONS, label:'Dive Conditions Score',
          whenEcologyUnavailable:'Keep overall outlook unavailable; expose this physical-only result separately.' }),
        spatialSupportContract:Object.freeze({ version:1, acceptedStatuses:Object.freeze(['supported', 'limited']), scoreEffect:'none', confidenceEffect:'confidenceFactor only' }),
        thermalHistoryExperienceHeuristic:THERMAL_HISTORY_THRESHOLDS.map(({ maximumExclusive, score, category }) => ({
          maximumExclusive:Number.isFinite(maximumExclusive) ? maximumExclusive : null, score, category
        })),
        fishOutlookBands:FISH_OUTLOOK_BANDS,
        reefHabitatCoralEvidence:Object.freeze({
          unit:'evidence index (0–100)',
          notAClaim:'Does not estimate live-coral percentage, reef condition, coral abundance, or safety.',
          componentWeights:REEF_HABITAT_EVIDENCE.componentWeights,
          reefFootprintBands:REEF_HABITAT_EVIDENCE.reefFootprintBands,
          coralRecordRankBands:REEF_HABITAT_EVIDENCE.coralRecordRankBands,
          compositeBands:REEF_HABITAT_EVIDENCE.compositeBands,
          requiredInputs:Object.freeze(['reefExtentPercentOfWetCell', 'coralRecordPercentile']),
          missingInputBehavior:'Unavailable; do not substitute zero or infer absence from no record.'
        }),
        normalizationMethod:'Normalize available dimensions within each scoring group, then combine group scores using fixed configured group weights; missing dimensions lower completeness without reallocating their group influence. Confidence summarizes evidence quality among supported groups and does not include completeness.'
      });
    }

    return Object.freeze({
      PROVENANCE, EVIDENCE_LEVELS, SPATIAL_SUPPORT_STATUSES, DIMENSIONS:Object.freeze(dimensions), SCORE_DIMENSIONS:scoreDimensions,
      CONFIGURED_SCORE_WEIGHT:configuredScoreWeight, CURRENTLY_ENABLED_SCORE_WEIGHT:enabledScoreWeight,
      MIN_SCORE_WEIGHT_COVERAGE_PCT, MIN_SCORE_DIMENSIONS, overallLabel:labelOverall,
      physicalConditionLabel:labelPhysical, confidenceLabel, scoreThermalHistory, fishOutlookBand, fishOutlookScore, reefHabitatCoralEvidenceScore,
      reasonText, spatialSupportContract, calculate, configuration
    });
  }

  const defaultModel = createDiveExperienceModel();
  function confidenceOpacity(label) { return ({ High:0.92, Moderate:0.72, Limited:0.5, Low:0.32 })[label] ?? 0; }
  return Object.freeze({
    SCORING_VERSION, PROVENANCE, EVIDENCE_LEVELS, SPATIAL_SUPPORT_STATUSES, DEFAULT_GROUPS, DIMENSIONS, SCORE_DIMENSIONS:defaultModel.SCORE_DIMENSIONS,
    CONFIGURED_SCORE_WEIGHT:defaultModel.CONFIGURED_SCORE_WEIGHT,
    CURRENTLY_ENABLED_SCORE_WEIGHT:defaultModel.CURRENTLY_ENABLED_SCORE_WEIGHT,
    MIN_SCORE_WEIGHT_COVERAGE_PCT, MIN_SCORE_DIMENSIONS, overallLabel, physicalConditionLabel, confidenceLabel, scoreThermalHistory,
    FISH_OUTLOOK_BANDS, fishOutlookBand, fishOutlookScore, REEF_HABITAT_EVIDENCE, reefHabitatCoralEvidenceScore,
    reasonText, spatialSupportContract, createDiveExperienceModel,
    calculate:defaultModel.calculate, confidenceOpacity, configuration:defaultModel.configuration
  });
});
