# Dive Experience score guide

## Purpose

This guide explains how DiveAtlas turns monthly physical conditions and ecological context into a consumer-facing Dive Experience Score. It is an implementation guide, not a safety rating, live forecast, or claim of scientific certainty. Use it when reviewing a score, adding a dimension, or changing score configuration.

The score answers: **given the available evidence for this location and month, how favorable are the modeled physical dive conditions and reef/ecological outlook under the configured rubric?** Confidence and completeness answer different questions and must remain separate.

## Current dimensions and weights

There are 7 score dimensions with 100 configured score points in two groups. Coral Records is separate support-only context with zero score weight.

| Group | Dimension | Weight | Status |
|---|---|---:|---|
| Physical (65) | Water clarity | 20 | Active |
| Physical (65) | Current | 15 | Active |
| Physical (65) | Wave height | 15 | Active |
| Physical (65) | Water temperature | 15 | Active |
| Reef/ecological (35) | Reef habitat & coral evidence | 15 | Active rubric; unavailable until both mapped reef footprint and Coral Records rank are present |
| Reef/ecological (35) | Fish abundance outlook | 10 | Active |
| Reef/ecological (35) | Thermal stress history | 10 | Active |

Configured group influence is physical `65/100 = 65%` and ecological `35/100 = 35%`. Dimension weights within each group sum to their group weight. Coral Records has no score weight; it is support-only.

## Score construction

### 1. Convert each source value to a dimension score

An available scoring dimension supplies a finite `experienceScore` from 0 to 100, plus its raw value/unit where meaningful, category, provenance, evidence level, and defensible `spatialSupport`.

All seven score dimensions use seven explicit measurement stages. The score points are a transparent consumer rubric, not empirically calibrated utility curves or safety limits.

| Dimension | Raw-value bands and score points (low to high experience score) |
|---|---|
| Water temperature | `<=18°C`: Very cool / 0; `>18–20°C`: Cool / 20; `>20–23°C`: Mild / 40; `>23–24°C`: Comfortably mild / 70; `>24–25°C`: Comfortably warm / 80; `>25–30°C`: Warm / 100; `>30°C`: Very warm / 60 |
| Water clarity | `<2 m`: Very low / 0; `2–<5 m`: Low / 20; `5–<8 m`: Fair / 40; `8–<12 m`: Moderate / 60; `12–<15 m`: Good / 80; `15–<20 m`: Very good / 90; `>=20 m`: High / 100 |
| Current | `<0.1 m/s`: Very light / 100; `0.1–<0.3`: Light / 80; `0.3–<0.45`: Moderate / 60; `0.45–<0.6`: Moderately strong / 40; `0.6–<0.9`: Strong / 30; `0.9–1.2`: Very strong / 20; `>1.2`: Extreme / 0 |
| Wave height | `<0.25 m`: Calm / 100; `0.25–<0.5`: Very low / 80; `0.5–<0.75`: Low / 60; `0.75–<1.25`: Moderate / 40; `1.25–<1.6`: Elevated / 30; `1.6–<2 m`: High / 20; `>=2 m`: Very high / 0 |

The established `0.3 m/s` current boundary remains the start of the Moderate band. Keep raw measurements and assigned points distinguishable in diagnostics. Revisit these provisional bands with destination-month benchmark evidence before treating them as calibrated.

Thermal history uses seven fixed DHW bands:

| Mean annual maximum DHW | Points | Category |
|---|---:|---|
| `<2 °C-weeks` | 100 | Very low annual heat stress |
| `2–<4` | 90 | Low annual heat stress |
| `4–<8` | 80 | Elevated annual heat stress |
| `8–<12` | 60 | High annual heat stress |
| `12–<16` | 40 | Very high annual heat stress |
| `16–<20` | 20 | Extreme annual heat stress |
| `>=20` | 0 | Exceptional annual heat stress |

DHW describes accumulated thermal exposure; it does not prove bleaching or mortality.

Fish abundance arrives as a relative 0–100 outlook rank and is converted into seven score stages: `0–14 → 0 Very low`, `15–28 → 17 Low`, `29–42 → 33 Lower typical`, `43–57 → 50 Typical`, `58–71 → 67 Upper typical`, `72–85 → 83 High`, and `86–100 → 100 Very high`. These are ranks, not measured fish counts. The upstream abundance estimator may weight qualifying observations by distance; distance is not applied a second time after mapping to the stage score. Fish values are not an unconditional global density estimate because zero-count survey blocks were not recovered.

### Reef habitat & coral evidence

This dimension is an explicit **evidence index**, not a reef-health or live-coral-cover estimate. It combines two different inputs equally; the equal weighting is a transparent product rubric, not an empirically validated ecological relationship:

`dimensionScore = round((reefFootprintScore + coralRecordRankScore) / 2)`

The reef input is the share of sampled wet area in the 0.5° analysis cell covered by the mapped Reef extent raster. Convert that percent to points using seven fixed bands:

