# Dive Experience confidence guide

## Purpose

This guide defines how DiveAtlas should describe the strength of evidence behind a Dive Experience estimate. Confidence is an ordinal evidence-quality summary, not a probability that the score is correct and not a measure of whether diving is safe. It must remain separate from both experience score and score completeness.

Use this guide when adding a data source, producing a dimension value, reviewing a location, or calibrating the user-facing `High`, `Moderate`, `Limited`, and `Low` labels.

## Output contract

Every result keeps these fields distinct:

- **Experience score**: the estimated quality of the dive experience under the configured scoring model.
- **Confidence**: the strength and suitability of evidence supporting the available dimension estimates.
- **Completeness**: the configured score weight represented by available dimensions, shown to users as a dimension count such as `6 of 7 dimensions available`.
- **Dimension support**: source provenance and spatial/temporal support for each dimension.

Missing dimensions reduce completeness. They do not automatically lower the confidence of other dimensions. Confidence must not change the experience score or the map hue; it may affect how assertively a supported score is rendered.

### Distance rule

Distance has two distinct roles, and implementations must not conflate them:

1. **Estimating a dimension value:** for an observation-derived estimate that combines multiple source observations, distance may determine which observations qualify as support and how much each qualifying observation contributes. Use a documented, dimension-specific kernel or estimator, normalize contributions as required by that estimator, and validate its support limits with spatial holdouts. The resulting estimated measurement may change because nearer observations contribute more. Its mapped dimension score may then change because the estimated measurement changed.
2. **Assessing evidence strength:** retain nearest-source distance and other spatial-support metadata, and use a validated support/confidence rule to describe how strongly the estimate is supported.

Do **not** apply a separate post-estimation penalty such as `score × distance factor`, subtract points because the nearest source is far away, or lower an otherwise identical dimension score solely because its confidence is lower. If support falls outside the validated limit or fails minimum-support requirements, mark the dimension unavailable; let group scoring and completeness handle that missing dimension. For gridded products, sample according to the source's documented grid/fallback semantics; sample distance can affect support or confidence but is not a generic score penalty.

For the current NRMN fish estimate, distance-weighting among observations is part of the upstream abundance estimator. The nearest-observation distance factor is separately used as spatial-support evidence in Dive Experience confidence. Do not apply that factor a second time to the emitted fish experience score.

## Current scoring and confidence behavior

The production scoring system defines physical and ecological groups with configured weights 65 and 35. It computes each group's score from available dimensions, preserving each group's configured influence in the combined score. Completeness is the configured group-weighted fraction of available dimension weights. The active website package is `data/dive-experience-outlook/v2/` and carries scoring version `dive-experience-v5`; its manifest is the runtime authority for thresholds, weights, and data provenance.

For each available dimension, current confidence evidence is combined as:

`dimension weight × provenance strength × declared evidence strength × spatial-support confidence factor`

The model averages these contributions within each supported group, then combines supported group confidence values using the configured group weights, normalized across groups that have a score. Completeness is not included in that confidence calculation. Unsupported dimensions are unavailable rather than assigned invented scores.

Current provenance strengths are `observed 0.95`, `climatology_or_model 0.82`, `regional_estimate 0.60`, `ecological_outlook 0.42`, and `unknown 0`. Current declared evidence strengths are `high 1.0`, `moderate 0.8`, `limited 0.55`, and `none 0`. These are model inputs, not calibrated probabilities. The current display boundaries are `High >= 0.75`, `Moderate >= 0.40`, `Limited >= 0.20`, otherwise `Low`.

The implementation is in `js/dive-experience-model.js`. Keep this guide aligned with its configuration when that configuration changes.

## Dimension evidence review

Before a dimension is marked available, record the following in its result or source metadata:

| Evidence field | Questions to answer | What to retain |
|---|---|---|
| Provenance | Is this a direct observation, a gridded/climatological product, a regional estimate, or an ecological outlook? | Provider, product/release, transformation, source type |
| Spatial support | How far is the sampled cell/site? How many independent support sites contribute? Is the support in the same relevant habitat/water area? | Nearest distance, unique site count, effective support, native resolution, fallback, connectivity evidence if actually available |
| Temporal support | Does the observation/product represent the selected month, a long-term climatology, or a dated historical event? | Observation or period date, date precision, age, temporal matching rule |
| Representativeness | Are methods, units, and population/sample definitions compatible with the target? | Protocol/method, unit, inclusion rules, known caveats |
| Validation | Does the estimator work in held-out spatial regions and across relevant environments? | Blocked validation results, region, distance-to-support error |