| Mapped reef share of wet cell | Points | Meaning |
|---|---:|---|
| 0% | 0 | No mapped footprint in this source layer |
| >0–1% | 15 | Trace mapped footprint |
| >1–3% | 30 | Very small mapped footprint |
| >3–8% | 45 | Small mapped footprint |
| >8–15% | 60 | Moderate mapped footprint |
| >15–35% | 80 | Broad mapped footprint |
| >35–100% | 100 | Extensive mapped footprint |

The Coral Records input is its existing 0–100 **relative rank**, not a record count or coral abundance. Convert the rank to seven stages: `0–5 → 0`, `>5–15 → 15`, `>15–30 → 30`, `>30–50 → 45`, `>50–70 → 60`, `>70–90 → 80`, and `>90–100 → 100`. The percentile reference population and source release must remain recorded with the derived grid; because occurrence collection is effort-biased, a high rank means comparatively more catalogued record evidence, not better reef condition.

The combined index uses seven descriptive bands: `0–14 Very limited`, `15–29 Limited`, `30–44 Some`, `45–59 Moderate`, `60–74 Strong`, `75–89 Very strong`, and `90–100 Extensive mapped reef and coral-record evidence`. These labels describe evidence strength only. They must not be rendered as “good coral”, percent cover, coral abundance, or dive safety.

Both inputs are required to score the dimension. An absent source value is unavailable, not zero. A measured reef share of zero is a valid “no mapped footprint” result, but is not proof that no reef exists. Coral record support remains spatially limited while the grid lacks nearest-source distance and independent site counts. The mapped Reef extent source has approximately 1 km rendered pixels; use wet-cell area as denominator and retain the sampling resolution/method. The v2 runtime package includes this index with those limitations preserved.

Observed bleaching and Macroalgae Cover are not dimensions in this score model.

### 2. Check dimension availability

A dimension contributes only when it is enabled, its value and score are valid, and its spatial-support status is `supported` or `limited` under source-specific rules. Missing, unsupported, ambiguous, or semantically incompatible measurements stay unavailable. Do not substitute zero, infer absence from no report, or fill with a global average.

### 3. Calculate each group score

Available dimensions are normalized within their own group:

`groupScore = Σ(dimensionScore × dimensionWeight) / Σ(available dimension weights)`

A missing dimension is not treated as zero. Remaining supported dimensions can summarize the group's available evidence, but completeness records the missing weight. Missing ecological weight never transfers to the physical group.

### 4. Combine the groups

When both groups have support and minimum requirements pass:

`overallScore = round(Σ(groupScore × configured group weight) / Σ(configured group weights))`

Under the current configuration:

`overallScore = round((physicalScore × 65 + ecologicalScore × 35) / 100)`

The group weights define long-term relative influence and must match the intended configuration.

### Worked example

Assume physical dimension scores `[80, 70, 40, 100]` for clarity, current, waves, and temperature. Assume only fish (70) and thermal history (80) are available in ecology.

```text
physicalScore = (80×20 + 70×15 + 40×15 + 100×15) / 65 = 73.08
ecologicalScore = (70×10 + 80×10) / 20 = 75.00
overallScore = round((73.08×65 + 75.00×35) / 100) = 74
completeness = (65 + 10 + 10) / 100 = 85% = 6 of 7 dimensions available
```

This yields `Good` under current thresholds, while still showing `6 of 7 dimensions available`.

## Availability and physical-only fallback

The combined Dive Experience score is available only when both groups have support, at least 3 score dimensions are available, and overall completeness is at least 40%.

If ecology has no support, do not call the physical value an overall Dive Experience score. A separate `Dive Conditions Score` may be shown when at least 3 of 4 physical dimensions are available and physical completeness is at least `40/65` (about 62%). Report the reef/ecological group as unavailable.

## Overall labels

| Score | Label |
|---:|---|
| `85–100` | Excellent |
| `70–84` | Good |
| `55–69` | Fair |
| `<55` | Challenging |

These are simple provisional consumer labels, not safety categories, and have not been calibrated against a representative diver-experience survey. Do not adjust them merely to create even category sizes. Physical-only labels use `Comfortable >=85`, `Favorable >=70`, `Mixed >=55`, otherwise `Demanding`.

## Distance rule

Distance has two distinct roles:

1. **During estimation**, an observation-derived method may use distance to decide which observations qualify and how much they contribute to the estimated raw value. If that estimated value changes, the mapped dimension score may change as a consequence.
2. **After estimation**, distance and support metadata inform confidence. Do not apply an additional distance penalty or multiply the resulting dimension/overall score by the confidence factor.

The NRMN Tier B fish estimate is distance-weighted upstream. Its nearest-observation support factor is separate and must not be applied again to the fish experience score. For gridded physical and thermal sources, follow native sampling and fallback semantics; distance may affect support/confidence or make a dimension unavailable outside validated support, but is not a generic score penalty.

If support falls beyond validated limits or below minimum support, mark that dimension unavailable and recompute availability, completeness, and group score. Never lower an otherwise identical score solely because confidence is lower.

## Missing dimension data over ocean

Use this procedure only when the target is a valid ocean location and the selected dimension has no direct valid value. A missing grid value, failed request, land point, and measured zero are different states; never treat them as interchangeable. Retry a transient request failure, but do not turn a persistent technical failure into an environmental estimate.

1. **Follow the source's native semantics first.** For a gridded climatology or model, use its documented nearest-valid-cell or interpolation behavior. Retain the selected month, depth/level, native resolution, source coordinates, and source distance. Do not extend its search radius silently.
2. **Use a regional estimate only when the source does not provide a valid native fallback.** The estimator must be dimension-specific, use the same relevant month and measurement level, and combine compatible raw observations or measurements. Prefer a normalized distance-weighted raw-value estimate over averaging dimension scores. Apply the normal dimension rubric only after resolving the estimated raw value.
3. **Keep support ocean-relevant.** Exclude land probes and sources across land barriers or unrelated water masses where the source supports that distinction. Do not treat repeated samples of the same source cell as independent evidence, or use a previously estimated value as a new independent source.
4. **Require documented support.** Define the maximum distance, minimum independent sources, any effective-support requirement, estimator/kernel, and unsupported conditions for each dimension. These thresholds are provisional until spatially blocked holdout validation shows acceptable error, coverage, and error-versus-distance in relevant ocean regions. Until then, do not enable the regional estimate in a published score; keep it unavailable outside the source's existing validated fallback.
5. **Record and disclose the estimate.** Retain the raw estimated value, resulting score/category, `regional_estimate` provenance, source/version, month/level, estimator, unique and effective support, nearest and weighted distances, and validation/support status. Present it as an estimate with a concise reason; preserve direct-source values as distinct from fallback values.

An estimate may change the dimension score only through its estimated raw value. Confidence and completeness remain separate. If validation or minimum-support conditions fail, leave that dimension unavailable and recompute the group and overall score under the existing availability rules.

## Month handling

Changing month should update only clarity, current, waves, and water temperature. Fish outlook and annual DHW thermal history remain static unless their source semantics explicitly provide month-specific values. Keep selected coordinates fixed while month data load; do not let a stale month result replace the selected month.

## Confidence and completeness

Confidence means evidence strength; completeness means how much of the intended scoring model is represented. Confidence summarizes provenance, declared evidence level, and spatial-support confidence factor. Completeness is available score weight divided by configured score weight while preserving group influence. Show completeness as `X of 7 scoring dimensions available`; do not let either measure alter score inputs. Map hue represents score; evidence quality can soften opacity under the configured rendering function.

See [the confidence guide](dive-experience-confidence-guide.md) for evidence review and confidence calibration.

## Reef habitat & coral evidence measurement contract

The score helper is implemented in `js/dive-experience-model.js` and requires `reefExtentPercentOfWetCell` plus `coralRecordPercentile`. The builder estimates mapped footprint share by sampling local z7 Reef extent alpha tiles within wet subcells of the existing ocean mask, then combines it with Coral Records relative rank. The v2 runtime package includes this derived dimension; do not substitute synthetic or inferred production values.

The source evidence has distinct meanings:

1. Reef extent is a mapped habitat polygon raster at approximately 1 km rendered resolution. The analysis builder samples 4 × 4 points within each wet subcell represented by the existing 8 × 8 ocean mask, then expresses positive samples as a share of sampled wet area. This is a coarse mapped-footprint estimate, not coral cover or reef quality.
2. Coral Records provides the support grid's 0–100 relative rank. It reflects catalogued occurrence evidence, not a raw occurrence count, colony density, or cover. Collection effort and source coverage affect it.
3. Both inputs are required for the composite. When either is missing or unsupported, the dimension is unavailable. A valid 0% reef-footprint sample means no mapped footprint in this source layer, not confirmed reef absence.
4. The composite uses an equal, explicit 50/50 mean of the two component scores. This is an interpretable first-pass product rubric, not an empirically learned ecological relationship; preserve component values so the index can be audited.
5. Keep the spatial-support status limited until Coral Records retains nearest-source distance and independent supporting-site counts. Do not present the index as reef health, live-coral cover, coral abundance, or dive safety.

Observed Bleaching and Macroalgae Cover are not part of this scoring bucket. Their data or map layers must not feed the score unless the scoring design is changed explicitly.

## Versioning and reproducibility

Record `scoringVersion`, `thresholdVersion`, and `dataVersion` with published results. Retain source version, month, cell, raw values, dimension scores, availability reasons, support, group calculations, completeness, confidence, and final label. Any change to weights, dimension mapping, threshold, source semantics, or estimator requires an explicit version update and before/after comparison.

## Implementation references

- `js/dive-experience-model.js` — weights, availability, group aggregation, minimum requirements, labels, DHW mapping, confidence aggregation.
- `js/dive-conditions-model.js` — physical raw-value bands and dimension score conversion.
- `tools/build_dive_experience_outlook_prototype.js` — conversion of source metrics to dimension results and support.
- `tools/prototype_fish_abundance_outlook.py` — relative fish outlook tiers and categories.
- `data/dive-experience-outlook/v2/manifest.json` — active runtime package for the seven-dimension scoring map; `v1` is retained as a rollback point.
- `analysis/dive-experience-outlook-prototype/README.md` — analysis methodology and limitations.