An absent value, a failed lookup, or a location outside defensible support is **unavailable**. Do not replace these states with zero, a global mean, or a nearest value outside an approved support rule.

### Evidence-level rubric

Assign an evidence level only after the source-specific checks above. These definitions are qualitative guardrails; they do not establish universal distance or age cutoffs.

- **High**: authoritative, well-described source; measurement and target semantics align; strong local or native-grid support; temporal period matches the estimate; independent support and spatially blocked validation show stable errors in comparable regions.
- **Moderate**: source and semantics are credible, but one material limitation exists, such as moderate distance, older observations, modest independent support, coarse native resolution, or a documented fallback.
- **Limited**: evidence is indirect, sparse, stale for the intended use, methodologically mixed, or extrapolated near the edge of validated environmental/spatial support. Keep the dimension only if the support contract still allows a defensible estimate.
- **None / unavailable**: no valid value, unknown provenance, incompatible measurement semantics, failed quality checks, or support outside the defensible range. Do not score it.

Use dimension-specific spatial and temporal rules. A 20 km distance may be acceptable for a broad gridded climatology and indefensible for a localized survey observation; a historical benthic survey may describe long-term context but not current reef condition.

## Source-specific application

### Physical conditions

For water temperature, clarity, current, and waves, retain product/source, native resolution, selected-month or climatology semantics, sample distance, and fallback behavior. Model or climatology provenance does not by itself imply high confidence: source coverage, sampling quality, and validation still matter.

### Missing dimension data over ocean

When a direct value is missing, distinguish a valid source fallback from a new regional estimate. For gridded products, record the native product's documented fallback and selected source cell. If an observation-derived or regional estimator is used, mark provenance as `regional_estimate` and retain its estimator/version, compatible month and measurement level, unique supporting sources, effective support, nearest and weighted distances, and source coordinates or region where available. Repeated probes of the same cell are one source, not independent support. Exclude land probes and unsupported cross-barrier or cross-water-mass support where those distinctions can be established.

Assign evidence level and `spatialSupport` only after checking source semantics, temporal match, validated distance/support limits, and spatially blocked validation results. Distance may affect which inputs qualify and how a raw estimated value is formed; separately, a validated support rule may affect availability or the confidence factor. Do not apply distance a second time as a score penalty. An estimate outside validation or minimum-support requirements is unavailable, not a low-confidence score. A technical lookup failure is not evidence that the ocean condition itself is missing and must not silently invoke a fallback; retry or report the failed lookup distinctly.

Until source-specific support limits and error behavior are validated across relevant ocean regions, keep any new regional estimate out of published scores. Do not assign a confidence level just because a value was produced. A documented fallback can support `Moderate` or `Limited` evidence only when the rubric's source, temporal, spatial, and validation checks support that judgment.

### Fish abundance outlook

Retain nearest observation distance, independent supporting-site count, effective support, estimation tier, and validation error by distance/region. Current NRMN data do not provide a recoverable complete zero-count survey-block denominator. Therefore the result is a relative fish-abundance outlook conditional on recorded fish observations, not an unconditional density census. This limitation must remain visible in source notes and must not be hidden by a large record count.

### Reef thermal stress history (DHW)

The active ecological thermal dimension uses NOAA Coral Reef Watch annual maximum DHW history. Retain native-grid resolution, sample distance, number of valid annual values, and any nearest-grid fallback. DHW represents accumulated heat-stress exposure; it does not prove bleaching or mortality.

The separate NOAA Ocean Heat History layer summarizes marine heatwave exposure. It may be retained as contextual evidence or a validation/recency signal, but should not receive a second independent score weight without evidence that it adds information beyond the DHW dimension.

### Reef habitat & coral evidence

The 15-point dimension is a mapped-evidence index, not numeric live-cover measurement. It combines the percentage of wet analysis-cell area intersecting the mapped Reef extent raster with the existing Coral Records relative rank. Each component is converted to seven documented score stages and averaged equally. Reef footprint describes mapped habitat extent; coral occurrence rank describes relative catalogued evidence and is affected by sampling effort. Neither indicates live cover, reef condition, coral abundance, or safety.

Both source inputs are required. Missing data stays unavailable rather than becoming zero. A present Reef extent sample with 0% mapped footprint scores the mapped-footprint component as zero, while the notes must say this is not proof of reef absence. Until the Coral Records grid retains nearest-source distance and independent supporting-site count, its spatial support is `limited` and confidence must reflect that limitation. Never infer cover from reef-footprint presence or occurrence-record counts.

### Observed bleaching (not a scoring dimension)

Keep `present`, `absent`, and `unknown` distinct. An `absent` result means bleaching was not observed in a recorded survey; no record means unknown, not absent. Occurrence reports are not bleaching percentages. Only use a percentage score when a source actually measures the percentage of colonies bleached and its denominator/method are retained. Date the signal and define a relevance window before using it in a present-day experience estimate.

Observed bleaching remains contextual only and is excluded from the current scoring bucket. A future scoring change would need an explicit user-facing dimension and validated scoring semantics before it could contribute points.

## Practical scoring procedure

1. **Resolve a candidate value** using a documented, source-specific temporal and spatial method. For observation-derived estimates, distance may select and weight qualifying observations; record that estimator separately from the later confidence assessment.
2. **Check validity and semantic compatibility** (units, measurement basis, date precision, method, and target definition).
3. **Build `spatialSupport`** with the relevant distance, native resolution, unique supporting sites/effective support, fallback, status, and confidence factor. Record only geographic/connectivity claims supported by the source. Do not turn the confidence factor into a score multiplier.
4. **Assign provenance and evidence level** from the rubric and retained metadata. Do not infer evidence quality from the resulting experience score.
5. **Mark the dimension available only if support is defensible**. Otherwise return unavailable and preserve the reason.
6. **Calculate score and completeness independently** using the configured dimension/group weights.
7. **Aggregate confidence** using the current model formula, and retain dimension/group components for inspection so the overall label can be explained. Holding estimated dimension values and availability constant, changing only distance/confidence metadata must not change the score.
8. **Review surprising cases** where high completeness coexists with low confidence, or low completeness coexists with strong evidence for the few available dimensions. Both can be valid and should remain distinguishable.

## Calibration and release checklist

Before changing provenance multipliers, evidence levels, spatial-support factors, or confidence boundaries:

1. Freeze representative locations and months across tropical, temperate, island, high-current, low-data, and edge-of-coverage regions.
2. Use the same spatial-block/purged validation protocol as the dimension estimator. Do not use random row splits as the primary evidence.
3. Compare errors, rank behavior, coverage, and error-versus-distance across confidence bands and regions. Confirm that higher confidence bands have meaningfully stronger/stabler support; do not require equal-sized bands.
4. Check source, temporal-age, support-count, and spatial-support combinations for systematic under- or over-confidence.
5. Change one calibration component at a time; record the dataset/version, validation design, rationale, and before/after distributions.
6. Treat `High / Moderate / Limited / Low` as ordered evidence labels, never as probability statements.
7. Confirm confidence affects evidence presentation only; score and dimension completeness remain unchanged for the same dimension values/availability.

Until this calibration is completed, retain the configured boundaries and describe them as provisional evidence thresholds. A lack of `High` cells is not by itself a reason to lower the threshold.

## Example interpretation

`Dive Experience Score: 78 / Good` and `Confidence: Moderate` can be appropriate when the score is supported by several relevant dimensions but one or more dimensions rely on indirect, older, coarse, or regionally estimated evidence. `6 of 7 scoring dimensions available` separately describes completeness. Neither phrase implies a 78% chance of a good dive or a 78% confidence level.

## Relevant implementation and data references

- `js/dive-experience-model.js` — weights, provenance/evidence strengths, support contract, aggregation, and confidence thresholds.
- `js/dive-experience-outlook-map.js` — score-grid dimension/support encoding.
- `data/dive-experience-outlook/v2/manifest.json` — active published version, source and support semantics.
- `data/dive-experience-outlook/v2/manifest.json` — active source, temporal, spatial-support, and score semantics, including Reef extent and Coral Records inputs.
- `js/dive-conditions-service.js` — monthly physical-condition sampling and source metadata.
- `tools/build_dive_experience_support.js` — packing static fish and thermal-history support into the runtime grid.
